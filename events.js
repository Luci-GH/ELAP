// --- START OF FILE events.js ---

import { S, save, getActiveElapCharacter, genId, deepClone, currentEditorDraft } from "./state.js";
import { DEFAULT_ARC_GENERATOR_PROMPT } from "./config.js";
import { sendAgentRequest, extractJsonFromText } from "./agent.js";
import { getPeriodFromTime, timeStringToMinutes } from "./timeline.js";
import { getContext } from "/scripts/extensions.js";

/**
 * Оценка активных событий персонажа с учетом динамического времени xx:xx
 */
export function evaluateEventsForCharacter(charOrId = null, currentSwipeId = 0) {
  const s = S();
  if (!s.eventsEnabled) return { active: [], backlog: [] };

  const char = typeof charOrId === "string"
    ? s.characters.find((c) => String(c.id) === String(charOrId))
    : (charOrId || getActiveElapCharacter());

  if (!char || !Array.isArray(char.events) || !char.events.length) {
    return { active: [], backlog: [] };
  }

  const curDay = parseInt(char.timeline?.day) || 1;
  const curMinutes = timeStringToMinutes(char.timeline?.time || "08:00");

  const active = [];
  const backlog = [];

  for (const evt of char.events) {
    if (evt.status === "completed") continue;

    if (evt.swipeBypass && currentSwipeId > 0 && evt.status === "active") {
      evt.status = "bypassed";
      continue;
    }

    if (evt.status === "bypassed") continue;

    // 1. Цепочки (Chained)
    if (evt.triggerType === "chained" && evt.parentEventId) {
      const parent = char.events.find((e) => String(e.id) === String(evt.parentEventId));
      if (parent && parent.status === "completed") {
        evt.status = "active";
        active.push(evt);
      }
      continue;
    }

    // 2. Время и День
    const evtDay = parseInt(evt.day) || 1;
    const evtMinutes = timeStringToMinutes(evt.time || "08:00");

    if (evtDay < curDay && evt.status === "pending") {
      evt.status = "backlog";
      backlog.push(evt);
      continue;
    }

    if (evtDay === curDay) {
      // Событие активируется, если наступило указанное время
      if (curMinutes >= evtMinutes) {
        evt.status = "active";
        active.push(evt);
      }
    }
  }

  return { active, backlog };
}

export function buildActiveEventsPrompt(charOrId = null, currentSwipeId = 0) {
  const { active, backlog } = evaluateEventsForCharacter(charOrId, currentSwipeId);
  const lines = [];

  if (backlog.length > 0) {
    lines.push("### [СОБЫТИЯ, ПРОИЗОШЕДШИЕ В МИРЕ ЗА ВРЕМЯ ТВОЕГО ОТСУТСТВИЯ]:");
    for (const b of backlog) {
      lines.push(`- (День ${b.day}, ${b.time || ''}): ${b.content.trim()}`);
    }
    lines.push("");
  }

  if (active.length > 0) {
    lines.push("### [ТЕКУЩИЕ АКТИВНЫЕ СЮЖЕТНЫЕ СОБЫТИЯ (ОБЫГРАЙ ИХ В СЦЕНЕ)]: ");
    for (const a of active) {
      lines.push(`- [${a.title} (${a.time || ''})]: ${a.content.trim()}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function markEventsCompleted(char, completedIds = []) {
  if (!char || !Array.isArray(char.events) || !completedIds.length) return false;

  let changed = false;
  for (const id of completedIds) {
    const evt = char.events.find((e) => String(e.id) === String(id));
    if (evt && evt.status !== "completed") {
      evt.status = "completed";
      changed = true;
    }
  }

  if (changed) save();
  return changed;
}

export async function generateStoryArcWithAgent(
  charOrDraft,
  genre = "dnd_fantasy",
  count = 3,
  hideSpoilers = false,
  includeChat = false,
  signal = null,
  onProgress = null
) {
  const s = S();

  let char = null;
  if (charOrDraft && typeof charOrDraft === "object") {
    char = charOrDraft;
  } else if (currentEditorDraft && String(currentEditorDraft.id) === String(charOrDraft)) {
    char = currentEditorDraft;
  } else {
    char = s.characters.find((c) => String(c.id) === String(charOrDraft)) || getActiveElapCharacter();
  }

  if (!char) throw new Error("Персонаж не найден.");

  const blocksList = (char.blocks || [])
    .filter((b) => b && String(b.content || "").trim().length > 0)
    .map((b) => `### [БЛОК: ${b.name || b.key}]\n${String(b.content).trim()}`);

  let loreDump = blocksList.join("\n\n");

  if (!loreDump.trim()) {
    try {
      const ctx = getContext?.();
      const stChars = ctx?.characters || window?.characters;
      const curChid = ctx?.characterId !== undefined ? ctx.characterId : window?.this_chid;
      if (Array.isArray(stChars) && stChars[curChid]) {
        const tc = stChars[curChid];
        const stParts = [
          tc.description ? `### [ОПИСАНИЕ]:\n${tc.description}` : "",
          tc.personality ? `### [ЛИЧНОСТЬ И ХАРАКТЕР]:\n${tc.personality}` : "",
          tc.scenario ? `### [СЦЕНАРИЙ И ОКРУЖЕНИЕ]:\n${tc.scenario}` : "",
          tc.mes_example ? `### [ПРИМЕРЫ ДИАЛОГОВ]:\n${tc.mes_example}` : "",
        ].filter(Boolean);
        if (stParts.length > 0) {
          loreDump = stParts.join("\n\n");
        }
      }
    } catch (e) {}
  }

  if (!loreDump.trim()) {
    loreDump = "(Подробный лор не найден. Сгенерируй сюжет на основе имени персонажа и жанра)";
  }

  let chatContextSnippet = "";
  if (includeChat) {
    try {
      const ctx = getContext?.();
      const chat = ctx?.chat || [];
      if (chat.length > 0) {
        const recent = chat.slice(-4);
        const formatted = recent.map((m) => {
          const sender = m.name || (m.is_user ? "User" : char.name);
          return `[${sender}]: ${m.mes}`;
        }).join("\n\n");
        chatContextSnippet = `\n\n### ТЕКУЩИЕ ПОСЛЕДНИЕ СОБЫТИЯ ИЗ ДИАЛОГА (УЧТИ ДЛЯ СВЯЗКИ):\n${formatted}`;
      }
    } catch (e) {}
  }

  const userPrompt = `
ИМЯ ПЕРСОНАЖА: ${char.name}
ВЫБРАННЫЙ ЖАНР КВЕСТА: ${genre.toUpperCase()}
ТРЕБУЕМОЕ КОЛИЧЕСТВО СОБЫТИЙ: ${count}
ТЕКУЩИЙ ИГРОВОЙ ДЕНЬ: ${char.timeline?.day || 1}
ТЕКУЩЕЕ ВРЕМЯ: ${char.timeline?.time || "08:00"}

### ПОЛНАЯ КАРТОЧКА ПЕРСОНАЖА И ЛОР МИРА:
${loreDump}
${chatContextSnippet}
  `.trim();

  const messages = [
    { role: "system", content: DEFAULT_ARC_GENERATOR_PROMPT },
    { role: "user", content: userPrompt },
  ];

  if (onProgress) onProgress("Отправка запроса к модели...", "");

  const onStream = (accumulatedText, chunkText, chunkIndex) => {
    if (onProgress) {
      onProgress(`Генерация ответа: получено ~${accumulatedText.length} симв. (фрагмент #${chunkIndex})...`, accumulatedText);
    }
  };

  const raw = await sendAgentRequest(messages, 3000, signal, onStream);
  if (!raw) throw new Error("Агент вернул пустой ответ.");

  if (onProgress) onProgress("Разбор ответа и построение сюжетных цепочек...", raw);

  const parsed = extractJsonFromText(raw);
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error("Не удалось разобрать сгенерированную арку в JSON (ожидался массив событий).");
  }

  if (!Array.isArray(char.events)) char.events = [];

  const createdIds = [];
  const startDay = parseInt(char.timeline?.day) || 1;

  parsed.forEach((item, index) => {
    const newId = genId();
    createdIds.push(newId);

    const parentId = (item.parentEventIndex !== null && item.parentEventIndex !== undefined && createdIds[item.parentEventIndex]) 
      ? createdIds[item.parentEventIndex] 
      : null;

    char.events.push({
      id: newId,
      title: String(item.title || `Событие ${index + 1}`),
      content: String(item.content || "").trim(),
      day: Math.max(startDay, parseInt(item.day) || (startDay + index)),
      time: String(item.time || "12:00").trim(),
      period: String(item.period || getPeriodFromTime(item.time || "12:00")),
      triggerType: parentId ? "chained" : (item.triggerType || "time"),
      parentEventId: parentId,
      swipeBypass: item.swipeBypass !== false,
      status: "pending",
      hidden: !!hideSpoilers,
    });
  });

  save();
  return char.events;
}