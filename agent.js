// --- START OF FILE agent.js ---

import { name1, getCurrentChatId } from "/script.js";
import { getContext } from "/scripts/extensions.js";
import {
  DEFAULT_AGENT_PROMPT,
  DEFAULT_AGENT_SKILLS,
  DEFAULT_IMPORT_DYNAMIC_PROMPT,
  DEFAULT_IMPORT_STANDARD_PROMPT,
  END_DAY_PROMPTS,
} from "./config.js";
import {
  S,
  save,
  getActiveElapCharacter,
  getBlockContent,
  findBlockByKeyOrName,
  sanitizeKey,
  getProfileDetails,
} from "./state.js";
import { registerAllElapMacros } from "./macros.js";
import { liveUpdateEditorDOMIfOpen, setAgentUiBusy } from "./ui.js";
import { markEventsCompleted, buildActiveEventsPrompt } from "./events.js";
import {
  parseTimeString,
  formatTimeNumbers,
  getPeriodFromTime,
  tagMessageWithTimelineExtra,
} from "./timeline.js";
import {
  buildCardsCatalogForAgent,
  activateCard,
  deactivateCard,
} from "./cards.js";

export const AGENT_TOOLS_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "replace_block_content",
      description: "Хирургически заменить точный фрагмент текста внутри динамического блока без перезаписи остального содержимого блока (как в редакторе кода).",
      parameters: {
        type: "object",
        properties: {
          block_key: {
            type: "string",
            description: "Ключ или имя динамического блока, в котором производится замена (например: 'chess', 'world_rules', 'status').",
          },
          target_content: {
            type: "string",
            description: "Точный текущий фрагмент текста внутри блока, который необходимо заменить. Должен в точности присутствовать в тексте блока.",
          },
          replacement_content: {
            type: "string",
            description: "Новый фрагмент текста, который встанет на место target_content.",
          },
          allow_multiple: {
            type: "boolean",
            description: "Если true, заменяет все вхождения. По умолчанию false (только первое вхождение).",
          },
          explanation: {
            type: "string",
            description: "Краткое пояснение причины изменения (например: 'Ход конем e2-e4', '+10 к мане').",
          },
        },
        required: ["block_key", "target_content", "replacement_content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "overwrite_block",
      description: "Полностью перезаписать всё содержимое динамического блока новым текстом. Использовать только при полной реструктуризации или заполнении пустого блока.",
      parameters: {
        type: "object",
        properties: {
          block_key: {
            type: "string",
            description: "Ключ или имя динамического блока для полной перезаписи.",
          },
          content: {
            type: "string",
            description: "Полный актуальный текст блока с нуля.",
          },
          explanation: {
            type: "string",
            description: "Краткое пояснение причины полной перезаписи.",
          },
        },
        required: ["block_key", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_timeline",
      description: "Актуализировать естественное течение игрового времени, дату и погоду на основе событий в чате.",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string", description: "Текущие часы в формате 'ЧЧ:ММ' (например '21:00')." },
          day: { type: "integer", description: "Номер текущего дня (например 1)." },
          date: { type: "string", description: "День недели или календарная дата (например 'Пятница')." },
          period: { type: "string", description: "Пора суток ('Утро', 'День', 'Вечер', 'Ночь')." },
          weather: { type: "string", description: "Текущая погода и обстановка окружения." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_cards",
      description: "Активировать или деактивировать карточки из каталога карточек мира при наступлении релевантных условий.",
      parameters: {
        type: "object",
        properties: {
          activate_cards: {
            type: "array",
            items: { type: "string" },
            description: "Массив ID карточек мира для активации.",
          },
          deactivate_cards: {
            type: "array",
            items: { type: "string" },
            description: "Массив ID карточек мира для выгрузки.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_events",
      description: "Отметить завершение активных сюжетных событий (ивентов).",
      parameters: {
        type: "object",
        properties: {
          completed_event_ids: {
            type: "array",
            items: { type: "string" },
            description: "Массив ID завершенных событий.",
          },
        },
        required: ["completed_event_ids"],
      },
    },
  },
];

/**
 * Хирургическая замена целевого фрагмента в блоке (Diff / Surgical Patch)
 */
export function applySurgicalReplace(block, targetContent, replacementContent, allowMultiple = false) {
  if (!block || typeof block.content !== "string") {
    return { success: false, error: "Блок не найден или не имеет содержимого" };
  }

  const target = String(targetContent || "");
  const replacement = String(replacementContent ?? "");
  if (!target) {
    return { success: false, error: "target_content пустой" };
  }

  const originalContent = block.content;

  // 1. Точное прямое совпадение
  if (originalContent.includes(target)) {
    if (allowMultiple) {
      block.content = originalContent.replaceAll(target, replacement);
    } else {
      block.content = originalContent.replace(target, replacement);
    }
    return { success: true, method: "exact", diff: { target, replacement } };
  }

  // 2. Нормализация переводов строк (\r\n -> \n)
  const normOriginal = originalContent.replaceAll("\r\n", "\n");
  const normTarget = target.replaceAll("\r\n", "\n");
  const normReplacement = replacement.replaceAll("\r\n", "\n");

  if (normOriginal.includes(normTarget)) {
    let patched;
    if (allowMultiple) {
      patched = normOriginal.replaceAll(normTarget, normReplacement);
    } else {
      patched = normOriginal.replace(normTarget, normReplacement);
    }
    if (originalContent.includes("\r\n")) {
      block.content = patched.replaceAll("\n", "\r\n");
    } else {
      block.content = patched;
    }
    return { success: true, method: "normalized_eol", diff: { target: normTarget, replacement: normReplacement } };
  }

  // 3. Попытка с обрезкой краевых пробелов / переводов строк
  const trimmedTarget = normTarget.trim();
  if (trimmedTarget && normOriginal.includes(trimmedTarget)) {
    const patched = normOriginal.replace(trimmedTarget, normReplacement.trim());
    if (originalContent.includes("\r\n")) {
      block.content = patched.replaceAll("\n", "\r\n");
    } else {
      block.content = patched;
    }
    return { success: true, method: "trimmed", diff: { target: trimmedTarget, replacement: normReplacement.trim() } };
  }

  // 4. Построчный fuzzy-поиск
  const origLines = normOriginal.split("\n");
  const targetLines = normTarget.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  if (targetLines.length > 0) {
    for (let i = 0; i <= origLines.length - targetLines.length; i++) {
      let matches = true;
      for (let j = 0; j < targetLines.length; j++) {
        if (origLines[i + j].trim() !== targetLines[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        const repLines = normReplacement.split("\n");
        origLines.splice(i, targetLines.length, ...repLines);
        const joined = origLines.join("\n");
        block.content = originalContent.includes("\r\n") ? joined.replaceAll("\n", "\r\n") : joined;
        return { success: true, method: "line_trimmed", diff: { target, replacement } };
      }
    }
  }

  return { success: false, error: `Фрагмент не найден в блоке "${block.name || block.key}"` };
}

/**
 * Полная перезапись содержимого блока
 */
export function applyOverwrite(block, newContent) {
  if (!block) return { success: false, error: "Блок не найден" };
  const cleaned = String(newContent || "").trim();
  if (block.content === cleaned) {
    return { success: true, changed: false };
  }
  block.content = cleaned;
  return { success: true, changed: true, newLength: cleaned.length };
}

/**
 * Извлечение нативных вызовов инструментов из ответа API (OpenAI, Gemini, Claude)
 */
export function extractNativeToolCalls(raw) {
  if (!raw || typeof raw !== "object") return [];
  const calls = [];

  // 1. OpenAI / OpenRouter
  if (Array.isArray(raw.choices) && raw.choices[0]?.message?.tool_calls) {
    for (const tc of raw.choices[0].message.tool_calls) {
      if (tc?.function) {
        let args = tc.function.arguments;
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch (e) { args = {}; }
        }
        calls.push({ id: tc.id, name: tc.function.name, args: args || {} });
      }
    }
  }

  // 2. Gemini / MakerSuite
  if (Array.isArray(raw.candidates) && raw.candidates[0]?.content?.parts) {
    for (const part of raw.candidates[0].content.parts) {
      if (part.functionCall) {
        calls.push({
          id: part.functionCall.id || `gem_${Date.now()}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
  }

  // 3. Claude (Anthropic)
  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      if (block.type === "tool_use") {
        calls.push({
          id: block.id,
          name: block.name,
          args: block.input || {},
        });
      }
    }
  }

  return calls;
}

/**
 * Извлечение структурированных действий из JSON или XML-тегов
 */
export function extractStructuredActions(parsedJson, textContent = "") {
  const actions = {
    summary: "",
    toolCalls: [],
    patches: [],
    updates: {},
    timeline: null,
    activate_cards: [],
    deactivate_cards: [],
    completed_event_ids: [],
  };

  if (parsedJson && typeof parsedJson === "object") {
    actions.summary = parsedJson.summary || "";

    const rawToolCalls = parsedJson.tool_calls || parsedJson.tools || parsedJson.actions;
    if (Array.isArray(rawToolCalls)) {
      for (const tc of rawToolCalls) {
        const name = tc.name || tc.function?.name || tc.tool;
        let args = tc.args || tc.arguments || tc.parameters || tc.function?.arguments || {};
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch (e) {}
        }
        if (name) {
          actions.toolCalls.push({ name, args });
        }
      }
    }

    const rawPatches = parsedJson.patches || parsedJson.surgical_edits || parsedJson.diffs;
    if (Array.isArray(rawPatches)) {
      for (const p of rawPatches) {
        if (p && (p.block_key || p.block || p.name)) {
          actions.patches.push({
            block_key: p.block_key || p.block || p.name,
            target_content: p.target_content !== undefined ? p.target_content : (p.target || p.find || ""),
            replacement_content: p.replacement_content !== undefined ? p.replacement_content : (p.replacement || p.replace || ""),
            allow_multiple: !!p.allow_multiple,
            explanation: p.explanation || p.reason || "",
          });
        }
      }
    }

    if (parsedJson.updates && typeof parsedJson.updates === "object") {
      for (const [k, v] of Object.entries(parsedJson.updates)) {
        if (typeof v === "string") {
          actions.updates[k] = v;
        }
      }
    }

    if (parsedJson.timeline && typeof parsedJson.timeline === "object") {
      actions.timeline = parsedJson.timeline;
    } else if (parsedJson.timeline_updates && typeof parsedJson.timeline_updates === "object") {
      actions.timeline = parsedJson.timeline_updates;
    }

    if (Array.isArray(parsedJson.activate_cards)) actions.activate_cards = parsedJson.activate_cards;
    if (Array.isArray(parsedJson.deactivate_cards)) actions.deactivate_cards = parsedJson.deactivate_cards;
    if (Array.isArray(parsedJson.completed_event_ids)) actions.completed_event_ids = parsedJson.completed_event_ids;
  }

  if (textContent && textContent.includes("<tool_call>")) {
    const tagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let match;
    while ((match = tagRegex.exec(textContent)) !== null) {
      try {
        const innerJson = JSON.parse(match[1].trim());
        const name = innerJson.name || innerJson.tool;
        const args = innerJson.arguments || innerJson.parameters || innerJson.args || {};
        if (name) actions.toolCalls.push({ name, args });
      } catch (e) {}
    }
  }

  return actions;
}

/**
 * Единый диспетчер выполнения действий агента (патчи, перезаписи, таймлайн, карточки, ивенты)
 */
export async function executeAgentActions(actions, activeChar, editMode = "surgical") {
  const result = {
    summary: actions.summary || "",
    appliedPatches: [],
    appliedOverwrites: [],
    errors: [],
    timelineChanged: false,
    completedEvents: [],
    cardsActivated: [],
    cardsDeactivated: [],
    updatedKeysMap: {},
    logLines: [],
  };

  // 1. Преобразуем toolCalls в actions
  if (Array.isArray(actions.toolCalls)) {
    for (const tc of actions.toolCalls) {
      const name = String(tc.name || "").trim().toLowerCase();
      const args = tc.args || {};

      if (name === "replace_block_content") {
        actions.patches.push({
          block_key: args.block_key || args.block || args.name,
          target_content: args.target_content !== undefined ? args.target_content : args.target,
          replacement_content: args.replacement_content !== undefined ? args.replacement_content : args.replacement,
          allow_multiple: !!args.allow_multiple,
          explanation: args.explanation || "",
        });
      } else if (name === "overwrite_block") {
        const bk = args.block_key || args.block || args.name;
        if (bk && args.content !== undefined) {
          actions.updates[bk] = args.content;
        }
      } else if (name === "update_timeline") {
        actions.timeline = { ...(actions.timeline || {}), ...args };
      } else if (name === "manage_cards") {
        if (Array.isArray(args.activate_cards)) actions.activate_cards.push(...args.activate_cards);
        if (Array.isArray(args.deactivate_cards)) actions.deactivate_cards.push(...args.deactivate_cards);
      } else if (name === "manage_events") {
        if (Array.isArray(args.completed_event_ids)) actions.completed_event_ids.push(...args.completed_event_ids);
      }
    }
  }

  // 2. Сюжетные события
  if (actions.completed_event_ids && actions.completed_event_ids.length > 0) {
    const validIds = actions.completed_event_ids.map(String);
    markEventsCompleted(activeChar, validIds);
    result.completedEvents = validIds;
    result.logLines.push(`🎯 Завершено ивентов: ${validIds.length} (${validIds.join(", ")})`);
  }

  // 3. Таймлайн
  if (actions.timeline && typeof actions.timeline === "object") {
    let tlChanged = false;
    const tlObj = actions.timeline;

    const newTimeRaw = tlObj.time || tlObj.new_time;
    if (newTimeRaw) {
      const p = parseTimeString(newTimeRaw);
      const cleanT = formatTimeNumbers(p.hours, p.minutes, "24h");
      if (cleanT && cleanT !== activeChar.timeline.time) {
        activeChar.timeline.time = cleanT;
        activeChar.timeline.period = getPeriodFromTime(cleanT);
        tlChanged = true;
      }
    }

    const newDayRaw = tlObj.day !== undefined ? tlObj.day : tlObj.new_day;
    if (newDayRaw) {
      const nDay = parseInt(newDayRaw, 10);
      if (nDay && nDay !== activeChar.timeline.day) {
        activeChar.timeline.day = nDay;
        tlChanged = true;
      }
    }

    const newDateRaw = tlObj.date || tlObj.new_date;
    if (newDateRaw && String(newDateRaw).trim() !== activeChar.timeline.date) {
      activeChar.timeline.date = String(newDateRaw).trim();
      tlChanged = true;
    }

    const newPeriodRaw = tlObj.period || tlObj.new_period;
    if (newPeriodRaw && String(newPeriodRaw).trim() !== activeChar.timeline.period) {
      activeChar.timeline.period = String(newPeriodRaw).trim();
      tlChanged = true;
    }

    const newWeatherRaw = tlObj.weather || tlObj.new_weather;
    if (newWeatherRaw && String(newWeatherRaw).trim() !== activeChar.timeline.weather) {
      activeChar.timeline.weather = String(newWeatherRaw).trim();
      tlChanged = true;
    }

    if (tlChanged) {
      result.timelineChanged = true;
      result.updatedKeysMap["__timeline__"] = true;
      result.logLines.push(`⏰ Время: ${activeChar.timeline.time} (${activeChar.timeline.period}), День ${activeChar.timeline.day}`);
    }
  }

  // 4. Карточки мира
  const s = S();
  if (s.cardsEnabled !== false) {
    for (const rawId of actions.activate_cards) {
      const cleanId = String(rawId || "").trim();
      if (cleanId && activateCard(cleanId)) {
        result.cardsActivated.push(cleanId);
        result.logLines.push(`🗂️ Активирована карточка: ${cleanId}`);
      }
    }
    for (const rawId of actions.deactivate_cards) {
      const cleanId = String(rawId || "").trim();
      if (cleanId && deactivateCard(cleanId)) {
        result.cardsDeactivated.push(cleanId);
        result.logLines.push(`⏹ Карточка убрана: ${cleanId}`);
      }
    }
  }

  // 5. Динамические блоки
  const patchedBlockKeys = new Set();

  // Применяем хирургические патчи
  if (editMode !== "overwrite" && Array.isArray(actions.patches) && actions.patches.length > 0) {
    for (const p of actions.patches) {
      const targetKey = sanitizeKey(p.block_key).toLowerCase();
      if (targetKey === "static") continue;

      const block = findBlockByKeyOrName(activeChar, p.block_key);
      if (!block || block.isStatic) {
        result.errors.push(`Блок "${p.block_key}" не найден для патча`);
        continue;
      }

      const res = applySurgicalReplace(block, p.target_content, p.replacement_content, p.allow_multiple);
      if (res.success) {
        patchedBlockKeys.add(sanitizeKey(block.key).toLowerCase());
        const bKey = sanitizeKey(block.key).toLowerCase();
        result.updatedKeysMap[bKey] = true;
        const expl = p.explanation ? ` (${p.explanation})` : "";
        result.appliedPatches.push({
          block: block.name || block.key,
          target: p.target_content,
          replacement: p.replacement_content,
          explanation: p.explanation,
        });
        result.logLines.push(`✏️ [Патч блока "${block.name || block.key}"]${expl}: точечно обновлено`);
      } else {
        result.errors.push(`[Ошибка патча "${block.name || block.key}"]: ${res.error}`);
      }
    }
  }

  // Применяем полные перезаписи (updates)
  if (actions.updates && typeof actions.updates === "object") {
    for (const [rawKey, newContent] of Object.entries(actions.updates)) {
      const targetKey = sanitizeKey(rawKey).toLowerCase();
      if (targetKey === "static") continue;

      if (editMode === "surgical" && patchedBlockKeys.has(targetKey)) {
        continue;
      }

      const block = findBlockByKeyOrName(activeChar, rawKey);
      if (!block || block.isStatic) continue;

      const overRes = applyOverwrite(block, newContent);
      if (overRes.success && overRes.changed) {
        const bKey = sanitizeKey(block.key).toLowerCase();
        result.updatedKeysMap[bKey] = true;
        result.appliedOverwrites.push(block.name || block.key);
        result.logLines.push(`📄 [Полная перезапись блока "${block.name || block.key}"]: ${block.content.length} симв.`);
      }
    }
  }

  return result;
}

let isAgentProcessing = false;
let agentAbortController = null;
let lastAgentExecutionEndTime = 0;
let activeTaskSnapshot = null;

export function isAgentBusy() {
  return isAgentProcessing;
}

export function registerActiveAgentAbortController(controller) {
  agentAbortController = controller;
  isAgentProcessing = true;
}

export function unregisterActiveAgentAbortController() {
  agentAbortController = null;
  isAgentProcessing = false;
}

export function createChatSnapshot(charId) {
  const ctx = getContext?.();
  const chat = ctx?.chat || [];
  const lastMsg = chat[chat.length - 1] || null;

  return {
    charId: String(charId || ""),
    chatId: String(getCurrentChatId() || ""),
    chatLength: chat.length,
    lastMsgMes: String(lastMsg?.mes || "").slice(0, 100),
    lastMsgDate: lastMsg?.send_date || 0,
  };
}

export function validateChatSnapshot(snapshot) {
  if (!snapshot) return false;
  const ctx = getContext?.();
  const chat = ctx?.chat || [];
  const currentChatId = String(getCurrentChatId() || "");
  const lastMsg = chat[chat.length - 1] || null;

  if (currentChatId !== snapshot.chatId) return false;
  if (chat.length !== snapshot.chatLength) return false;
  if (String(lastMsg?.mes || "").slice(0, 100) !== snapshot.lastMsgMes) return false;
  return true;
}

export function abortCurrentAgentTask(reason = "Отменено", notifyToast = true) {
  if (agentAbortController) {
    try {
      agentAbortController.abort();
    } catch (e) {}
    agentAbortController = null;
  }
  isAgentProcessing = false;
  activeTaskSnapshot = null;
  setAgentUiBusy(false, reason);

  if (notifyToast && window.toastr && reason !== "Остановлено вручную") {
    toastr.warning(`ELAP: ${reason}`);
  }
}

export function extractJsonFromText(text) {
  if (!text) return null;
  let str = text.trim();

  try {
    return JSON.parse(str);
  } catch (e) {}

  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = str.match(codeBlockRegex);
  if (match && match[1]) {
    const inner = match[1].trim();
    try {
      return JSON.parse(inner);
    } catch (e) {
      str = inner;
    }
  }

  const firstBracket = str.indexOf("[");
  const firstBrace = str.indexOf("{");

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = str.lastIndexOf("]");
    if (lastBracket > firstBracket) {
      const arrSub = str.substring(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(arrSub);
      } catch (e) {
        const cleaned = arrSub.replace(/,\s*([\]}])/g, "$1");
        try { return JSON.parse(cleaned); } catch (e2) {}
      }
    }
  }

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = str.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      const objSub = str.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(objSub);
      } catch (e) {
        const cleaned = objSub.replace(/,\s*([\]}])/g, "$1");
        try { return JSON.parse(cleaned); } catch (e2) {}
      }
    }
  }

  const arrStart = str.indexOf("[");
  const arrEnd = str.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(str.substring(arrStart, arrEnd + 1).replace(/,\s*([\]}])/g, "$1"));
    } catch (e) {}
  }

  const objStart = str.indexOf("{");
  const objEnd = str.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(str.substring(objStart, objEnd + 1).replace(/,\s*([\]}])/g, "$1"));
    } catch (e) {}
  }

  return null;
}

export function extractContentFromApiResponse(response) {
  if (response === null || response === undefined) return "";
  if (typeof response === "string") return response.trim();

  if (typeof response === "object") {
    if (typeof response.content === "string" && response.content) return response.content.trim();
    if (typeof response.text === "string" && response.text) return response.text.trim();
    if (typeof response.result === "string" && response.result) return response.result.trim();
    if (typeof response.message === "string" && response.message) return response.message.trim();

    if (response.message && typeof response.message === "object") {
      if (typeof response.message.content === "string") return response.message.content.trim();
    }

    if (Array.isArray(response.choices) && response.choices.length > 0) {
      const first = response.choices[0];
      if (typeof first === "string") return first.trim();
      if (first.message?.content) return String(first.message.content).trim();
      if (first.text) return String(first.text).trim();
      if (first.delta?.content) return String(first.delta.content).trim();
    }

    if (Array.isArray(response.candidates) && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
        const textParts = candidate.content.parts
          .filter((p) => !p.thought)
          .map((p) => p.text || "")
          .join("");
        if (textParts) return textParts.trim();
        const anyParts = candidate.content.parts.map((p) => p.text || "").join("");
        if (anyParts) return anyParts.trim();
      }
      if (candidate.text) return String(candidate.text).trim();
    }

    try {
      const str = JSON.stringify(response);
      if (str.includes("blocks") || str.includes("summary") || str.includes("updates")) {
        return str;
      }
    } catch (e) {}
  }

  return "";
}

export function getConnectionProfiles() {
  const ctx = getContext?.();
  return ctx?.extensionSettings?.connectionManager?.profiles || [];
}

async function handleStreamOrStringResult(requestResult, signal, onStreamProgress) {
  if (!requestResult) return "";

  if (typeof requestResult[Symbol.asyncIterator] === "function") {
    let accumulatedText = "";
    let chunkIndex = 0;

    for await (const chunk of requestResult) {
      if (signal?.aborted) break;

      chunkIndex++;
      let textChunk = "";
      if (typeof chunk === "string") {
        textChunk = chunk;
      } else if (chunk && typeof chunk === "object") {
        textChunk = chunk.content !== undefined
          ? chunk.content
          : (chunk.text !== undefined ? chunk.text : (chunk.delta !== undefined ? chunk.delta : ""));
        if (!textChunk && chunk.choices?.[0]) {
          textChunk = chunk.choices[0].delta?.content || chunk.choices[0].text || "";
        }
      }

      if (typeof textChunk === "string" && textChunk) {
        if (textChunk.startsWith(accumulatedText) && textChunk.length > accumulatedText.length) {
          accumulatedText = textChunk;
        } else {
          accumulatedText += textChunk;
        }
      }

      if (onStreamProgress && typeof onStreamProgress === "function") {
        onStreamProgress(accumulatedText, textChunk, chunkIndex);
      }
    }

    return accumulatedText.trim();
  }

  return extractContentFromApiResponse(requestResult);
}

export async function sendAgentRequest(
  messages,
  maxTokens = 2500,
  signal = null,
  onStreamProgress = null,
  overrideProfileId = null,
  tools = null,
  returnDetails = false
) {
  const s = S();
  const ctx = getContext?.();
  const profileId = overrideProfileId !== null ? overrideProfileId : s.connectionProfile;

  const profInfo = getProfileDetails(profileId);
  const isUsingActive = !profileId || profileId === "__active__" || profInfo.id === "__active__";

  const isReasoningEnabled = !!s.agentRequestReasoning;
  const effortStr = isReasoningEnabled ? (s.agentReasoningEffort || "none") : "none";
  const isThinkingDisabled = !isReasoningEnabled || effortStr === "none";

  let geminiBudget = 0;
  let geminiLevel = "MINIMAL";

  if (!isThinkingDisabled) {
    if (effortStr === "minimal") { geminiBudget = 256; geminiLevel = "MINIMAL"; }
    else if (effortStr === "low") { geminiBudget = 1024; geminiLevel = "LOW"; }
    else if (effortStr === "medium") { geminiBudget = 4096; geminiLevel = "MEDIUM"; }
    else if (effortStr === "high") { geminiBudget = 16384; geminiLevel = "HIGH"; }
    else if (effortStr === "custom") {
      geminiBudget = Math.max(0, parseInt(s.agentReasoningBudget) || 0);
      geminiLevel = geminiBudget <= 512 ? "MINIMAL" : geminiBudget <= 2048 ? "LOW" : "MEDIUM";
    }
  }

  const contextLength = Math.max(512, parseInt(s.agentContextSize) || 8192);
  const temperature = parseFloat(s.agentTemperature) ?? 0.1;

  const geminiThinkingConfig = isThinkingDisabled
    ? { thinkingBudget: 0, thinking_budget: 0, thinkingLevel: "MINIMAL", thinking_level: "MINIMAL" }
    : { thinkingBudget: geminiBudget, thinking_budget: geminiBudget, thinkingLevel: geminiLevel, thinking_level: geminiLevel };

  const customOpts = {
    stream: s.streamAgentResponse === true,
    signal: signal || undefined,
    extractData: !tools,
    max_context_length: contextLength,
    context_size: contextLength,
    max_tokens: maxTokens,
    maxOutputTokens: maxTokens,
    max_output_tokens: maxTokens,
    temperature: temperature,

    thinkingBudget: geminiThinkingConfig.thinkingBudget,
    thinking_budget: geminiThinkingConfig.thinking_budget,
    thinkingLevel: geminiThinkingConfig.thinkingLevel,
    thinking_level: geminiThinkingConfig.thinking_level,
    thinkingConfig: geminiThinkingConfig,
    thinking_config: geminiThinkingConfig,
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: maxTokens,
      thinkingConfig: geminiThinkingConfig,
      thinking_config: geminiThinkingConfig,
    },

    request_reasoning: !isThinkingDisabled,
    reasoning_effort: isThinkingDisabled ? "none" : effortStr,
    reasoning: {
      enabled: !isThinkingDisabled,
      effort: isThinkingDisabled ? "none" : effortStr,
      max_tokens: geminiBudget,
      budget_tokens: geminiBudget,
    },
    thinking: {
      type: isThinkingDisabled ? "disabled" : "enabled",
      budget_tokens: geminiBudget,
    },

    extra_body: {
      reasoning_effort: isThinkingDisabled ? "none" : effortStr,
      thinkingConfig: geminiThinkingConfig,
      thinking_config: geminiThinkingConfig,
      thinkingBudget: geminiThinkingConfig.thinkingBudget,
      thinkingLevel: geminiThinkingConfig.thinkingLevel,
      generationConfig: {
        thinkingConfig: geminiThinkingConfig,
      },
      thinking: {
        type: isThinkingDisabled ? "disabled" : "enabled",
        budget_tokens: geminiBudget,
      },
    },
  };

  const executeApiCall = async (useStreaming) => {
    customOpts.stream = useStreaming;
    const overridePayload = {};
    if (tools && s.agentUseNativeTools !== false) {
      overridePayload.tools = tools;
      overridePayload.tool_choice = "auto";
      customOpts.extractData = false;
    }

    if (!isUsingActive && profileId && ctx?.ConnectionManagerRequestService?.sendRequest) {
      return await ctx.ConnectionManagerRequestService.sendRequest(
        profileId,
        messages,
        maxTokens,
        customOpts,
        overridePayload
      );
    }

    if (typeof ctx?.generateRaw === "function") {
      return await ctx.generateRaw(messages, { max_tokens: maxTokens, temperature, ...customOpts, ...overridePayload }, false, false);
    }

    if (ctx?.ConnectionManagerRequestService?.sendRequest) {
      const activeProfId = ctx?.extensionSettings?.connectionManager?.activeProfile || "";
      return await ctx.ConnectionManagerRequestService.sendRequest(
        activeProfId,
        messages,
        maxTokens,
        customOpts,
        overridePayload
      );
    }

    throw new Error("Не удалось выполнить запрос: сервисы генерации Таверны недоступны.");
  };

  let finalContent = "";
  let rawApiRes = null;

  if (s.streamAgentResponse === true) {
    try {
      const streamRes = await executeApiCall(true);
      rawApiRes = streamRes;
      finalContent = await handleStreamOrStringResult(streamRes, signal, onStreamProgress);
      if (finalContent && finalContent.trim().length > 0) {
        const toolCalls = extractNativeToolCalls(rawApiRes);
        if (returnDetails) {
          return { content: finalContent.trim(), toolCalls, raw: rawApiRes };
        }
        return finalContent.trim();
      }
    } catch (streamErr) {
      if (signal?.aborted) throw streamErr;
    }
  }

  const nonStreamRes = await executeApiCall(false);
  rawApiRes = nonStreamRes;
  finalContent = await handleStreamOrStringResult(nonStreamRes, signal, onStreamProgress);
  if (!finalContent || !finalContent.trim()) {
    finalContent = extractContentFromApiResponse(nonStreamRes);
  }

  const toolCalls = extractNativeToolCalls(rawApiRes);
  if (returnDetails) {
    return {
      content: finalContent ? finalContent.trim() : "",
      toolCalls,
      raw: rawApiRes,
    };
  }

  return finalContent ? finalContent.trim() : null;
}

export function stopAgentRequest(reason = "Остановлено вручную") {
  if (!isAgentProcessing && !agentAbortController) {
    if (window.toastr) toastr.info("Агент сейчас не выполняет запрос");
    return;
  }

  abortCurrentAgentTask(reason, false);

  const debugTextarea = document.querySelector("#elap_debug_output");
  if (debugTextarea) {
    debugTextarea.value = "⏹ Запрос был принудительно остановлен пользователем.";
  }

  if (window.toastr) toastr.warning("Запрос к агенту остановлен");
}

export async function parseExternalCharacterCard(rawText, dynamicBlocksMode = true, customSystemPrompt = null) {
  if (!rawText || !rawText.trim()) {
    throw new Error("Вставьте текст карточки персонажа для анализа.");
  }

  const systemPrompt = customSystemPrompt?.trim() ||
    (dynamicBlocksMode ? DEFAULT_IMPORT_DYNAMIC_PROMPT : DEFAULT_IMPORT_STANDARD_PROMPT);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `### ИСХОДНЫЙ ТЕКСТ КАРТОЧКИ ПЕРСОНАЖА ДЛЯ ПАРСИНГА:\n\n${rawText.trim()}` },
  ];

  const rawResponse = await sendAgentRequest(messages, 4000);
  if (!rawResponse) throw new Error("Модель вернула пустой ответ.");

  const parsed = extractJsonFromText(rawResponse);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Ответ модели не удалось разобрать как валидный JSON.");
  }

  return parsed;
}

export async function runAgentOnCurrentChat(manual = false) {
  const s = S();
  const cooldownMs = Math.max(0, parseInt(s.agentCooldownSec) || 2) * 1000;
  const now = Date.now();
  const timeSinceLast = now - lastAgentExecutionEndTime;

  if (!manual && timeSinceLast < cooldownMs) return;

  if (isAgentProcessing) {
    abortCurrentAgentTask("Новый запуск агента", false);
    await new Promise((r) => setTimeout(r, 100));
  }

  const ctx = getContext?.();
  const chatHistory = ctx?.chat;
  if (!Array.isArray(chatHistory) || !chatHistory.length) {
    if (manual && window.toastr) toastr.info("История чата пуста");
    return;
  }

  const activeChar = getActiveElapCharacter();
  if (!activeChar) {
    if (manual && window.toastr) toastr.warning("Активный персонаж ELAP не выбран");
    return;
  }

  const taskSnapshot = createChatSnapshot(activeChar.id);
  activeTaskSnapshot = taskSnapshot;

  if (manual) {
    s.lastRunChatLength = chatHistory.length;
    save();
  }

  const depth = Math.max(1, parseInt(s.agentScanDepth) || 3);
  const maxTokens = Math.max(100, parseInt(s.agentMaxTokens) || 2500);
  const recentSlice = chatHistory.slice(-depth);

  const formattedChat = recentSlice
    .map((m) => {
      const sender = m.name || (m.is_user ? name1 || "User" : activeChar.name);
      return `[${sender}]: ${m.mes || ""}`;
    })
    .join("\n\n");

  const agentPrompt = String(s.agentPrompt || DEFAULT_AGENT_PROMPT).trim();

  let contextPayload = `### АКТИВНЫЙ ПЕРСОНАЖ: ${activeChar.name}\n\n`;

  // ПОЛНЫЙ ДИНАМИЧЕСКИЙ БЛОК ТАЙМЛАЙНА
  if (s.timelineEnabled !== false) {
    const tl = activeChar.timeline || {};
    const pTime = parseTimeString(tl.time || "08:00");
    const cleanT = formatTimeNumbers(pTime.hours, pTime.minutes, "24h");
    const cleanP = tl.period || getPeriodFromTime(cleanT);

    contextPayload += `### ТЕКУЩИЙ ТАЙМЛАЙН И ОБСТАНОВКА (ДИНАМИЧЕСКИЙ БЛОК ДЛЯ АКТУАЛИЗАЦИИ):
- День #: ${tl.day || 1}
- Дата / День недели: ${tl.date || "Пятница"}
- Текущее время (Часы): ${cleanT}
- Пора суток: ${cleanP}
- Погода и окружение: ${tl.weather || "Тихая ясная ночь"}\n\n`;
  }

  const eventsList = buildActiveEventsPrompt(activeChar, 0);
  if (eventsList) {
    contextPayload += `${eventsList}\n\n`;
  }

  if (s.cardsEnabled !== false) {
    const cardsCatalog = buildCardsCatalogForAgent();
    if (cardsCatalog) {
      contextPayload += `${cardsCatalog}\n\n`;
    }
  }

  let charBio = "";
  if (s.sendStaticToAgent) {
    charBio = getBlockContent("static", activeChar).trim();
  }
  if (!charBio) {
    const stChar = ctx?.characters?.[ctx?.characterId];
    if (stChar) {
      const parts = [stChar.description, stChar.personality].filter(Boolean);
      charBio = parts.join("\n").trim();
    }
  }
  if (charBio) {
    contextPayload += `### БАЗОВАЯ/СТАТИЧНАЯ ИНФОРМАЦИЯ И ОПИСАНИЕ ПЕРСОНАЖА (НЕИЗМЕННО, ТОЛЬКО ДЛЯ ЧТЕНИЯ):\n${charBio}\n\n`;
  }

  const dynamicBlocks = (activeChar.blocks || []).filter(
    (b) => !b.isStatic && sanitizeKey(b.key).toLowerCase() !== "static"
  );

  contextPayload += `### ТЕКУЩИЕ ДИНАМИЧЕСКИЕ БЛОКИ ДЛЯ ВОЗМОЖНОГО РЕДАКТИРОВАНИЯ:\n`;
  if (dynamicBlocks.length === 0) {
    contextPayload += `(Динамические блоки отсутствуют)\n\n`;
  } else {
    for (const b of dynamicBlocks) {
      const k = sanitizeKey(b.key);
      contextPayload += `--- БЛОК [key: "${k}", name: "${b.name}"] ---\n${b.content || "(пусто)"}\n\n`;
    }
  }

  contextPayload += `### ПОСЛЕДНИЕ ${recentSlice.length} СООБЩЕНИЙ ИЗ ЧАТА:\n${formattedChat}\n\n`;
  const editMode = s.agentBlockEditMode || "surgical";

  const activeSkills = (s.agentSkills || []).filter((sk) => sk.enabled !== false);
  if (activeSkills.length > 0) {
    contextPayload += `### АКТИВНЫЕ НАВЫКИ И ПРОТОКОЛЫ (SKILLS):\n`;
    for (const sk of activeSkills) {
      contextPayload += `[Навык: "${sk.name}"]\n${sk.instructions || sk.description}\n\n`;
    }
  }

  contextPayload += `### ТВОЯ ЗАДАЧА:\n`;
  contextPayload += `1. АНАЛИЗ СОСТОЯНИЯ: Внимательно изучи сообщения чата, определи изменения обстановки и состояния в блоках.\n`;

  if (editMode === "surgical") {
    contextPayload += `2. ДИНАМИЧЕСКИЕ БЛОКИ (ТОЧЕЧНОЕ РЕДАКТИРОВАНИЕ): Используй инструмент replace_block_content (или массив "patches" в JSON) для точечной замены только изменившихся фрагментов внутри блоков (шахматные ходы, параметры, правила, строки). Весь остальной текст блока должен оставаться нетронутым! overwrite_block ("updates") используй только если блок пуст или полностью переписан.\n`;
  } else if (editMode === "overwrite") {
    contextPayload += `2. ДИНАМИЧЕСКИЕ БЛОКИ (ПОЛНАЯ ПЕРЕЗАПИСЬ): Перепиши изменившиеся динамические блоки целиком с помощью инструмента overwrite_block (или объекта "updates" в JSON).\n`;
  } else {
    contextPayload += `2. ДИНАМИЧЕСКИЕ БЛОКИ (АВТО): Выбирай оптимальный инструмент: replace_block_content ("patches") для точечных изменений либо overwrite_block ("updates") для полной перезаписи.\n`;
  }

  contextPayload += `3. ТАЙМЛАЙН: Если в сцене прошло время или изменилась погода, вызови update_timeline (или укажи объект "timeline").\n`;
  contextPayload += `4. СЮЖЕТНЫЕ ИВЕНТЫ: Если завершилось активное сюжетное событие, укажи его ID в manage_events ("completed_event_ids").\n`;
  contextPayload += `5. КАРТОЧКИ МИРА: Сверь контекст сцены с каталогом карточек мира и вызови manage_cards ("activate_cards" / "deactivate_cards") при необходимости.\n`;
  contextPayload += `6. ВЕРНИ РЕЗУЛЬТАТ через Tool Calling API или строго валидный JSON.`;

  const messages = [
    { role: "system", content: agentPrompt },
    { role: "user", content: contextPayload },
  ];

  let watchdogTimer = null;

  try {
    isAgentProcessing = true;
    setAgentUiBusy(true, `Анализ диалога (${activeChar.name})...`);
    agentAbortController = new AbortController();

    const timeoutSec = Math.max(10, parseInt(s.agentTimeoutSec) || 60);
    watchdogTimer = setTimeout(() => {
      if (isAgentProcessing) {
        abortCurrentAgentTask("Превышено время ожидания ответа агента (Timeout)");
      }
    }, timeoutSec * 1000);

    const debugTextarea = document.querySelector("#elap_debug_output");
    if (debugTextarea) {
      debugTextarea.value = "⏳ Агент анализирует диалог, время и состояние событий...";
    }

    const onStreamProgress = (accumulatedText, delta, chunkIndex) => {
      const debugEl = document.querySelector("#elap_debug_output");
      if (debugEl) {
        debugEl.value = `⏳ [Streaming... получено чанков: ${chunkIndex}]\n\n${accumulatedText}`;
        debugEl.scrollTop = debugEl.scrollHeight;
      }
    };

    const toolsToPass = s.agentUseNativeTools !== false ? AGENT_TOOLS_DEFINITIONS : null;

    s.lastPostAgentPrompt = `=== SYSTEM PROMPT ===\n${agentPrompt}\n\n=== USER PAYLOAD ===\n${contextPayload}`;
    s.lastPostAgentTime = new Date().toLocaleTimeString();

    const rawResult = await sendAgentRequest(
      messages,
      maxTokens,
      agentAbortController.signal,
      onStreamProgress,
      null,
      toolsToPass,
      true
    );

    if (agentAbortController?.signal?.aborted) return;

    if (!validateChatSnapshot(taskSnapshot)) {
      abortCurrentAgentTask("Контекст чата изменился во время анализа. Изменения отклонены.", true);
      return;
    }

    if (rawResult) {
      s.lastAgentTime = new Date().toLocaleTimeString();
      s.lastPostAgentTime = s.lastAgentTime;

      const rawText = typeof rawResult === "string" ? rawResult : (rawResult.content || "");
      const nativeCalls = Array.isArray(rawResult?.toolCalls) ? rawResult.toolCalls : [];
      let rawDisplay = rawText;
      if (nativeCalls.length > 0) {
        rawDisplay = `[NATIVE TOOL CALLS]\n${JSON.stringify(nativeCalls, null, 2)}\n\n[TEXT CONTENT]\n${rawText || "(нет текстового контента)"}`;
      }
      s.lastPostAgentRawResponse = rawDisplay;

      const parsedJson = extractJsonFromText(rawText);

      // Извлекаем все действия
      const actions = extractStructuredActions(parsedJson, rawText);
      if (nativeCalls.length > 0) {
        actions.toolCalls.push(...nativeCalls);
      }

      // Выполняем действия
      const execResult = await executeAgentActions(actions, activeChar, editMode);

      // Привязываем таймлайн к сообщению, если изменился
      if (execResult.timelineChanged && recentSlice.length > 0) {
        const lastMsg = recentSlice[recentSlice.length - 1];
        await tagMessageWithTimelineExtra(lastMsg, activeChar.timeline);
      }

      const totalChangesCount =
        execResult.appliedPatches.length +
        execResult.appliedOverwrites.length +
        (execResult.timelineChanged ? 1 : 0) +
        execResult.completedEvents.length +
        execResult.cardsActivated.length +
        execResult.cardsDeactivated.length;

      if (totalChangesCount > 0) {
        save();
        registerAllElapMacros();
        liveUpdateEditorDOMIfOpen(activeChar.id, execResult.updatedKeysMap);
      }

      const modeDisplay = editMode === "surgical"
        ? "Хирургический патч (Target Diff)"
        : (editMode === "overwrite" ? "Полная перезапись (Классический)" : "Авто / Гибридный");

      const debugLines = [];
      debugLines.push(`[${s.lastAgentTime}] Саммари: ${execResult.summary || "Без описания"}`);
      debugLines.push(`Режим обновления: ${modeDisplay}`);

      if (execResult.logLines.length > 0) {
        debugLines.push(`Выполнено действий:`);
        for (const line of execResult.logLines) {
          debugLines.push(`  • ${line}`);
        }
      } else {
        debugLines.push(`Изменений блоков и состояния не зафиксировано.`);
      }

      if (execResult.errors.length > 0) {
        debugLines.push(`Предупреждения/ошибки:`);
        for (const err of execResult.errors) {
          debugLines.push(`  ⚠️ ${err}`);
        }
      }

      debugLines.push(`\n--- СЫРОЙ ОТВЕТ МОДЕЛИ / TOOL CALLS ---`);
      if (nativeCalls.length > 0) {
        debugLines.push(`[Native Tool Calls]:\n${JSON.stringify(nativeCalls, null, 2)}`);
      }
      debugLines.push(rawText || "(пустой текст)");

      s.lastPostAgentLog = debugLines.join("\n");
      s.lastAgentResponse = s.lastPostAgentLog;
      save();

      const finalDebugEl = document.querySelector("#elap_debug_output");
      if (finalDebugEl) {
        finalDebugEl.value = s.lastAgentResponse;
        finalDebugEl.scrollTop = finalDebugEl.scrollHeight;
      }

      if (s.showAgentToasts !== false && window.toastr) {
        if (execResult.appliedPatches.length > 0) {
          const patchedNames = execResult.appliedPatches.map((p) => p.block).join(", ");
          toastr.success(`ELAP: Точечно обновлено [${patchedNames}]`);
        } else if (execResult.appliedOverwrites.length > 0) {
          toastr.success(`ELAP: Перезаписано [${execResult.appliedOverwrites.join(", ")}]`);
        } else if (execResult.timelineChanged) {
          toastr.info(`ELAP: Время обновлено: ${activeChar.timeline.time}`);
        } else {
          toastr.info(execResult.summary || "Анализ завершен (без изменений)");
        }
      }

      setAgentUiBusy(false, "done");
    }
  } catch (err) {
    console.error("[ELAP] Post-Agent execution error:", err);
    if (err.name !== "AbortError" && !agentAbortController?.signal?.aborted) {
      setAgentUiBusy(false, "Ошибка выполнения");
      s.lastPostAgentLog = `[${new Date().toLocaleTimeString()}] ❌ Ошибка выполнения Post-Agent:\n${err.message}\n\nСтек ошибки:\n${err.stack || "(нет стека)"}`;
      s.lastAgentResponse = s.lastPostAgentLog;
      save();
      const finalDebugEl = document.querySelector("#elap_debug_output");
      if (finalDebugEl) finalDebugEl.value = s.lastPostAgentLog;
      if (window.toastr) {
        toastr.error(`ELAP: Ошибка агента — ${err.message}`);
      }
    }
  } finally {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    lastAgentExecutionEndTime = Date.now();
    isAgentProcessing = false;
    agentAbortController = null;
    activeTaskSnapshot = null;
  }
}

export async function generateEndDaySummary(settings, onStreamProgress) {
  const s = S();
  const ctx = getContext?.();
  let chatHistory = ctx?.chat || [];

  if (!chatHistory.length) throw new Error("История чата пуста, нечего суммировать!");
  if (settings.excludeLast) chatHistory = chatHistory.slice(0, -1);
  if (!chatHistory.length) throw new Error("После исключения последнего сообщения в чате не осталось данных.");

  const formattedChat = chatHistory.map((m) => {
    if (m.is_system) return `[SYSTEM]: ${m.mes}`;
    const sender = m.name || (m.is_user ? "User" : "Character");
    return `[${sender}]: ${m.mes}`;
  }).join("\n\n");

  const chosenPrompt = END_DAY_PROMPTS[settings.promptType] || END_DAY_PROMPTS["balanced"];
  
  const messages = [
    { role: "system", content: chosenPrompt },
    { role: "user", content: `ЧАТ ПРОШЕДШЕГО ДНЯ ДЛЯ АНАЛИЗА И САММАРИЗАЦИИ:\n\n${formattedChat}` }
  ];

  const originalProfile = s.connectionProfile;
  if (settings.profile === "main") s.connectionProfile = "__active__";

  agentAbortController = new AbortController();
  isAgentProcessing = true;

  try {
    const maxTokens = Math.max(2000, parseInt(s.agentMaxTokens) || 3000);
    return await sendAgentRequest(messages, maxTokens, agentAbortController.signal, onStreamProgress);
  } finally {
    s.connectionProfile = originalProfile;
    isAgentProcessing = false;
    agentAbortController = null;
  }
}