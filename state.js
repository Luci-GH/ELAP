// --- START OF FILE state.js ---

import { saveSettingsDebounced } from "/script.js";
import { extension_settings, getContext } from "/scripts/extensions.js";
import {
  MODULE_NAME,
  DEFAULTS,
  DEFAULT_BLOCKS,
  DEFAULT_DAYS,
  DEFAULT_TIMELINE,
  DEFAULT_AGENT_PROMPT,
  DEFAULT_AGENT_SKILLS,
  DEFAULT_WORLD_DECKS,
  DEFAULT_CHESS_CHARACTER,
} from "./config.js";
import { formatTimelineHeader } from "./timeline.js";
import { buildActiveEventsPrompt } from "./events.js";
import { buildActiveCardsPrompt, buildCardsCatalogForAgent, getWorldCards } from "./cards.js";

export let currentEditorDraft = null;

export function setCurrentEditorDraft(draft) {
  currentEditorDraft = draft;
}

export function S() {
  if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = { ...DEFAULTS };
  }
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (extension_settings[MODULE_NAME][k] === undefined) {
      extension_settings[MODULE_NAME][k] = v;
    }
  }
  const s = extension_settings[MODULE_NAME];
  if (s.agentPrompt && !s.agentPrompt.includes("replace_block_content") && !s.agentPrompt.includes("SURGICAL")) {
    s.agentPrompt = DEFAULT_AGENT_PROMPT;
    save();
  }
  if (!Array.isArray(s.agentSkills) || s.agentSkills.length === 0) {
    s.agentSkills = deepClone(DEFAULT_AGENT_SKILLS);
    save();
  } else {
    let changed = false;
    for (const defSk of DEFAULT_AGENT_SKILLS) {
      if (!s.agentSkills.some((sk) => sk.id === defSk.id)) {
        s.agentSkills.push(deepClone(defSk));
        changed = true;
      }
    }
    if (changed) save();
  }
  return s;
}

export function save() {
  saveSettingsDebounced();
}

export function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function deepClone(obj) {
  if (globalThis.structuredClone) return globalThis.structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

export function genId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `elap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function sanitizeKey(input) {
  const raw = String(input || "").trim();
  const cleaned = raw
    .replace(/[^\p{L}\p{N}_]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "item";
}

export function countTokens(text) {
  if (!text) return 0;
  const str = String(text);
  try {
    if (typeof window?.encode === "function") return window.encode(str).length;
    if (typeof window?.tokenizers?.encode === "function") return window.tokenizers.encode(str).length;
    const ctx = getContext?.();
    if (typeof ctx?.encode === "function") return ctx.encode(str).length;
  } catch (e) {}
  return Math.ceil(str.length / 3.4);
}

export function buildAgentFullPromptPreview(char = null, depth = null) {
  const s = S();
  const targetChar = char || getActiveElapCharacter();
  const systemPrompt = String(s.agentPrompt || DEFAULT_AGENT_PROMPT).trim();

  if (!targetChar) {
    return {
      systemPrompt,
      userPayload: "",
      systemTokens: countTokens(systemPrompt),
      userTokens: 0,
      totalTokens: countTokens(systemPrompt),
    };
  }

  const scanDepth = depth !== null ? depth : Math.max(1, parseInt(s.agentScanDepth) || 3);
  const ctx = getContext?.();
  const chatHistory = ctx?.chat || [];
  const recentSlice = chatHistory.slice(-scanDepth);

  const formattedChat = recentSlice
    .map((m) => {
      const sender = m.name || (m.is_user ? "User" : targetChar.name);
      return `[${sender}]: ${m.mes || ""}`;
    })
    .join("\n\n");

  let contextPayload = `### АКТИВНЫЙ ПЕРСОНАЖ: ${targetChar.name}\n\n`;

  if (s.timelineEnabled) {
    contextPayload += `### ТЕКУЩИЙ ТАЙМЛАЙН:\n${formatTimelineHeader(targetChar)}\n\n`;
  }

  const eventsSnippet = buildActiveEventsPrompt(targetChar, 0);
  if (eventsSnippet) {
    contextPayload += `${eventsSnippet}\n\n`;
  }

  if (s.cardsEnabled !== false) {
    const cardsCatalog = buildCardsCatalogForAgent();
    if (cardsCatalog) {
      contextPayload += `${cardsCatalog}\n\n`;
    }
  }

  if (s.sendStaticToAgent) {
    const staticContent = getBlockContent("static", targetChar);
    if (staticContent.trim()) {
      contextPayload += `### БАЗОВАЯ/СТАТИЧНАЯ ИНФОРМАЦИЯ (НЕИЗМЕННО, ТОЛЬКО ДЛЯ ЧТЕНИЯ):\n${staticContent.trim()}\n\n`;
    }
  }

  const dynamicBlocks = (targetChar.blocks || []).filter(
    (b) => !b.isStatic && sanitizeKey(b.key).toLowerCase() !== "static"
  );

  const activeSkills = (s.agentSkills || []).filter((sk) => sk.enabled !== false);
  if (activeSkills.length > 0) {
    contextPayload += `### АКТИВНЫЕ НАВЫКИ И ПРОТОКОЛЫ (SKILLS):\n`;
    for (const sk of activeSkills) {
      contextPayload += `[Навык: "${sk.name}"]\n${sk.instructions || sk.description}\n\n`;
    }
  }

  contextPayload += `### ТЕКУЩИЕ ДИНАМИЧЕСКИЕ БЛОКИ ДЛЯ ВОЗМОЖНОГО РЕДАКТИРОВАНИЯ:\n`;
  if (dynamicBlocks.length === 0) {
    contextPayload += `(Динамические блоки отсутствуют)\n\n`;
  } else {
    for (const b of dynamicBlocks) {
      const k = sanitizeKey(b.key);
      contextPayload += `--- БЛОК [key: "${k}", name: "${b.name}"] ---\n${b.content || "(пусто)"}\n\n`;
    }
  }

  contextPayload += `### ПОСЛЕДНИЕ ${recentSlice.length} СООБЩЕНИЙ ИЗ ЧАТА:\n${formattedChat || "(Чат пуст)"}\n\n`;
  contextPayload += `### ТВОЯ ЗАДАЧА:\nПроанализируй диалог. Примени инструменты replace_block_content для точечного изменения данных, либо overwrite_block при полной замене. Актуализируй таймлайн, события и карточки мира.`;

  const sysTok = countTokens(systemPrompt);
  const userTok = countTokens(contextPayload);

  return {
    systemPrompt,
    userPayload: contextPayload,
    systemTokens: sysTok,
    userTokens: userTok,
    totalTokens: sysTok + userTok,
  };
}

export function ensureUniqueKeys(items, keyProp = "key", fallback = "item") {
  const used = new Set();
  for (const item of items) {
    const base = sanitizeKey(item[keyProp] || item.name || fallback);
    let k = base;
    let i = 2;
    while (used.has(k.toLowerCase())) {
      k = `${base}_${i++}`;
    }
    item[keyProp] = k;
    used.add(k.toLowerCase());
  }
  return items;
}

export function downloadJsonFile(filename, dataObj) {
  const jsonStr = typeof dataObj === "string" ? dataObj : JSON.stringify(dataObj, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportCharacterToJson(charId) {
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return false;

  const exportData = {
    elap_version: "2.3",
    exported_at: new Date().toISOString(),
    type: "elap_character",
    character: deepClone(char),
  };

  const safeName = sanitizeKey(char.name) || "character";
  downloadJsonFile(`${safeName}.elap.json`, exportData);
  return true;
}

export function exportAllCharactersToJson() {
  const s = S();
  const exportData = {
    elap_version: "2.3",
    exported_at: new Date().toISOString(),
    type: "elap_characters_bundle",
    characters: deepClone(s.characters),
  };
  downloadJsonFile(`elap_all_characters_${Date.now()}.json`, exportData);
  return true;
}

export function extractCharacterFromPng(buffer) {
  if (!buffer || !(buffer instanceof ArrayBuffer)) return null;
  const view = new DataView(buffer);
  if (buffer.byteLength < 8) return null;
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null;

  let offset = 8;
  const len = buffer.byteLength;
  const textDecoder = new TextDecoder("latin1");
  const utf8Decoder = new TextDecoder("utf-8");

  while (offset + 8 <= len) {
    const chunkLen = view.getUint32(offset);
    const chunkType = textDecoder.decode(new Uint8Array(buffer, offset + 4, 4));
    if (chunkType === "tEXt" && offset + 8 + chunkLen <= len) {
      const chunkData = new Uint8Array(buffer, offset + 8, chunkLen);
      let nullIdx = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx !== -1) {
        const keyword = textDecoder.decode(chunkData.subarray(0, nullIdx));
        if (keyword.toLowerCase() === "chara" || keyword.toLowerCase() === "ccv3") {
          const rawBase64 = textDecoder.decode(chunkData.subarray(nullIdx + 1));
          try {
            const binaryStr = atob(rawBase64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            const jsonStr = utf8Decoder.decode(bytes);
            return JSON.parse(jsonStr);
          } catch (e) {}
        }
      }
    }
    offset += 8 + chunkLen + 4;
  }
  return null;
}

export function extractCharacterDataFromRaw(rawInput, tavernChar = null) {
  if (tavernChar) {
    const data = tavernChar.data || tavernChar;
    const name = data.name || tavernChar.name || "Unnamed";
    const desc = data.description || "";
    const personality = data.personality || "";
    const scenario = data.scenario || "";
    const firstMes = data.first_mes || "";
    const mesExample = data.mes_example || "";
    const sysPrompt = data.system_prompt || "";

    const staticParts = [];
    if (sysPrompt) staticParts.push(`### Инструкции и директивы\n${sysPrompt}`);
    if (desc) staticParts.push(`### Описание и предыстория\n${desc}`);
    if (personality) staticParts.push(`### Личность и характер\n${personality}`);
    if (mesExample) staticParts.push(`### Примеры диалогов\n${mesExample}`);

    const staticContent = staticParts.join("\n\n").trim() || `Карточка персонажа ${name}`;
    const mainContent = scenario ? `### Сценарий и обстановка\n${scenario}` : "Основной контекст персонажа и текущие отношения.";

    return {
      name,
      avatar: tavernChar.avatar || "",
      firstMessage: firstMes,
      firstMessageRole: "char",
      timeline: deepClone(DEFAULT_TIMELINE),
      blocks: [
        {
          key: "static",
          name: "Static",
          content: staticContent,
          originalContent: staticContent,
          isStatic: true,
        },
        {
          key: "main",
          name: "Main",
          content: mainContent,
          originalContent: mainContent,
          isStatic: false,
        },
        {
          key: "appearance",
          name: "Appearance",
          content: "",
          originalContent: "",
          isStatic: false,
        },
        {
          key: "inventory",
          name: "Inventory",
          content: "",
          originalContent: "",
          isStatic: false,
        },
      ],
    };
  }

  if (!rawInput) return null;

  // 1. Если передан объект или JSON
  let parsed = null;
  if (typeof rawInput === "object") {
    parsed = rawInput;
  } else if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {}
    }
  }

  if (parsed && typeof parsed === "object") {
    if (parsed.type === "elap_character" && parsed.character) {
      return parsed.character;
    }
    if (parsed.name && Array.isArray(parsed.blocks)) {
      return parsed;
    }
    const d = parsed.data || (parsed.character && typeof parsed.character === "object" ? parsed.character : parsed);
    if (d.name || d.description || d.personality || d.first_mes || d.first_message || d.scenario) {
      const name = d.name || parsed.name || "Imported Character";
      const desc = d.description || "";
      const personality = d.personality || "";
      const scenario = d.scenario || "";
      const firstMes = d.first_mes || d.first_message || d.initial_message || "";
      const mesExample = d.mes_example || d.example_dialogue || "";
      const sysPrompt = d.system_prompt || "";

      const staticParts = [];
      if (sysPrompt) staticParts.push(`### Инструкции\n${sysPrompt}`);
      if (desc) staticParts.push(`### Описание\n${desc}`);
      if (personality) staticParts.push(`### Личность\n${personality}`);
      if (mesExample) staticParts.push(`### Примеры речи\n${mesExample}`);

      const staticContent = staticParts.join("\n\n").trim() || `Карточка персонажа ${name}`;
      const mainContent = scenario ? `### Сценарий и обстановка\n${scenario}` : "Основной контекст персонажа и текущие отношения.";

      return {
        name,
        avatar: parsed.avatar || d.avatar || "",
        firstMessage: firstMes,
        firstMessageRole: "char",
        timeline: deepClone(DEFAULT_TIMELINE),
        blocks: [
          {
            key: "static",
            name: "Static",
            content: staticContent,
            originalContent: staticContent,
            isStatic: true,
          },
          {
            key: "main",
            name: "Main",
            content: mainContent,
            originalContent: mainContent,
            isStatic: false,
          },
          {
            key: "appearance",
            name: "Appearance",
            content: "",
            originalContent: "",
            isStatic: false,
          },
          {
            key: "inventory",
            name: "Inventory",
            content: "",
            originalContent: "",
            isStatic: false,
          },
        ],
      };
    }
  }

  // 2. Текстовый парсинг карточки (Janitor / Chub / W++ / Markdown)
  const text = String(rawInput || "").trim();
  if (!text) return null;

  let name = "";
  let firstMessage = "";
  let personality = "";
  let appearance = "";
  let scenario = "";
  let description = "";
  let inventory = "";
  const otherLines = [];

  const wppMatch = text.match(/\[Character\s*\(\s*["']([^"']+)["']\s*\)/i);
  if (wppMatch) {
    name = wppMatch[1].trim();
  }

  const sectionRegex = /(?:^|\n)(?:[#*_\s<]*)(name|имя|character|greeting|first\s*message|первое\s*сообщение|начальное\s*сообщение|initial\s*message|personality|личность|характер|appearance|внешность|scenario|сценарий|обстановка|setting|description|описание|биография|about|inventory|инвентарь|вещи|items)(?:[#*_\s>]*)(?::|=|-|>|\n)\s*/gi;

  const matches = [];
  let match;
  while ((match = sectionRegex.exec(text)) !== null) {
    matches.push({
      header: match[1].toLowerCase().replace(/\s+/g, "_"),
      index: match.index,
      fullLength: match[0].length,
    });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const start = m.index + m.fullLength;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      let content = text.slice(start, end).trim();
      content = content.replace(/<\/[^>]+>$/i, "").trim();

      const h = m.header;
      if (h === "name" || h === "имя" || h === "character") {
        if (!name) name = content.split("\n")[0].replace(/^["'(\[]+|["')\]]+$/g, "").trim();
      } else if (
        h === "first_message" ||
        h === "greeting" ||
        h === "первое_сообщение" ||
        h === "начальное_сообщение" ||
        h === "initial_message"
      ) {
        firstMessage = content;
      } else if (h === "personality" || h === "личность" || h === "характер") {
        personality = content;
      } else if (h === "appearance" || h === "внешность") {
        appearance = content;
      } else if (h === "scenario" || h === "сценарий" || h === "обстановка" || h === "setting") {
        scenario = content;
      } else if (h === "description" || h === "описание" || h === "биография" || h === "about") {
        description = content;
      } else if (h === "inventory" || h === "инвентарь" || h === "вещи" || h === "items") {
        inventory = content;
      } else {
        otherLines.push(content);
      }
    }
  } else {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!name && lines.length > 0 && lines[0].length < 40 && !lines[0].includes(":") && !lines[0].startsWith("*")) {
      name = lines[0].replace(/^#+\s*/, "");
      description = lines.slice(1).join("\n\n");
    } else {
      description = text;
    }
  }

  if (!name) {
    name = "Imported Character";
  }

  const staticParts = [];
  if (description) staticParts.push(`### Описание\n${description}`);
  if (personality) staticParts.push(`### Личность и характер\n${personality}`);
  if (otherLines.length) staticParts.push(otherLines.join("\n\n"));

  const staticContent = staticParts.join("\n\n").trim() || `Карточка персонажа ${name}`;
  const mainContent = scenario ? `### Сценарий и обстановка\n${scenario}` : "Основной контекст персонажа и текущие отношения.";

  return {
    name,
    avatar: "",
    firstMessage: firstMessage.trim(),
    firstMessageRole: "char",
    timeline: deepClone(DEFAULT_TIMELINE),
    blocks: [
      {
        key: "static",
        name: "Static",
        content: staticContent,
        originalContent: staticContent,
        isStatic: true,
      },
      {
        key: "main",
        name: "Main",
        content: mainContent,
        originalContent: mainContent,
        isStatic: false,
      },
      {
        key: "appearance",
        name: "Appearance",
        content: appearance ? `### Внешность\n${appearance}` : "",
        originalContent: appearance ? `### Внешность\n${appearance}` : "",
        isStatic: false,
      },
      {
        key: "inventory",
        name: "Inventory",
        content: inventory ? `### Инвентарь и снаряжение\n${inventory}` : "",
        originalContent: inventory ? `### Инвентарь и снаряжение\n${inventory}` : "",
        isStatic: false,
      },
    ],
  };
}

export function importCharacterFromJson(rawJson) {
  try {
    const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
    if (!parsed) throw new Error("Пустой или невалидный JSON");

    const s = S();
    let importedCount = 0;

    const processSingleChar = (charData) => {
      if (!charData || typeof charData !== "object") return;
      const newChar = {
        id: genId(),
        name: String(charData.name || "Imported Character"),
        avatar: String(charData.avatar || "").trim(),
        chatId: null,
        firstMessage: String(charData.firstMessage || ""),
        firstMessageRole: String(charData.firstMessageRole || "char"),
        timeline: charData.timeline ? deepClone(charData.timeline) : deepClone(DEFAULT_TIMELINE),
        events: Array.isArray(charData.events) ? deepClone(charData.events) : [],
        blocks: Array.isArray(charData.blocks) && charData.blocks.length ? deepClone(charData.blocks) : deepClone(DEFAULT_BLOCKS),
        days: Array.isArray(charData.days) && charData.days.length ? deepClone(charData.days) : deepClone(DEFAULT_DAYS),
      };

      newChar.blocks = newChar.blocks.map((b) => ({
        key: sanitizeKey(b.key || b.name || "block"),
        name: String(b.name || b.key || "Block"),
        content: String(b.content || ""),
        originalContent: String(b.originalContent !== undefined && b.originalContent !== null ? b.originalContent : (b.content || "")),
        isStatic: !!b.isStatic || sanitizeKey(b.key || "").toLowerCase() === "static",
      }));
      newChar.blocks = ensureUniqueKeys(newChar.blocks, "key", "block");

      newChar.days = newChar.days.map((d, idx) => ({
        id: String(d.id || genId()),
        key: sanitizeKey(d.key || `day${idx + 1}`),
        name: String(d.name || `Day ${idx + 1}`),
        content: String(d.content || ""),
      }));
      newChar.days = ensureUniqueKeys(newChar.days, "key", "day");

      s.characters.push(newChar);
      s.activeCharacterId = newChar.id;
      importedCount++;
    };

    if (parsed.type === "elap_characters_bundle" && Array.isArray(parsed.characters)) {
      parsed.characters.forEach(processSingleChar);
    } else if (parsed.type === "elap_character" && parsed.character) {
      processSingleChar(parsed.character);
    } else if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        if (item.name && Array.isArray(item.blocks)) {
          processSingleChar(item);
        } else {
          const ext = extractCharacterDataFromRaw(item);
          if (ext) processSingleChar(ext);
        }
      });
    } else if (parsed.name && Array.isArray(parsed.blocks)) {
      processSingleChar(parsed);
    } else {
      const ext = extractCharacterDataFromRaw(parsed);
      if (ext) processSingleChar(ext);
    }

    if (importedCount > 0) {
      save();
      return { success: true, count: importedCount };
    }
    return { success: false, error: "Не найдено персонажей для импорта" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function duplicateElapCharacter(charId) {
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return null;

  const clone = deepClone(char);
  clone.id = genId();
  clone.name = `${char.name} (Копия)`;
  clone.chatId = null;

  s.characters.push(clone);
  s.activeCharacterId = clone.id;
  save();
  return clone;
}

export function getActiveTavernModelAndApi() {
  const ctx = getContext?.();
  let model = "";
  try {
    if (typeof ctx?.getChatCompletionModel === "function") model = ctx.getChatCompletionModel();
    else if (typeof ctx?.getGeneratingModel === "function") model = ctx.getGeneratingModel();
    else if (typeof window?.getChatCompletionModel === "function") model = window.getChatCompletionModel();
  } catch (e) {}

  if (!model) {
    model =
      document.querySelector("#model_openai_select")?.value ||
      document.querySelector("#model_google_select")?.value ||
      document.querySelector("#model_openrouter_select")?.value ||
      document.querySelector("#model_claude_select")?.value ||
      document.querySelector("#custom_model_id")?.value ||
      "Active Model";
  }

  const api = ctx?.mainApi || document.querySelector("#main_api")?.value || "active";
  return { model: model || "Active Model", api: api || "active" };
}

export function resolveProfileModel(profile) {
  if (!profile) return "—";
  return (
    profile.model ||
    profile.google_model ||
    profile.google_ai_studio_model ||
    profile.openai_model ||
    profile.claude_model ||
    profile.openrouter_model ||
    profile.settings?.model ||
    profile.custom_model ||
    profile.chat_completion_model ||
    "По умолчанию"
  );
}

export function getProfileDetails(profileId) {
  if (!profileId || profileId === "__active__") {
    const active = getActiveTavernModelAndApi();
    return {
      id: "__active__",
      name: "Текущее активное подключение",
      api: active.api,
      model: active.model,
      display: `🟢 Активное подключение (${active.api} • ${active.model})`,
      hint: "Используется модель, подключенная прямо сейчас в основном меню Таверны.",
    };
  }

  const ctx = getContext?.();
  const profiles = ctx?.extensionSettings?.connectionManager?.profiles || [];
  const profile = profiles.find((p) => p.id === profileId);

  if (!profile) {
    const active = getActiveTavernModelAndApi();
    return {
      id: "__active__",
      name: "Текущее активное (авто)",
      api: active.api,
      model: active.model,
      display: "Профиль не найден",
      hint: "Выбранный профиль не найден.",
    };
  }

  const model = resolveProfileModel(profile);
  const api = profile.api || "default";

  return {
    id: profile.id,
    name: profile.name || "Без названия",
    api,
    model,
    display: `${profile.name} (${api} • ${model})`,
    hint: "Сохраненный снимок профиля.",
  };
}

export function findBlockByKeyOrName(char, keyOrName) {
  if (!char || !Array.isArray(char.blocks)) return null;
  const target = sanitizeKey(keyOrName).toLowerCase().trim();

  let found = char.blocks.find((b) => sanitizeKey(b.key).toLowerCase() === target);
  if (found) return found;

  found = char.blocks.find((b) => sanitizeKey(b.name).toLowerCase() === target);
  if (found) return found;

  return null;
}

export function ensureCharactersState() {
  const s = S();
  if (!Array.isArray(s.characters)) s.characters = [];

  if (!s.chessPresetSeeded) {
    const hasChess = s.characters.some(
      (c) => c && (String(c.id) === "char_chess" || String(c.name).trim().toLowerCase() === "шахматы")
    );
    if (!hasChess) {
      s.characters.push(deepClone(DEFAULT_CHESS_CHARACTER));
      if (!s.activeCharacterId) {
        s.activeCharacterId = "char_chess";
      }
    }
    s.chessPresetSeeded = true;
    save();
  }

  for (let i = 0; i < s.characters.length; i++) {
    const c = s.characters[i];
    if (!c || typeof c !== "object") continue;

    c.id = String(c.id || genId());
    c.name = String(c.name || "Unnamed");
    c.chatId = c.chatId ? String(c.chatId) : null;
    c.firstMessage = String(c.firstMessage || "");
    c.firstMessageRole = String(c.firstMessageRole || "char");

    if (!c.timeline || typeof c.timeline !== "object") {
      c.timeline = deepClone(DEFAULT_TIMELINE);
    } else {
      c.timeline = {
        enabled: c.timeline.enabled !== false,
        day: parseInt(c.timeline.day) || 1,
        unitName: String(c.timeline.unitName || "Day"),
        useCustomUnit: !!c.timeline.useCustomUnit,
        date: String(c.timeline.date || DEFAULT_TIMELINE.date),
        time: String(c.timeline.time || DEFAULT_TIMELINE.time),
        period: String(c.timeline.period || DEFAULT_TIMELINE.period),
        weather: String(c.timeline.weather || DEFAULT_TIMELINE.weather),
        format: String(c.timeline.format || DEFAULT_TIMELINE.format),
      };
    }

    if (!Array.isArray(c.events)) c.events = [];

    if (!Array.isArray(c.blocks) || !c.blocks.length) {
      c.blocks = deepClone(DEFAULT_BLOCKS);
    } else {
      c.blocks.forEach((b) => {
        b.key = sanitizeKey(b?.key || b?.name || "block");
        b.name = String(b?.name || b?.key || "Block");
        b.content = String(b?.content || "");
        b.originalContent = b.originalContent !== undefined ? String(b.originalContent) : b.content;
        b.isStatic = !!b.isStatic || sanitizeKey(b?.key || "").toLowerCase() === "static";
      });
    }

    const hasStatic = c.blocks.some((b) => b.key.toLowerCase() === "static" || b.isStatic);
    if (!hasStatic) {
      c.blocks.unshift({
        key: "static",
        name: "Static",
        content: "",
        originalContent: "",
        isStatic: true,
      });
    }
    c.blocks = ensureUniqueKeys(c.blocks, "key", "block");

    if (!Array.isArray(c.days) || !c.days.length) {
      c.days = deepClone(DEFAULT_DAYS);
    } else {
      c.days.forEach((d, idx) => {
        d.id = String(d?.id || `day_${idx + 1}`);
        d.key = sanitizeKey(d?.key || `day${idx + 1}`);
        d.name = String(d?.name || `Day ${idx + 1}`);
        d.content = String(d?.content || "");
      });
    }
    c.days = ensureUniqueKeys(c.days, "key", "day");
  }

  if (s.activeCharacterId && !s.characters.find((x) => String(x.id) === String(s.activeCharacterId))) {
    s.activeCharacterId = s.characters[0]?.id || null;
  }

  if (!Array.isArray(s.worldCards) || s.worldCards.length === 0) {
    s.worldCards = getWorldCards();
  }
  if (!Array.isArray(s.activeCardIds)) {
    s.activeCardIds = [];
  }
  ensureDecksAndCardsState();
}

/**
 * Добавить или сбросить персонажа 'Шахматы' к начальной доске
 */
export function addOrResetChessCharacter() {
  const s = S();
  if (!Array.isArray(s.characters)) s.characters = [];
  const existingIdx = s.characters.findIndex(
    (c) => c && (String(c.id) === "char_chess" || String(c.name).trim().toLowerCase() === "шахматы")
  );
  const chessChar = deepClone(DEFAULT_CHESS_CHARACTER);
  if (existingIdx !== -1) {
    chessChar.id = s.characters[existingIdx].id || "char_chess";
    s.characters[existingIdx] = chessChar;
  } else {
    s.characters.push(chessChar);
  }
  s.activeCharacterId = chessChar.id;
  s.chessPresetSeeded = true;
  save();
  ensureCharactersState();
  return chessChar;
}

/**
 * Получение всех колод карточек мира
 */
export function getWorldDecks() {
  const s = S();
  if (!Array.isArray(s.worldDecks) || s.worldDecks.length === 0) {
    s.worldDecks = deepClone(DEFAULT_WORLD_DECKS);
    save();
  }
  return s.worldDecks;
}

/**
 * Сохранение списка колод
 */
export function saveWorldDecks(decks) {
  const s = S();
  s.worldDecks = Array.isArray(decks) ? decks : [];
  save();
}

/**
 * Получение колоды по ID
 */
export function getDeckById(deckId) {
  if (!deckId) return null;
  const decks = getWorldDecks();
  return decks.find((d) => String(d.id).toLowerCase() === String(deckId).toLowerCase()) || null;
}

/**
 * Создание или обновление колоды
 */
export function upsertDeck(deck) {
  if (!deck || typeof deck !== "object") return null;
  const decks = getWorldDecks();

  if (!deck.id) {
    const rawId = deck.name ? sanitizeKey(deck.name).toLowerCase() : "";
    deck.id = rawId ? `deck_${rawId}` : `deck_${genId().slice(0, 8)}`;
  }

  const cleanId = sanitizeKey(deck.id).toLowerCase();
  const existingIdx = decks.findIndex((d) => String(d.id).toLowerCase() === cleanId);

  const cleanDeck = {
    id: cleanId,
    name: String(deck.name || "Новая колода").trim(),
    description: String(deck.description || "").trim(),
    avatar: String(deck.avatar || "fa-solid fa-layer-group").trim(),
    color: String(deck.color || "#6366f1").trim(),
    enabled: deck.enabled !== false,
  };

  if (existingIdx >= 0) {
    decks[existingIdx] = cleanDeck;
  } else {
    decks.push(cleanDeck);
  }

  saveWorldDecks(decks);
  return cleanDeck;
}

/**
 * Удаление колоды и перераспределение карточек
 */
export function deleteDeck(deckId, fallbackDeckId = null) {
  if (!deckId) return;
  const s = S();
  let decks = getWorldDecks();
  decks = decks.filter((d) => String(d.id).toLowerCase() !== String(deckId).toLowerCase());
  saveWorldDecks(decks);

  if (Array.isArray(s.worldCards)) {
    const targetFallback = fallbackDeckId || decks[0]?.id || "deck_general";
    s.worldCards.forEach((c) => {
      if (String(c.deckId).toLowerCase() === String(deckId).toLowerCase()) {
        c.deckId = targetFallback;
      }
    });
    save();
  }
}

/**
 * Обеспечение целостности структуры колод и карточек
 */
export function ensureDecksAndCardsState() {
  const s = S();
  if (!Array.isArray(s.worldDecks) || s.worldDecks.length === 0) {
    s.worldDecks = deepClone(DEFAULT_WORLD_DECKS);
  }

  if (Array.isArray(s.worldCards) && s.worldCards.length > 0) {
    const defaultDeckId = s.worldDecks[0]?.id || "deck_anatomy";
    for (const card of s.worldCards) {
      if (!card.deckId || !s.worldDecks.some((d) => String(d.id).toLowerCase() === String(card.deckId).toLowerCase())) {
        if (card.id === "card_catgirl_tail" || (Array.isArray(card.tags) && (card.tags.includes("хвост") || card.tags.includes("tail")))) {
          card.deckId = "deck_anatomy";
        } else if (card.id === "card_vampire_sunlight" || (Array.isArray(card.tags) && (card.tags.includes("vampire") || card.tags.includes("солнце")))) {
          card.deckId = "deck_rules";
        } else if (card.id === "card_severe_frost" || (Array.isArray(card.tags) && (card.tags.includes("мороз") || card.tags.includes("холод")))) {
          card.deckId = "deck_environment";
        } else {
          card.deckId = defaultDeckId;
        }
      }
    }
  }
}

export function getElapCharacters() {
  ensureCharactersState();
  return S().characters;
}

export function getActiveElapCharacter() {
  ensureCharactersState();
  const s = S();
  return s.characters.find((c) => String(c.id) === String(s.activeCharacterId)) || null;
}

export function setActiveElapCharacter(id) {
  const s = S();
  s.activeCharacterId = id;
  save();
}

export function getBlockContent(blockKey, characterIdOrObj = null) {
  const s = S();
  let targetChar = typeof characterIdOrObj === "string" 
    ? s.characters.find((c) => String(c.id) === String(characterIdOrObj))
    : (characterIdOrObj || getActiveElapCharacter());

  if (!targetChar || !Array.isArray(targetChar.blocks)) return "";
  const block = findBlockByKeyOrName(targetChar, blockKey);
  return block ? String(block.content || "") : "";
}

export function getDayContent(dayKey, characterIdOrObj = null) {
  const s = S();
  let targetChar = typeof characterIdOrObj === "string"
    ? s.characters.find((c) => String(c.id) === String(characterIdOrObj))
    : (characterIdOrObj || getActiveElapCharacter());

  if (!targetChar || !Array.isArray(targetChar.days)) return "";
  const target = String(dayKey || "").trim().toLowerCase();
  const day = targetChar.days.find(
    (d) => sanitizeKey(d.key).toLowerCase() === target || sanitizeKey(d.name).toLowerCase() === target
  );
  return day ? String(day.content || "") : "";
}

export function buildElapPromptFromCharacter(ch, currentSwipeId = 0) {
  if (!ch) return "";
  const s = S();
  const liveChar = s.characters.find((c) => String(c.id) === String(ch.id)) || ch;

  const lines = [];
  lines.push(`[ELAP_CHARACTER: ${liveChar.name}]`);

  if (s.timelineEnabled !== false && s.timelineIncludeInPrompt !== false) {
    const tlHeader = formatTimelineHeader(liveChar);
    if (tlHeader) {
      lines.push(`### [CURRENT_TIMELINE]`);
      lines.push(`Текущее игровое время и обстановка: ${tlHeader}`);
      lines.push("");
    }
  }

  // Инжект активных событий дня
  const eventsPrompt = buildActiveEventsPrompt(liveChar, currentSwipeId);
  if (eventsPrompt) {
    lines.push(eventsPrompt);
  }

  // Инжект активных карточек и ограничений мира
  if (s.cardsEnabled !== false && s.cardsAutoInjectActive !== false) {
    const cardsPrompt = buildActiveCardsPrompt();
    if (cardsPrompt) {
      lines.push(cardsPrompt);
      lines.push("");
    }
  }

  for (const b of liveChar.blocks || []) {
    const key = sanitizeKey(b.key || b.name);
    const content = String(b.content || "").trim();
    lines.push(`### [${key}]`);
    lines.push(content);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function buildDaysPromptFromCharacter(ch) {
  if (!ch) return "";
  const s = S();
  const liveChar = s.characters.find((c) => String(c.id) === String(ch.id)) || ch;
  if (!Array.isArray(liveChar.days)) return "";

  const filledDays = liveChar.days.filter((d) => d && String(d.content || "").trim().length > 0);
  if (!filledDays.length) return "";

  const lines = [];
  lines.push(`[COMPLETED_DAYS: ${liveChar.name}]`);
  for (const d of filledDays) {
    const title = d.name || d.key || "Day";
    const content = String(d.content || "").trim();
    lines.push(`### [${title}]`);
    lines.push(content);
    lines.push("");
  }
  return lines.join("\n").trim();
}