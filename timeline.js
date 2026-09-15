// --- START OF FILE timeline.js ---

import { S, save, getActiveElapCharacter, deepClone } from "./state.js";
import { DEFAULT_TIMELINE, DEFAULT_TIMELINE_ESTIMATOR_PROMPT } from "./config.js";
import { sendAgentRequest, extractJsonFromText } from "./agent.js";
import { getContext } from "/scripts/extensions.js";
import { saveChatConditional } from "/script.js";

export function parseTimeString(timeStr) {
  if (!timeStr) return { hours: 8, minutes: 0 };
  const str = String(timeStr).trim();

  const match12 = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    const isPm = match12[3].toUpperCase() === "PM";
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return { hours: h, minutes: m };
  }

  const match24 = str.match(/(\d{1,2}):(\d{2})/);
  if (match24) {
    return {
      hours: Math.min(23, Math.max(0, parseInt(match24[1], 10))),
      minutes: Math.min(59, Math.max(0, parseInt(match24[2], 10))),
    };
  }

  return { hours: 8, minutes: 0 };
}

export function timeStringToMinutes(timeStr) {
  const p = parseTimeString(timeStr);
  return p.hours * 60 + p.minutes;
}

export function minutesToTimeString(minutesTotal, format = "24h") {
  const h = Math.floor((minutesTotal % 1440 + 1440) % 1440 / 60);
  const m = Math.floor((minutesTotal % 60 + 60) % 60);
  return formatTimeNumbers(h, m, format);
}

export function getPeriodFromTime(timeStr) {
  const parsed = parseTimeString(timeStr);
  const h = parsed.hours;
  if (h >= 5 && h < 12) return "Утро";
  if (h >= 12 && h < 18) return "День";
  if (h >= 18 && h < 23) return "Вечер";
  return "Ночь";
}

export function formatTimeNumbers(hours, minutes, format = "24h") {
  let h = (hours % 24 + 24) % 24;
  let m = (minutes % 60 + 60) % 60;

  if (format === "12h") {
    const isPm = h >= 12;
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${isPm ? "PM" : "AM"}`;
  }

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatTimelineHeader(charOrId = null) {
  const s = S();
  if (s.timelineEnabled === false) return "";

  let char = null;
  if (typeof charOrId === "string") {
    char = s.characters.find((c) => String(c.id) === String(charOrId));
  } else if (charOrId && typeof charOrId === "object") {
    char = charOrId;
  } else {
    char = getActiveElapCharacter();
  }

  if (!char) return "";

  const tl = char.timeline || deepClone(DEFAULT_TIMELINE);
  if (tl.enabled === false) return "";

  let unit = s.timelineCustomUnit && s.timelineUnitName ? s.timelineUnitName.trim() : (tl.unitName || "Day");
  const day = tl.day || 1;
  const date = tl.date || "1 Сентября";
  const parsedTime = parseTimeString(tl.time);
  const timeStr = formatTimeNumbers(parsedTime.hours, parsedTime.minutes, s.timelineTimeFormat || "24h");
  const period = tl.period || getPeriodFromTime(tl.time);
  const weather = tl.weather || "Ясно, солнечно";

  if (s.timelineIncludeWeather === false) {
    return `[${unit} ${day}. ${date}, ${timeStr} (${period})]`;
  }

  return `[${unit} ${day}. ${date}, ${timeStr} (${period}), ${weather}]`;
}

export function injectTimelineToText(text, charOrId = null) {
  const header = formatTimelineHeader(charOrId);
  if (!header) return String(text || "");

  let cleanText = String(text || "").trim();
  const oldHeaderRegex = /^\[[\w\p{L}\s\d]+[.,][^\]]+\]\s*/u;
  cleanText = cleanText.replace(oldHeaderRegex, "").trim();

  if (!cleanText) return header;
  return `${header}\n\n${cleanText}`;
}

/**
 * Занесение актуальной метки таймлайна в msg.extra объекта сообщения чата SillyTavern
 */
export async function tagMessageWithTimelineExtra(msgObj, customData = null) {
  if (!msgObj) return;
  if (!msgObj.extra || typeof msgObj.extra !== "object") {
    msgObj.extra = {};
  }

  const char = getActiveElapCharacter();
  const tl = char?.timeline || DEFAULT_TIMELINE;

  if (customData) {
    msgObj.extra.elap_timeline = {
      day: parseInt(customData.day) || tl.day || 1,
      time: String(customData.time || tl.time || "08:00").trim(),
      date: String(customData.date || tl.date || "1 Сентября").trim(),
      period: String(customData.period || getPeriodFromTime(customData.time || tl.time)),
      weather: String(customData.weather || tl.weather || "Ясно"),
    };
  } else {
    msgObj.extra.elap_timeline = {
      day: parseInt(tl.day) || 1,
      time: String(tl.time || "08:00").trim(),
      date: String(tl.date || "1 Сентября").trim(),
      period: String(tl.period || getPeriodFromTime(tl.time)),
      weather: String(tl.weather || "Ясно"),
    };
  }

  try {
    await saveChatConditional();
  } catch (e) {}
}

/**
 * Сканирование всех сообщений в текущем чате и синхронизация их extra с таймлайном
 */
export async function syncAllChatMessagesExtra() {
  const ctx = getContext?.();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || !chat.length) return;

  const char = getActiveElapCharacter();
  let curDay = char?.timeline?.day || 1;
  let curTime = char?.timeline?.time || "08:00";
  let curDate = char?.timeline?.date || "1 Сентября";
  let curWeather = char?.timeline?.weather || "Ясно";

  let changed = false;

  for (const m of chat) {
    if (!m.extra || typeof m.extra !== "object") m.extra = {};

    // Если в тексте сообщения есть тег таймлайна, парсим его
    const mesText = String(m.mes || "");
    const match = mesText.match(/^\[(?:Day|День|Сцена|Глава)?\s*(\d+)[.,]?\s*([^,\]]+)?,?\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)?(?:\s*\(([^)]+)\))?(?:,\s*([^\]]+))?\]/iu);

    if (match) {
      curDay = parseInt(match[1], 10) || curDay;
      if (match[2] && !/\d/.test(match[2])) curDate = match[2].trim();
      if (match[3]) curTime = match[3].trim();
      if (match[5]) curWeather = match[5].trim();

      m.extra.elap_timeline = {
        day: curDay,
        time: curTime,
        date: curDate,
        period: match[4] ? match[4].trim() : getPeriodFromTime(curTime),
        weather: curWeather,
      };
      changed = true;
    } else if (!m.extra.elap_timeline) {
      // Если тега нет, но сообщение еще не размечено, наследуем текущее время
      m.extra.elap_timeline = {
        day: curDay,
        time: curTime,
        date: curDate,
        period: getPeriodFromTime(curTime),
        weather: curWeather,
      };
      changed = true;
    } else {
      // Если уже есть в extra, обновляем текущие указатели времени
      if (m.extra.elap_timeline.day) curDay = m.extra.elap_timeline.day;
      if (m.extra.elap_timeline.time) curTime = m.extra.elap_timeline.time;
    }
  }

  if (changed) {
    try {
      await saveChatConditional();
    } catch (e) {}
  }
}

export function advanceTimelineDay(char) {
  if (!char) return;
  if (!char.timeline) char.timeline = deepClone(DEFAULT_TIMELINE);

  const currentDay = parseInt(char.timeline.day) || 1;
  char.timeline.day = currentDay + 1;
  char.timeline.period = "Утро";
  char.timeline.time = "08:00";
  save();
}

export async function estimateTimelineWithAgent(loreText, firstMessageText) {
  const prompt = DEFAULT_TIMELINE_ESTIMATOR_PROMPT;
  const userPayload = `
### ТЕКСТ КАРТОЧКИ / ЛОР:
${String(loreText || "").slice(0, 3000)}

### СТАРТОВОЕ СООБЩЕНИЕ ДИАЛОГА:
${String(firstMessageText || "").slice(0, 1500)}
  `.trim();

  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: userPayload },
  ];

  const rawResponse = await sendAgentRequest(messages, 1000);
  if (!rawResponse) throw new Error("Модель вернула пустой ответ.");

  const parsed = extractJsonFromText(rawResponse);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Не удалось извлечь JSON таймлайна из ответа.");
  }

  const parsedTime = parseTimeString(parsed.time || "08:00");

  return {
    day: parseInt(parsed.day) || 1,
    date: String(parsed.date || "1 Сентября").trim(),
    time: formatTimeNumbers(parsedTime.hours, parsedTime.minutes, "24h"),
    period: String(parsed.period || getPeriodFromTime(parsed.time || "08:00")).trim(),
    weather: String(parsed.weather || "Ясно, солнечно").trim(),
  };
}