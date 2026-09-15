import { getContext } from "/scripts/extensions.js";
import {
  S,
  save,
  esc,
  deepClone,
  genId,
  sanitizeKey,
  downloadJsonFile,
  getActiveElapCharacter,
  getBlockContent,
  getWorldDecks,
  saveWorldDecks,
  getDeckById,
  upsertDeck,
  deleteDeck,
  ensureDecksAndCardsState,
} from "./state.js";
import { createElapOverlay, elapModalShell, bindModalCloseX } from "./ui.js";
import { registerAllElapMacros } from "./macros.js";
import { sendAgentRequest, extractJsonFromText, getConnectionProfiles } from "./agent.js";

/**
 * Стартовый пак демонстрационных карточек мира
 */
export const DEFAULT_WORLD_CARDS = [
  {
    id: "card_catgirl_tail",
    deckId: "deck_anatomy",
    name: "Анатомия хвоста: положение лежа на спине",
    type: "CONSTRAINT",
    tags: ["хвост", "tail", "позы", "лежа", "спина"],
    summary: "Персонажи с хвостом (зверолюди, львицы, кошачьи и др.) не могут комфортно лежать прямо на спине — это сдавливает основание хвоста и причиняет боль. Требуется опора на бок или живот.",
    content: "[ELAP DIRECTIVE: АНАТОМИЯ ХВОСТА]\nУ персонажа физический чувствительный хвост у основания позвоночника. Персонаж НЕ МОЖЕТ комфортно лежать прямо на спине — давление тела на хвост вызывает дискомфорт и боль. В сцене персонаж рефлекторно выгибается, пытается перекатиться на бок или живот, физически реагируя на неудобство позы.",
    enabled: true,
    scope: "global",
  },
  {
    id: "card_vampire_sunlight",
    deckId: "deck_rules",
    name: "Правило уязвимости к солнечному свету",
    type: "RULE",
    tags: ["vampire", "солнце", "уязвимость", "день"],
    summary: "Прямой солнечный свет наносит ожоги и ослепляет, требует плотной одежды или тени.",
    content: "[ELAP DIRECTIVE: ПРАВИЛО СОЛНЕЧНОГО СВЕТА]\nПрямые солнечные лучи вызывают сильное жжение и дымление кожи персонажа-вампира в течение нескольких секунд. Персонаж обязан избегать открытых лучей, держаться в густой тени зданий или использовать зонт/плотный плащ с капюшоном. Свет сквозь плотные шторы безопасен, но вызывает дискомфорт глаз.",
    enabled: true,
    scope: "global",
  },
  {
    id: "card_severe_frost",
    deckId: "deck_environment",
    name: "Пронизывающий мороз и переохлаждение",
    type: "LOCATION",
    tags: ["погода", "холод", "зима", "выживание"],
    summary: "Суровый мороз отнимает силы, пар изо рта, обморожение пальцев без перчаток за 15 минут.",
    content: "[ELAP DIRECTIVE: ОКРУЖЕНИЕ — ЛЮТЫЙ ХОЛОД]\nТемпература опустилась далеко ниже нуля. Дыхание мгновенно вырывается густым белым паром, металлические предметы липнут к коже. Без перчаток и теплой обуви пальцы быстро немеют, персонажи инстинктивно прячут руки в карманы, жмутся к источникам тепла и стучат зубами.",
    enabled: false,
    scope: "global",
  },
];

/**
 * Парсинг карточек из формата JSONL (JSON Lines)
 */
export function parseCardsFromJsonl(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("#"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Преобразование массива карточек в формат JSONL
 */
export function stringifyCardsToJsonl(cards) {
  if (!Array.isArray(cards)) return "";
  return cards.map((c) => JSON.stringify(c)).join("\n") + "\n";
}

/**
 * Загрузка дефолтных карточек из отдельного файла cards.jsonl
 */
export async function loadCardsFromJsonlFile() {
  try {
    const res = await fetch("/scripts/extensions/third-party/elap/cards.jsonl");
    if (!res.ok) return null;
    const text = await res.text();
    const parsed = parseCardsFromJsonl(text);
    return parsed.length ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * Синхронизация локальных карточек с файлом cards.jsonl
 */
export async function syncCardsWithJsonlFile(force = false) {
  const s = S();
  if (!force && Array.isArray(s.worldCards) && s.worldCards.length > 0) {
    return false;
  }
  const fileCards = await loadCardsFromJsonlFile();
  if (Array.isArray(fileCards) && fileCards.length > 0) {
    s.worldCards = fileCards;
    save();
    registerAllElapMacros();
    return true;
  }
  return false;
}

/**
 * Получение всех локальных карточек мира
 */
export function getWorldCards() {
  const s = S();
  if (!Array.isArray(s.worldCards) || s.worldCards.length === 0) {
    s.worldCards = deepClone(DEFAULT_WORLD_CARDS);
    save();
    // Асинхронно подгружаем из cards.jsonl, если файл доступен
    loadCardsFromJsonlFile().then((fileCards) => {
      if (Array.isArray(fileCards) && fileCards.length > 0) {
        const cur = S();
        if (!Array.isArray(cur.worldCards) || cur.worldCards.length === 0) {
          cur.worldCards = fileCards;
          save();
        }
      }
    });
  }
  return s.worldCards;
}

/**
 * Сохранение списка карточек
 */
export function saveWorldCards(cards) {
  const s = S();
  s.worldCards = Array.isArray(cards) ? cards : [];
  save();
}

/**
 * Получение конкретной карточки по ID
 */
export function getCardById(cardId) {
  if (!cardId) return null;
  const cards = getWorldCards();
  return cards.find((c) => String(c.id).toLowerCase() === String(cardId).toLowerCase()) || null;
}

/**
 * Создание или обновление карточки
 */
export function upsertCard(card) {
  if (!card || typeof card !== "object") return null;
  const cards = getWorldCards();

  if (!card.id) {
    const rawId = card.name ? sanitizeKey(card.name).toLowerCase() : "";
    card.id = rawId ? `card_${rawId}` : `card_${genId().slice(0, 8)}`;
  }

  // Убеждаемся в уникальности ключа при создании
  const existingIdx = cards.findIndex((c) => String(c.id).toLowerCase() === String(card.id).toLowerCase());

  const cleanCard = {
    id: sanitizeKey(card.id).toLowerCase(),
    deckId: String(card.deckId || "deck_anatomy").trim().toLowerCase(),
    name: String(card.name || "Новая карточка").trim(),
    type: String(card.type || "CONSTRAINT").toUpperCase(),
    tags: Array.isArray(card.tags)
      ? card.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
      : String(card.tags || "")
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
    summary: String(card.summary || "").trim(),
    content: String(card.content || "").trim(),
    avatar: String(card.avatar || "").trim(),
    enabled: card.enabled !== false,
    scope: card.scope || "global",
  };

  if (existingIdx >= 0) {
    cards[existingIdx] = cleanCard;
  } else {
    cards.push(cleanCard);
  }

  saveWorldCards(cards);
  registerAllElapMacros();
  return cleanCard;
}

/**
 * Удаление карточки
 */
export function deleteCard(cardId) {
  if (!cardId) return;
  const s = S();
  let cards = getWorldCards();
  cards = cards.filter((c) => String(c.id).toLowerCase() !== String(cardId).toLowerCase());
  saveWorldCards(cards);

  // Убираем из активных, если была активна
  deactivateCard(cardId);
  registerAllElapMacros();
}

/**
 * Экспорт карточек в JSON
 */
export function exportCardsToJson(specificCardId = null, specificDeckId = null) {
  const cards = getWorldCards();
  const decks = getWorldDecks();

  if (specificCardId) {
    const card = getCardById(specificCardId);
    if (!card) return false;
    downloadJsonFile(`${card.id}.elap_card.json`, {
      type: "elap_world_card",
      version: "2.0",
      card: deepClone(card),
    });
    return true;
  }

  if (specificDeckId) {
    const deck = getDeckById(specificDeckId);
    const deckCards = cards.filter((c) => String(c.deckId).toLowerCase() === String(specificDeckId).toLowerCase());
    downloadJsonFile(`${specificDeckId}_deck_bundle.json`, {
      type: "elap_world_deck_bundle",
      version: "2.0",
      deck: deepClone(deck),
      cards: deepClone(deckCards),
    });
    return true;
  }

  downloadJsonFile(`elap_world_cards_bundle_${Date.now()}.json`, {
    type: "elap_world_cards_bundle",
    version: "2.0",
    decks: deepClone(decks),
    cards: deepClone(cards),
  });
  return true;
}

/**
 * Экспорт карточек в формате JSONL (по одной строке на карточку)
 */
export function exportCardsToJsonl(specificCardId = null) {
  const cards = getWorldCards();
  const toExport = specificCardId
    ? cards.filter((c) => String(c.id).toLowerCase() === String(specificCardId).toLowerCase())
    : cards;
  const jsonlStr = stringifyCardsToJsonl(toExport);
  const blob = new Blob([jsonlStr], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = specificCardId ? `${specificCardId}.elap.jsonl` : `cards.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Импорт карточек из распарсенного JSON, JSONL или сырой строки
 */
export function importCardsFromJson(data) {
  try {
    let parsed = null;
    if (typeof data === "string") {
      const trimmed = data.trim();
      if (trimmed.includes("\n") && !trimmed.startsWith("[")) {
        const jsonlResult = parseCardsFromJsonl(trimmed);
        if (jsonlResult.length > 0) {
          parsed = jsonlResult;
        }
      }

      if (!parsed) {
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          parsed = parseCardsFromJsonl(trimmed);
        }
      }
    } else {
      parsed = data;
    }

    if (!parsed) return { success: false, error: "Пустые данные" };

    const currentCards = getWorldCards();
    let importedCount = 0;
    let importedDecksCount = 0;

    // Импорт колод, если они переданы в бандле
    if (parsed.type === "elap_world_deck_bundle" && parsed.deck) {
      upsertDeck(parsed.deck);
      importedDecksCount++;
    } else if (Array.isArray(parsed.decks)) {
      parsed.decks.forEach((d) => {
        if (d && d.name) {
          upsertDeck(d);
          importedDecksCount++;
        }
      });
    }

    const defaultDeckId = getWorldDecks()[0]?.id || "deck_anatomy";

    const processCard = (c) => {
      if (!c || typeof c !== "object" || !c.name) return;
      const targetId = c.id ? sanitizeKey(c.id).toLowerCase() : `card_${genId().slice(0, 8)}`;
      const existing = currentCards.find((x) => x.id === targetId);

      const newC = {
        id: targetId,
        deckId: String(c.deckId || defaultDeckId).trim().toLowerCase(),
        name: String(c.name || "Импортированная карточка"),
        type: String(c.type || "CONSTRAINT").toUpperCase(),
        tags: Array.isArray(c.tags)
          ? c.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
          : String(c.tags || "")
              .split(",")
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean),
        summary: String(c.summary || "").trim(),
        content: String(c.content || "").trim(),
        avatar: String(c.avatar || "").trim(),
        enabled: c.enabled !== false,
        scope: c.scope || "global",
      };

      if (existing) {
        Object.assign(existing, newC);
      } else {
        currentCards.push(newC);
      }
      importedCount++;
    };

    if (parsed.type === "elap_world_cards_bundle" && Array.isArray(parsed.cards)) {
      parsed.cards.forEach(processCard);
    } else if (parsed.type === "elap_world_deck_bundle" && Array.isArray(parsed.cards)) {
      parsed.cards.forEach(processCard);
    } else if (parsed.type === "elap_world_card" && parsed.card) {
      processCard(parsed.card);
    } else if (Array.isArray(parsed)) {
      parsed.forEach(processCard);
    } else if (parsed.name && (parsed.content || parsed.summary)) {
      processCard(parsed);
    }

    if (importedCount > 0) {
      saveWorldCards(currentCards);
      registerAllElapMacros();
      return { success: true, count: importedCount };
    }
    return { success: false, error: "Не найдено валидных карточек для импорта" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// АКТИВНЫЕ КАРТОЧКИ И ДИРЕКТИВЫ В ПРОМПТЕ
// ---------------------------------------------------------------------------

/**
 * Получить список ID активных в данный момент карточек
 */
export function getActiveCardIds() {
  const s = S();
  if (!Array.isArray(s.activeCardIds)) s.activeCardIds = [];
  return s.activeCardIds;
}

/**
 * Активация карточки (ручная, Pre-Agent или Post-Agent)
 */
export function activateCard(cardId) {
  if (!cardId) return false;
  const s = S();
  const id = String(cardId).toLowerCase().trim();
  const card = getCardById(id);
  if (!card) return false;

  const activeIds = getActiveCardIds();
  if (!activeIds.includes(id)) {
    activeIds.push(id);
    const maxActive = Math.max(1, parseInt(s.cardsMaxActiveCount) || 5);
    if (activeIds.length > maxActive) {
      const removed = activeIds.shift();
      if (s.activeCardTurns && s.activeCardTurns[removed] !== undefined) {
        delete s.activeCardTurns[removed];
      }
    }
    s.activeCardIds = activeIds;
  }

  // Сбрасываем счётчик ходов при любой активации / реактивации
  if (!s.activeCardTurns || typeof s.activeCardTurns !== "object") {
    s.activeCardTurns = {};
  }
  s.activeCardTurns[id] = 0;

  save();
  registerAllElapMacros();
  return true;
}

/**
 * Деактивация карточки
 */
export function deactivateCard(cardId) {
  if (!cardId) return false;
  const s = S();
  const id = String(cardId).toLowerCase().trim();
  const activeIds = getActiveCardIds();
  const idx = activeIds.indexOf(id);
  if (idx >= 0) {
    activeIds.splice(idx, 1);
    s.activeCardIds = activeIds;
    if (s.activeCardTurns && s.activeCardTurns[id] !== undefined) {
      delete s.activeCardTurns[id];
    }
    save();
    registerAllElapMacros();
    return true;
  }
  return false;
}

/**
 * Очистить все активные карточки
 */
export function clearActiveCards() {
  const s = S();
  s.activeCardIds = [];
  s.activeCardTurns = {};
  save();
  registerAllElapMacros();
}

/**
 * Учёт жизненного цикла активных карточек после каждого ответа модели (Авто-выгрузка через N ответов)
 */
export function stepActiveCardTurns() {
  const s = S();
  if (s.cardsEnabled === false) return [];

  const expireLimit = parseInt(s.cardsAutoExpireTurns);
  if (isNaN(expireLimit) || expireLimit <= 0) return [];

  if (!s.activeCardTurns || typeof s.activeCardTurns !== "object") {
    s.activeCardTurns = {};
  }

  const activeIds = getActiveCardIds();
  const expired = [];

  for (const id of [...activeIds]) {
    const currentTurns = (parseInt(s.activeCardTurns[id]) || 0) + 1;
    s.activeCardTurns[id] = currentTurns;

    if (currentTurns >= expireLimit) {
      deactivateCard(id);
      expired.push(id);
    }
  }

  if (expired.length > 0) {
    save();
    registerAllElapMacros();
    console.log(`[ELAP] ⏱️ Авто-выгрузка карточек после ${expireLimit} ответов:`, expired);
  }

  return expired;
}

/**
 * Сборка блока активных карточек для передачи в системный промпт основной модели
 */
export function buildActiveCardsPrompt() {
  const s = S();
  if (s.cardsEnabled === false) return "";

  const activeIds = getActiveCardIds();
  if (!activeIds.length) return "";

  const allCards = getWorldCards();
  const activeCards = allCards.filter((c) => activeIds.includes(c.id.toLowerCase()));
  if (!activeCards.length) return "";

  const lines = ["### [ELAP: АКТИВНЫЕ ДИРЕКТИВЫ И ОГРАНИЧЕНИЯ МИРА]:"];
  for (const c of activeCards) {
    const header = `[${c.type || "CONSTRAINT"}: ${c.name}]`;
    const body = c.content ? c.content.trim() : c.summary;
    lines.push(`- ${header}\n${body}`);
  }
  lines.push("");

  return lines.join("\n").trim();
}

/**
 * Быстрый семантический Pre-Agent для карточек мира (0% регексов, 100% чистый LLM)
 * Запускается ПЕРЕД генерацией ответа модели на отдельном профиле подключения (например, Gemma 31B или локалка).
 */
export async function runPreAgentForCards(userMessageText) {
  const s = S();
  if (s.cardsEnabled === false || s.cardsPreAgentEnabled === false) return [];

  const text = String(userMessageText || "").trim();
  if (!text) return [];

  const decks = getWorldDecks();
  const enabledDeckIds = decks.filter((d) => d.enabled !== false).map((d) => String(d.id).toLowerCase());
  const allCards = getWorldCards().filter((c) => {
    if (c.enabled === false) return false;
    if (c.deckId && !enabledDeckIds.includes(String(c.deckId).toLowerCase())) return false;
    return true;
  });
  if (!allCards.length) return [];

  const activeChar = getActiveElapCharacter();
  let charBio = "";
  if (activeChar) {
    charBio = getBlockContent("static", activeChar).trim();
  }
  if (!charBio) {
    const ctxSt = typeof getContext === "function" ? getContext() : null;
    const stChar = ctxSt?.characters?.[ctxSt?.characterId];
    if (stChar) {
      charBio = [stChar.description, stChar.personality].filter(Boolean).join("\n").trim();
    }
  }

  const cardsCatalog = buildCardsCatalogForAgent();
  if (!cardsCatalog) return [];

  const systemPrompt = `Ты — мгновенный семантический роутер правил и карточек мира (World Cards Pre-Agent).
Твоя задача: на основе свежего действия игрока, анатомии и лора персонажа определить, нужно ли прямо сейчас АКТИВИРОВАТЬ или ДЕАКТИВИРОВАТЬ карточки из каталога.

ИНСТРУКЦИИ:
1. Проанализируй ДЕЙСТВИЕ ИГРОКА и сопоставь с описанием персонажа (раса, наличие хвоста, уязвимости).
2. Если ситуация подпадает под карточку (например, персонаж с хвостом уложен на спину, начался мороз, персонаж-вампир оказался под солнцем), укажи её ID в "activate_cards": ["card_id"].
3. Если текущая ситуация отменяет ранее активную карточку (персонаж встал, ушёл в тень, согрелся), укажи в "deactivate_cards": ["card_id"].
4. Если ни одна карточка не релевантна действию, верни пустые массивы.

Ответ ОБЯЗАН быть СТРОГО валидным JSON следующего формата:
{
  "activate_cards": ["card_id"],
  "deactivate_cards": []
}

ВАЖНО: Отвечай ТОЛЬКО валидным JSON без вступительных слов и пояснений вне JSON.`;

  const userPayload = `${cardsCatalog}

### ИНФОРМАЦИЯ О ПЕРСОНАЖЕ:
${charBio || "(Обычный персонаж)"}

### СВЕЖЕЕ ДЕЙСТВИЕ ИГРОКА:
${text}

Верни JSON с массивами "activate_cards" и "deactivate_cards".`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPayload },
  ];

  const fullPrompt = `=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== USER PAYLOAD ===\n${userPayload}`;
  s.lastPreAgentPrompt = fullPrompt;
  s.lastPreAgentTime = new Date().toLocaleTimeString();

  try {
    const maxTokens = Math.max(100, parseInt(s.agentMaxTokens) || 2500);
    const profileId = s.cardsConnectionProfile || s.connectionProfile || "__active__";
    const rawResponse = await sendAgentRequest(
      messages,
      maxTokens,
      null,
      null,
      profileId
    );

    const rawText = typeof rawResponse === "string" ? rawResponse : (rawResponse?.content || JSON.stringify(rawResponse, null, 2) || "(Пустой ответ)");
    s.lastPreAgentRawResponse = rawText;

    if (!rawResponse) {
      s.lastPreAgentLog = `[${s.lastPreAgentTime}] Pre-Agent: получен пустой ответ от API (профиль: ${profileId})`;
      save();
      return [];
    }

    const parsed = extractJsonFromText(rawResponse);
    const toActivate = Array.isArray(parsed?.activate_cards) ? parsed.activate_cards : [];
    const toDeactivate = Array.isArray(parsed?.deactivate_cards) ? parsed.deactivate_cards : [];
    const changed = [];

    for (const rawId of toActivate) {
      const cleanId = String(rawId || "").trim().toLowerCase();
      if (cleanId && activateCard(cleanId)) {
        changed.push(cleanId);
      }
    }

    for (const rawId of toDeactivate) {
      const cleanId = String(rawId || "").trim().toLowerCase();
      if (cleanId && deactivateCard(cleanId)) {
        // деактивировано
      }
    }

    const logLines = [];
    logLines.push(`[${s.lastPreAgentTime}] Pre-Agent (Роутер карточек)`);
    logLines.push(`Профиль: ${profileId}`);
    logLines.push(`Действие игрока: "${text.slice(0, 120)}${text.length > 120 ? '...' : ''}"`);
    if (parsed) {
      if (toActivate.length > 0) {
        logLines.push(`Запрос на активацию: [${toActivate.join(", ")}]`);
        logLines.push(`Успешно активировано в ELAP: [${changed.join(", ") || "ни одной (проверьте ID)"}]`);
      } else {
        logLines.push(`Запрос на активацию: (карточки не требуются)`);
      }
      if (toDeactivate.length > 0) {
        logLines.push(`Деактивировано: [${toDeactivate.join(", ")}]`);
      }
    } else {
      logLines.push(`❌ Ошибка: модель не вернула валидный JSON (см. сырой ответ).`);
    }

    s.lastPreAgentLog = logLines.join("\n");
    save();

    if (changed.length > 0) {
      registerAllElapMacros();
    }

    return changed;
  } catch (err) {
    console.warn("[ELAP] Pre-Agent error for cards:", err);
    s.lastPreAgentLog = `[${new Date().toLocaleTimeString()}] ❌ Ошибка выполнения Pre-Agent: ${err.message}`;
    save();
    return [];
  }
}

/**
 * Сборка ультра-компактного каталога метаданных для Агента (Zero-bloat)
 */
export function buildCardsCatalogForAgent() {
  const s = S();
  if (s.cardsEnabled === false) return "";

  const decks = getWorldDecks();
  const enabledDeckIds = decks.filter((d) => d.enabled !== false).map((d) => String(d.id).toLowerCase());
  const allCards = getWorldCards().filter((c) => {
    if (c.enabled === false) return false;
    if (c.deckId && !enabledDeckIds.includes(String(c.deckId).toLowerCase())) return false;
    return true;
  });
  if (!allCards.length) return "";

  const activeIds = getActiveCardIds();
  const lines = [
    "### КАТАЛОГ ПРАВИЛ И ОГРАНИЧЕНИЙ МИРА (WORLD CARDS CATALOG):",
    "ИНСТРУКЦИЯ ДЛЯ АГЕНТА: Если в описании персонажа есть особенности (например, хвост, зверолюд, уязвимость к свету) или в чате происходят действия из карточки (поза на спине, выход на мороз), ты ОБЯЗАН активировать карточку, добавив её ID в \"activate_cards\": [\"id_карточки\"].",
    "Список карточек:",
  ];

  for (const c of allCards) {
    const isActive = activeIds.includes(c.id.toLowerCase());
    const tagsStr = Array.isArray(c.tags) && c.tags.length ? ` [теги: ${c.tags.join(", ")}]` : "";
    const activeMarker = isActive ? " [УЖЕ АКТИВНА]" : "";
    const summary = c.summary ? ` — ${c.summary}` : "";
    lines.push(`- ID: "${c.id}" | ${c.name}${tagsStr}${activeMarker}${summary}`);
  }

  lines.push("");
  return lines.join("\n").trim();
}

/**
 * Симуляция чтения карточки Агентом (Тестовый вызов для Дебаггера)
 */
export async function simulateAgentCardRead(cardId, userNote = "") {
  const card = getCardById(cardId);
  if (!card) throw new Error("Карточка не найдена");

  const prompt = `Ты — Агент мира ELAP. Твоя задача — изучить карточку мира и определить, как её правила должны быть применены к текущей ситуации или персонажу.
Карточка:
- ID: ${card.id}
- Название: ${card.name}
- Тип: ${card.type}
- Содержание:
${card.content || card.summary}

${userNote ? `Контекст / Вопрос пользователя: ${userNote}` : ""}

Верни строго JSON следующего формата:
{
  "relevant": true,
  "reasoning": "Пояснение, почему и как карточка применяется...",
  "directive": "Сформулированная директива для основной модели (1-3 предложения)..."
}`;

  const messages = [
    { role: "system", content: "Ты аналитический движок ролевых директив. Отвечай только валидным JSON." },
    { role: "user", content: prompt },
  ];

  const raw = await sendAgentRequest(messages, 800, null, null);
  const parsed = extractJsonFromText(raw);
  return { raw, parsed };
}

// ---------------------------------------------------------------------------
// ПОЛЬЗОВАТЕЛЬСКИЙ ИНТЕРФЕЙС (UI КОЛОД И КАРТОЧЕК МИРА)
// ---------------------------------------------------------------------------

/**
 * Хелпер для рендеринга аватарки колоды (FA иконка или изображение)
 */
export function renderDeckAvatarHtml(deck) {
  if (!deck) return `<div class="elap-deck-avatar"><i class="fa-solid fa-layer-group"></i></div>`;
  const av = String(deck.avatar || "fa-solid fa-layer-group").trim();
  const accent = deck.color || "#6366f1";
  const style = `--deck-accent:${esc(accent)}; --deck-accent-glow:${esc(accent)}33;`;

  if (av.startsWith("data:image") || av.startsWith("http://") || av.startsWith("https://") || av.startsWith("/")) {
    return `<div class="elap-deck-avatar" style="${style}"><img src="${esc(av)}" alt="${esc(deck.name)}"></div>`;
  }
  return `<div class="elap-deck-avatar" style="${style}"><i class="${esc(av)}"></i></div>`;
}

/**
 * Главное окно управления Колодами и Карточками Мира (Cards & Decks Manager)
 */
export function openCardsManagerModal() {
  const overlay = createElapOverlay("elap_cards_manager_overlay");
  let activeDeckId = null; // null = список колод, "id" = карточки колоды, "__all__" = все карточки
  let searchQuery = "";
  let filterType = "ALL";

  const renderContent = () => {
    const s = S();
    ensureDecksAndCardsState();
    const decks = getWorldDecks();
    const cards = getWorldCards();
    const activeIds = getActiveCardIds();

    const curDeck = activeDeckId && activeDeckId !== "__all__" ? getDeckById(activeDeckId) : null;

    overlay.innerHTML = elapModalShell(
      `<i class="fa-solid fa-layer-group" style="color:#6366f1;"></i> ELAP — Колоды и Карточки Мира (World Cards Engine)`,
      `
      <!-- ВЕРХНЯЯ ПАНЕЛЬ СИСТЕМЫ И ПАРАМЕТРОВ -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--elap-border);">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:bold; margin:0; font-size:12px;">
            <input id="elap_cards_toggle_enabled" type="checkbox" ${s.cardsEnabled !== false ? "checked" : ""}>
            <span>Включить систему карточек</span>
          </label>
          <span style="font-size:11.5px; color:var(--elap-text-dim);">| Колоды: <b>${decks.length}</b> • Карточки: <b>${cards.length}</b></span>
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <button id="elap_cards_btn_create_deck" class="elap-btn elap-btn-purple"><i class="fa-solid fa-folder-plus"></i> Новая колода</button>
          <button id="elap_cards_btn_create_card" class="elap-btn elap-btn-success"><i class="fa-solid fa-plus"></i> Новая карточка</button>
          <button id="elap_cards_btn_debugger" class="elap-btn elap-btn-cyan"><i class="fa-solid fa-vial"></i> Дебаггер</button>
          <button id="elap_cards_btn_sync_file" class="elap-btn" title="Перезагрузить из локального файла cards.jsonl на диске"><i class="fa-solid fa-rotate"></i> cards.jsonl</button>
          <button id="elap_cards_btn_export" class="elap-btn" title="Экспорт карточек и колод в JSON"><i class="fa-solid fa-download"></i> Экспорт</button>
          <label class="elap-btn" style="margin:0; cursor:pointer; display:inline-flex; align-items:center;" title="Импортировать колоды или карточки из JSON / JSONL">
            <i class="fa-solid fa-upload"></i> Импорт <input id="elap_cards_file_import" type="file" accept=".json,.jsonl,.txt" style="display:none;">
          </label>
        </div>
      </div>

      <!-- НАСТРОЙКА PRE-AGENT И АВТО-ВЫГРУЗКИ (TTL) -->
      <div style="background:var(--elap-bg-elevated); border:1px solid var(--elap-border); border-radius:var(--elap-radius-sm); padding:10px 14px; margin-bottom:12px; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:600; margin:0; font-size:12px; color:#c7d2fe;">
            <input id="elap_cards_toggle_preagent" type="checkbox" ${s.cardsPreAgentEnabled !== false ? "checked" : ""}>
            <span><i class="fa-solid fa-bolt" style="color:#f59e0b;"></i> Pre-Agent (семантическая проверка правил ДО ответа модели)</span>
          </label>
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:6px;">
              <label style="font-size:11.5px; opacity:0.85; margin:0;">Профиль Pre-Agent:</label>
              <select id="elap_cards_select_profile" style="font-size:11.5px; padding:3px 8px; width:auto; min-width:150px;"></select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <label style="font-size:11.5px; opacity:0.85; margin:0;" title="Сколько ответов персонажа держится карточка в контексте до авто-выгрузки"><i class="fa-solid fa-clock"></i> Авто-выгрузка:</label>
              <select id="elap_cards_select_expire" style="font-size:11.5px; padding:3px 8px; width:auto;">
                <option value="1" ${parseInt(s.cardsAutoExpireTurns) === 1 ? "selected" : ""}>1 ответ (сразу после отыгрыша)</option>
                <option value="2" ${parseInt(s.cardsAutoExpireTurns) === 2 ? "selected" : ""}>2 ответа</option>
                <option value="3" ${parseInt(s.cardsAutoExpireTurns) === 3 ? "selected" : ""}>3 ответа</option>
                <option value="5" ${parseInt(s.cardsAutoExpireTurns) === 5 ? "selected" : ""}>5 ответов</option>
                <option value="0" ${parseInt(s.cardsAutoExpireTurns) === 0 ? "selected" : ""}>Отключено (вручную / агентом)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- СПИСОК АКТИВНЫХ ДИРЕКТИВ В ПРОМПТЕ -->
      <div id="elap_active_cards_bar" style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.25); border-radius:var(--elap-radius-sm); padding:8px 12px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; font-size:11.5px;">
          <span style="font-weight:700; color:#a5b4fc; margin-right:4px;"><i class="fa-solid fa-circle-dot" style="color:#10b981;"></i> Активно в промпте (${activeIds.length}):</span>
          <span id="elap_active_chips">
            ${activeIds.length ? activeIds.map((id) => {
              const c = getCardById(id);
              const turnsPlayed = (s.activeCardTurns && s.activeCardTurns[id] !== undefined) ? s.activeCardTurns[id] : 0;
              const expireTurns = parseInt(s.cardsAutoExpireTurns) || 0;
              const turnBadge = expireTurns > 0 ? `<small style="opacity:0.8;">(${turnsPlayed}/${expireTurns} отв.)</small>` : '';
              return `<span class="elap-chip-active"><span>${esc(c?.name || id)}</span> ${turnBadge} <span class="elap-chip-deact" data-deact="${esc(id)}" title="Убрать из промпта"><i class="fa-solid fa-xmark"></i></span></span>`;
            }).join("") : '<span style="color:var(--elap-text-dim); font-style:italic;">нет активных карточек</span>'}
          </span>
        </div>
        ${activeIds.length ? `<button id="elap_btn_clear_all_active" class="elap-btn elap-btn-ghost" style="font-size:10.5px; padding:3px 8px;"><i class="fa-solid fa-broom"></i> Сбросить все</button>` : ""}
      </div>

      <!-- ОСНОВНАЯ ОБЛАСТЬ: КОЛОДЫ ЛИБО КАРТОЧКИ -->
      <div id="elap_cards_main_content"></div>
      `
    );

    bindModalCloseX(overlay);

    // Тоггл системы карточек
    overlay.querySelector("#elap_cards_toggle_enabled")?.addEventListener("change", (e) => {
      s.cardsEnabled = !!e.target.checked;
      save();
      registerAllElapMacros();
      if (window.toastr) toastr.info(s.cardsEnabled ? "Система карточек включена" : "Система карточек отключена");
    });

    // Тоггл Pre-Agent
    overlay.querySelector("#elap_cards_toggle_preagent")?.addEventListener("change", (e) => {
      s.cardsPreAgentEnabled = !!e.target.checked;
      save();
      if (window.toastr) {
        toastr.info(s.cardsPreAgentEnabled ? "Pre-Agent карточек ВКЛЮЧЁН" : "Pre-Agent выключен");
      }
    });

    // Профиль Pre-Agent
    const profileSelect = overlay.querySelector("#elap_cards_select_profile");
    if (profileSelect) {
      const profiles = getConnectionProfiles();
      const curProfile = s.cardsConnectionProfile || "__active__";
      let profOpts = `<option value="__active__" ${curProfile === "__active__" ? "selected" : ""}>[Активное подключение]</option>`;
      if (profiles.length) {
        profOpts += profiles.map((p) => {
          const isSel = String(p.id) === String(curProfile);
          return `<option value="${esc(p.id)}" ${isSel ? "selected" : ""}>${esc(p.name)}</option>`;
        }).join("");
      }
      profileSelect.innerHTML = profOpts;
      profileSelect.addEventListener("change", (e) => {
        s.cardsConnectionProfile = e.target.value;
        save();
        if (window.toastr) toastr.success(`Профиль для Pre-Agent: ${e.target.options[e.target.selectedIndex]?.text}`);
      });
    }

    // Лимит авто-выгрузки
    overlay.querySelector("#elap_cards_select_expire")?.addEventListener("change", (e) => {
      s.cardsAutoExpireTurns = parseInt(e.target.value) || 0;
      save();
      renderContent();
      if (window.toastr) {
        toastr.info(s.cardsAutoExpireTurns > 0 
          ? `Авто-выгрузка карточек: через ${s.cardsAutoExpireTurns} ответ(-а)` 
          : "Авто-выгрузка карточек отключена");
      }
    });

    // Очистить активные
    overlay.querySelector("#elap_btn_clear_all_active")?.addEventListener("click", () => {
      clearActiveCards();
      renderContent();
    });

    // Удаление активных по крестику
    overlay.querySelectorAll("[data-deact]").forEach((el) => {
      el.addEventListener("click", (e) => {
        const id = e.currentTarget.getAttribute("data-deact");
        deactivateCard(id);
        renderContent();
      });
    });

    // Кнопка создания колоды
    overlay.querySelector("#elap_cards_btn_create_deck")?.addEventListener("click", () => {
      openDeckEditorModal(null, () => renderContent());
    });

    // Кнопка создания карточки
    overlay.querySelector("#elap_cards_btn_create_card")?.addEventListener("click", () => {
      openCardEditorModal(null, () => renderContent(), activeDeckId && activeDeckId !== "__all__" ? activeDeckId : null);
    });

    // Дебаггер карточек
    overlay.querySelector("#elap_cards_btn_debugger")?.addEventListener("click", () => {
      openCardDebuggerModal(() => renderContent());
    });

    // Синхронизация из cards.jsonl
    overlay.querySelector("#elap_cards_btn_sync_file")?.addEventListener("click", async () => {
      const ok = await syncCardsWithJsonlFile(true);
      if (ok) {
        if (window.toastr) toastr.success("Карточки перезагружены из файла cards.jsonl!");
        renderContent();
      } else {
        if (window.toastr) toastr.warning("Не удалось загрузить cards.jsonl");
      }
    });

    // Экспорт всех колод и карточек
    overlay.querySelector("#elap_cards_btn_export")?.addEventListener("click", () => {
      exportCardsToJson();
      if (window.toastr) toastr.success("Все колоды и карточки экспортированы!");
    });

    // Импорт карточек и колод
    overlay.querySelector("#elap_cards_file_import")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const res = importCardsFromJson(ev.target?.result);
        if (res.success) {
          if (window.toastr) toastr.success(`Импортировано карточек: ${res.count}`);
          renderContent();
        } else {
          if (window.toastr) toastr.error(`Ошибка импорта: ${res.error}`);
        }
      };
      reader.readAsText(file);
    });

    // Рендер тела (Режим Колод либо Режим Карточек)
    const mainWrap = overlay.querySelector("#elap_cards_main_content");
    if (!mainWrap) return;

    if (!activeDeckId) {
      // -------------------------------------------------------------
      // 1. ВИД: СПИСОК КОЛОД (DECKS VIEW)
      // -------------------------------------------------------------
      let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
        <div style="font-size:13px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-cubes" style="color:var(--elap-purple);"></i>
          <span>Колоды правил и лора (${decks.length})</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="elap_btn_view_all_cards" class="elap-btn elap-btn-ghost">
            <i class="fa-solid fa-list-check"></i> Все карточки без фильтра колод (${cards.length})
          </button>
        </div>
      </div>

      <div class="elap-decks-grid">
      `;

      html += decks.map((deck) => {
        const deckCards = cards.filter((c) => String(c.deckId || "").toLowerCase() === String(deck.id).toLowerCase());
        const activeInDeck = deckCards.filter((c) => activeIds.includes(c.id.toLowerCase())).length;
        const accent = deck.color || "#6366f1";

        return `
        <div class="elap-deck-card ${deck.enabled === false ? 'disabled' : ''}" style="--deck-accent: ${esc(accent)}; --deck-accent-glow: ${esc(accent)}33;" data-deck-id="${esc(deck.id)}">
          <div class="elap-deck-header">
            ${renderDeckAvatarHtml(deck)}
            <div class="elap-deck-info">
              <div class="elap-deck-title" title="${esc(deck.name)}">${esc(deck.name)}</div>
              <div class="elap-deck-id">#${esc(deck.id)}</div>
            </div>
            <label style="cursor:pointer; margin:0;" title="Включить / выключить всю колоду в игровом мире">
              <input type="checkbox" data-act="toggle-deck" data-id="${esc(deck.id)}" ${deck.enabled !== false ? "checked" : ""}>
            </label>
          </div>

          <div class="elap-deck-desc">
            ${esc(deck.description || "Без описания...")}
          </div>

          <div class="elap-deck-footer">
            <div class="elap-deck-stats">
              <span class="elap-deck-badge"><i class="fa-solid fa-layer-group"></i> ${deckCards.length}</span>
              ${activeInDeck > 0 ? `<span class="elap-deck-badge active-count"><i class="fa-solid fa-bolt"></i> ${activeInDeck} в промпте</span>` : ""}
            </div>
            <div class="elap-deck-actions">
              <button class="elap-btn elap-btn-primary" data-act="open-deck" data-id="${esc(deck.id)}">
                <i class="fa-solid fa-folder-open"></i> Открыть
              </button>
              <button class="elap-btn elap-btn-icon-only" data-act="edit-deck" data-id="${esc(deck.id)}" title="Настройки колоды">
                <i class="fa-solid fa-gear"></i>
              </button>
              <button class="elap-btn elap-btn-icon-only elap-btn-danger" data-act="delete-deck" data-id="${esc(deck.id)}" title="Удалить колоду">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        </div>
        `;
      }).join("");

      html += `</div>`;
      mainWrap.innerHTML = html;

      // Обработчики кнопок колод
      mainWrap.querySelector("#elap_btn_view_all_cards")?.addEventListener("click", () => {
        activeDeckId = "__all__";
        renderContent();
      });

      mainWrap.querySelectorAll(".elap-deck-card").forEach((cardEl) => {
        cardEl.addEventListener("click", (e) => {
          if (e.target.closest("button") || e.target.closest("input") || e.target.closest("label")) return;
          const id = cardEl.getAttribute("data-deck-id");
          if (id) {
            activeDeckId = id;
            renderContent();
          }
        });
      });

      mainWrap.querySelectorAll('[data-act="open-deck"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-id");
          activeDeckId = id;
          renderContent();
        });
      });

      mainWrap.querySelectorAll('[data-act="toggle-deck"]').forEach((cb) => {
        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          const id = cb.getAttribute("data-id");
          const targetDeck = getDeckById(id);
          if (targetDeck) {
            targetDeck.enabled = !!cb.checked;
            saveWorldDecks(decks);
            renderContent();
            if (window.toastr) {
              toastr.info(targetDeck.enabled ? `Колода «${targetDeck.name}» включена` : `Колода «${targetDeck.name}» отключена`);
            }
          }
        });
      });

      mainWrap.querySelectorAll('[data-act="edit-deck"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-id");
          openDeckEditorModal(id, () => renderContent());
        });
      });

      mainWrap.querySelectorAll('[data-act="delete-deck"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-id");
          const targetDeck = getDeckById(id);
          if (!targetDeck) return;
          if (confirm(`Удалить колоду «${targetDeck.name}»? Карточки останутся в общем каталоге.`)) {
            deleteDeck(id);
            renderContent();
          }
        });
      });

    } else {
      // -------------------------------------------------------------
      // 2. ВИД: КАРТОЧКИ ВНУТРИ КОЛОДЫ (CARDS IN DECK VIEW)
      // -------------------------------------------------------------
      const isAll = activeDeckId === "__all__";
      const deckTitle = isAll ? "Все карточки мира" : (curDeck?.name || "Колода");
      const deckAvatarHtml = isAll ? `<i class="fa-solid fa-table-list" style="color:var(--elap-primary);"></i>` : renderDeckAvatarHtml(curDeck);

      mainWrap.innerHTML = `
      <!-- ХЛЕБНЫЕ КРОШКИ -->
      <div class="elap-breadcrumbs">
        <span class="elap-crumb-link" id="elap_crumb_back_to_decks">
          <i class="fa-solid fa-arrow-left"></i> Все колоды
        </span>
        <span class="elap-crumb-separator"><i class="fa-solid fa-chevron-right"></i></span>
        <span class="elap-crumb-current">
          ${deckAvatarHtml}
          <span>${esc(deckTitle)}</span>
        </span>

        <div style="margin-left:auto; display:flex; gap:6px; align-items:center;">
          <button id="elap_btn_add_card_here" class="elap-btn elap-btn-success">
            <i class="fa-solid fa-plus"></i> Создать карточку
          </button>
          ${curDeck ? `
          <button id="elap_btn_edit_this_deck" class="elap-btn">
            <i class="fa-solid fa-gear"></i> Настройки колоды
          </button>` : ""}
        </div>
      </div>

      <!-- ФИЛЬТРЫ И ПОИСК -->
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
        <div style="flex:1; min-width:200px; position:relative;">
          <input id="elap_cards_search" type="text" value="${esc(searchQuery)}" placeholder="Поиск по названию, сводке, тегам или ID..." style="padding-left:32px;">
          <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:12px; color:var(--elap-text-dim);"></i>
        </div>
        <select id="elap_cards_filter_type" style="width:auto; min-width:140px;">
          <option value="ALL" ${filterType === "ALL" ? "selected" : ""}>Все типы</option>
          <option value="CONSTRAINT" ${filterType === "CONSTRAINT" ? "selected" : ""}>CONSTRAINT (Ограничение)</option>
          <option value="RULE" ${filterType === "RULE" ? "selected" : ""}>RULE (Правило мира)</option>
          <option value="KNOWLEDGE" ${filterType === "KNOWLEDGE" ? "selected" : ""}>KNOWLEDGE (Знание)</option>
          <option value="LOCATION" ${filterType === "LOCATION" ? "selected" : ""}>LOCATION (Локация)</option>
          <option value="NPC" ${filterType === "NPC" ? "selected" : ""}>NPC (Персонаж)</option>
        </select>
      </div>

      <!-- СПИСОК КАРТОЧЕК -->
      <div id="elap_cards_list_container" style="max-height:520px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;"></div>
      `;

      mainWrap.querySelector("#elap_crumb_back_to_decks")?.addEventListener("click", () => {
        activeDeckId = null;
        renderContent();
      });

      mainWrap.querySelector("#elap_btn_add_card_here")?.addEventListener("click", () => {
        openCardEditorModal(null, () => renderContent(), curDeck?.id || null);
      });

      mainWrap.querySelector("#elap_btn_edit_this_deck")?.addEventListener("click", () => {
        if (curDeck) openDeckEditorModal(curDeck.id, () => renderContent());
      });

      const searchInput = mainWrap.querySelector("#elap_cards_search");
      const typeFilterSelect = mainWrap.querySelector("#elap_cards_filter_type");

      const renderCardItems = () => {
        const listWrap = mainWrap.querySelector("#elap_cards_list_container");
        if (!listWrap) return;

        searchQuery = String(searchInput?.value || "").toLowerCase().trim();
        filterType = typeFilterSelect?.value || "ALL";

        const filtered = cards.filter((c) => {
          // Фильтр по колоде (если не "__all__")
          if (!isAll && String(c.deckId || "").toLowerCase() !== String(activeDeckId).toLowerCase()) {
            return false;
          }
          if (filterType !== "ALL" && c.type !== filterType) return false;
          if (!searchQuery) return true;

          const inName = String(c.name || "").toLowerCase().includes(searchQuery);
          const inId = String(c.id || "").toLowerCase().includes(searchQuery);
          const inSummary = String(c.summary || "").toLowerCase().includes(searchQuery);
          const inTags = Array.isArray(c.tags) && c.tags.some((t) => t.includes(searchQuery));
          return inName || inId || inSummary || inTags;
        });

        if (!filtered.length) {
          listWrap.innerHTML = `<div style="padding:32px; text-align:center; color:var(--elap-text-dim); font-size:12.5px;">Карточки не найдены. Создайте новую карточку в этой колоде.</div>`;
          return;
        }

        listWrap.innerHTML = filtered.map((c) => {
          const isActive = activeIds.includes(c.id.toLowerCase());
          const turnsPlayed = (s.activeCardTurns && s.activeCardTurns[c.id] !== undefined) ? s.activeCardTurns[c.id] : 0;
          const expireTurns = parseInt(s.cardsAutoExpireTurns) || 0;
          const turnBadge = expireTurns > 0 ? `(${turnsPlayed}/${expireTurns} отв.)` : '';

          const typeData = {
            CONSTRAINT: { cls: "elap-type-constraint", icon: "fa-shield-halved" },
            RULE: { cls: "elap-type-rule", icon: "fa-scale-balanced" },
            KNOWLEDGE: { cls: "elap-type-knowledge", icon: "fa-book-bookmark" },
            LOCATION: { cls: "elap-type-location", icon: "fa-map-location-dot" },
            NPC: { cls: "elap-type-npc", icon: "fa-user-tag" },
          }[c.type] || { cls: "elap-type-custom", icon: "fa-cube" };

          const parentDeck = decks.find((d) => String(d.id).toLowerCase() === String(c.deckId || '').toLowerCase());

          return `
          <div class="elap-card-row ${isActive ? 'is-active-prompt' : ''}">
            <div class="elap-card-top-bar">
              <div class="elap-card-title-wrap">
                <label style="margin:0; cursor:pointer;" title="Включена в каталог мира">
                  <input type="checkbox" data-act="toggle-catalog" data-id="${esc(c.id)}" ${c.enabled !== false ? "checked" : ""}>
                </label>
                <span class="elap-type-pill ${typeData.cls}"><i class="fa-solid ${typeData.icon}"></i> ${esc(c.type)}</span>
                <span class="elap-card-name">${esc(c.name)}</span>
                <code class="elap-card-id-code">${esc(c.id)}</code>
                ${isAll && parentDeck ? `<span class="elap-deck-badge" style="border-color:${esc(parentDeck.color || '#555')};"><i class="fa-solid fa-folder"></i> ${esc(parentDeck.name)}</span>` : ""}
                ${isActive ? `<span style="color:#34d399; font-size:11px; font-weight:700; margin-left:4px;"><i class="fa-solid fa-bolt"></i> В промпте ${turnBadge}</span>` : ""}
              </div>

              <div style="display:flex; gap:6px; align-items:center;">
                <button class="elap-btn ${isActive ? 'elap-btn-danger' : 'elap-btn-primary'}" data-act="toggle-inject" data-id="${esc(c.id)}">
                  <i class="fa-solid ${isActive ? 'fa-stop' : 'fa-play'}"></i>
                  ${isActive ? "Убрать" : "В промпт"}
                </button>
                <button class="elap-btn" data-act="edit" data-id="${esc(c.id)}" title="Редактировать">
                  <i class="fa-solid fa-pen-to-square"></i> Ред.
                </button>
                <button class="elap-btn elap-btn-icon-only" data-act="export-one" data-id="${esc(c.id)}" title="Экспорт карточки">
                  <i class="fa-solid fa-download"></i>
                </button>
                <button class="elap-btn elap-btn-icon-only elap-btn-danger" data-act="delete" data-id="${esc(c.id)}" title="Удалить карточку">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </div>

            <div class="elap-card-summary-text">
              ${esc(c.summary || "(Сводка не заполнена)")}
            </div>

            <div class="elap-card-meta-bar">
              <div>
                ${Array.isArray(c.tags) && c.tags.length ? c.tags.map((t) => `<span class="elap-tag-pill">#${esc(t)}</span>`).join("") : `<span style="font-style:italic;">Без тегов</span>`}
              </div>
              <div>
                Длина директивы: <b>${c.content ? c.content.length : 0}</b> симв.
              </div>
            </div>
          </div>
          `;
        }).join("");

        // Обработчики карточек
        listWrap.querySelectorAll('[data-act="toggle-catalog"]').forEach((cb) => {
          cb.addEventListener("change", (e) => {
            const cardId = e.target.getAttribute("data-id");
            const targetCard = getCardById(cardId);
            if (targetCard) {
              targetCard.enabled = !!e.target.checked;
              saveWorldCards(cards);
            }
          });
        });

        listWrap.querySelectorAll('[data-act="toggle-inject"]').forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const cardId = e.currentTarget.getAttribute("data-id");
            if (activeIds.includes(cardId.toLowerCase())) {
              deactivateCard(cardId);
              if (window.toastr) toastr.info(`Карточка ${cardId} убрана из промпта`);
            } else {
              activateCard(cardId);
              if (window.toastr) toastr.success(`Карточка ${cardId} загружена в активный промпт!`);
            }
            renderContent();
          });
        });

        listWrap.querySelectorAll('[data-act="edit"]').forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const cardId = e.currentTarget.getAttribute("data-id");
            openCardEditorModal(cardId, () => renderContent(), curDeck?.id || null);
          });
        });

        listWrap.querySelectorAll('[data-act="export-one"]').forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const cardId = e.currentTarget.getAttribute("data-id");
            exportCardsToJson(cardId);
          });
        });

        listWrap.querySelectorAll('[data-act="delete"]').forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const cardId = e.currentTarget.getAttribute("data-id");
            if (confirm(`Удалить карточку "${cardId}"?`)) {
              deleteCard(cardId);
              renderContent();
            }
          });
        });
      };

      searchInput?.addEventListener("input", renderCardItems);
      typeFilterSelect?.addEventListener("change", renderCardItems);
      renderCardItems();
    }
  };

  renderContent();
  document.body.appendChild(overlay);
}

/**
 * Модальное окно создания и редактирования Колоды (Deck Editor Modal)
 */
export function openDeckEditorModal(deckId = null, onSaveCallback = null) {
  const existingDeck = deckId ? getDeckById(deckId) : null;
  const isNew = !existingDeck;

  const draft = existingDeck ? deepClone(existingDeck) : {
    id: "",
    name: "",
    description: "",
    avatar: "fa-solid fa-layer-group",
    color: "#6366f1",
    enabled: true,
  };

  const overlay = createElapOverlay("elap_deck_editor_overlay");

  const presetIcons = [
    "fa-solid fa-layer-group",
    "fa-solid fa-dna",
    "fa-solid fa-scale-balanced",
    "fa-solid fa-snowflake",
    "fa-solid fa-shield-halved",
    "fa-solid fa-book-bookmark",
    "fa-solid fa-wand-magic-sparkles",
    "fa-solid fa-paw",
    "fa-solid fa-skull-crossbones",
    "fa-solid fa-heart",
    "fa-solid fa-crown",
    "fa-solid fa-dragon",
    "fa-solid fa-fire",
    "fa-solid fa-eye",
    "fa-solid fa-gem",
    "fa-solid fa-mask",
    "fa-solid fa-cloud-bolt",
    "fa-solid fa-landmark",
  ];

  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-folder-plus" style="color:var(--elap-purple);"></i> ${isNew ? "Создание новой колоды правил" : `Редактирование: «${esc(draft.name)}»`}`,
    `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <!-- Строка 1: Название и ID -->
      <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">
        <div>
          <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">Название колоды:</label>
          <input id="elap_edit_deck_name" type="text" value="${esc(draft.name)}" placeholder="Например: Анатомия и физиология">
        </div>
        <div>
          <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">ID ключа:</label>
          <input id="elap_edit_deck_id" type="text" value="${esc(draft.id)}" placeholder="deck_anatomy" ${isNew ? "" : "readonly"}>
        </div>
      </div>

      <!-- Строка 2: Описание -->
      <div>
        <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">Краткое описание колоды:</label>
        <textarea id="elap_edit_deck_desc" style="min-height:55px; height:55px; font-family:inherit; font-size:12px;" placeholder="Опишите, какие правила, физиология или ограничения содержатся в этой колоде...">${esc(draft.description)}</textarea>
      </div>

      <!-- Строка 3: Цвет акцента -->
      <div>
        <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">Цвет акцента колоды:</label>
        <div style="display:flex; align-items:center; gap:10px;">
          <input id="elap_edit_deck_color" type="color" value="${esc(draft.color || '#6366f1')}" style="width:40px; height:32px; padding:0; cursor:pointer; border:none; background:transparent;">
          <div id="elap_deck_color_swatches" style="display:flex; gap:6px;">
            ${["#ec4899", "#f59e0b", "#06b6d4", "#10b981", "#8b5cf6", "#6366f1", "#f43f5e"].map((c) => `
              <div data-color="${c}" style="width:20px; height:20px; border-radius:50%; background:${c}; cursor:pointer; border:2px solid ${draft.color === c ? '#fff' : 'transparent'}; box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>
            `).join("")}
          </div>
        </div>
      </div>

      <!-- Строка 4: Аватарка (Иконка либо Изображение) -->
      <div>
        <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">Аватарка колоды (Иконка или PNG):</label>
        <div style="display:flex; gap:12px; align-items:center; margin-bottom:10px;">
          <div id="elap_deck_preview_box" style="width:52px; height:52px; border-radius:8px; border:2px solid ${draft.color || '#6366f1'}; background:rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; font-size:24px; color:${draft.color || '#6366f1'}; overflow:hidden;">
            ${draft.avatar && (draft.avatar.startsWith('data:') || draft.avatar.startsWith('http') || draft.avatar.startsWith('/'))
              ? `<img src="${esc(draft.avatar)}" style="width:100%; height:100%; object-fit:cover;">`
              : `<i class="${esc(draft.avatar || 'fa-solid fa-layer-group')}"></i>`}
          </div>
          <div style="flex:1;">
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="elap_edit_deck_avatar" type="text" value="${esc(draft.avatar)}" placeholder="fa-solid fa-dna или URL картинки" style="font-size:11.5px;">
              <label class="elap-btn" style="cursor:pointer; margin:0; white-space:nowrap;">
                <i class="fa-solid fa-image"></i> Загрузить PNG <input id="elap_deck_file_avatar" type="file" accept="image/*" style="display:none;">
              </label>
            </div>
            <small style="color:var(--elap-text-dim); font-size:10.5px; display:block; margin-top:3px;">Выберите готовые иконки ниже или загрузите свой .png файл</small>
          </div>
        </div>

        <!-- Галерея быстрых иконок Font Awesome -->
        <div id="elap_icon_palette" style="display:flex; gap:6px; flex-wrap:wrap; background:rgba(0,0,0,0.2); padding:8px; border-radius:6px; border:1px solid var(--elap-border);">
          ${presetIcons.map((ic) => `
            <div data-icon="${ic}" class="elap-btn elap-btn-icon-only" style="width:30px; height:30px; font-size:13px; cursor:pointer;" title="${ic}">
              <i class="${ic}"></i>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Кнопки управления -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:10px; border-top:1px solid var(--elap-border);">
        <label class="checkbox_label" style="display:flex; align-items:center; gap:6px; cursor:pointer; margin:0; font-size:12px;">
          <input id="elap_edit_deck_enabled" type="checkbox" ${draft.enabled !== false ? "checked" : ""}>
          <span>Колода активна в игровом мире</span>
        </label>
        <div style="display:flex; gap:8px;">
          <button id="elap_edit_deck_cancel" class="elap-btn elap-btn-ghost">Отмена</button>
          <button id="elap_edit_deck_save" class="elap-btn elap-btn-primary" style="font-weight:bold; padding:6px 16px !important;">
            <i class="fa-solid fa-floppy-disk"></i> Сохранить колоду
          </button>
        </div>
      </div>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  const nameInput = overlay.querySelector("#elap_edit_deck_name");
  const idInput = overlay.querySelector("#elap_edit_deck_id");
  const avatarInput = overlay.querySelector("#elap_edit_deck_avatar");
  const colorInput = overlay.querySelector("#elap_edit_deck_color");
  const previewBox = overlay.querySelector("#elap_deck_preview_box");

  const updatePreview = () => {
    const av = String(avatarInput?.value || "fa-solid fa-layer-group").trim();
    const col = String(colorInput?.value || "#6366f1").trim();
    if (previewBox) {
      previewBox.style.borderColor = col;
      previewBox.style.color = col;
      if (av.startsWith("data:image") || av.startsWith("http") || av.startsWith("/")) {
        previewBox.innerHTML = `<img src="${esc(av)}" style="width:100%; height:100%; object-fit:cover;">`;
      } else {
        previewBox.innerHTML = `<i class="${esc(av)}"></i>`;
      }
    }
  };

  if (isNew) {
    nameInput?.addEventListener("input", () => {
      const sanitized = sanitizeKey(nameInput.value).toLowerCase();
      if (sanitized) idInput.value = `deck_${sanitized}`;
    });
  }

  avatarInput?.addEventListener("input", updatePreview);
  colorInput?.addEventListener("input", updatePreview);

  // Клики по палитре иконок
  overlay.querySelectorAll("#elap_icon_palette [data-icon]").forEach((el) => {
    el.addEventListener("click", () => {
      const ic = el.getAttribute("data-icon");
      if (avatarInput) avatarInput.value = ic;
      updatePreview();
    });
  });

  // Клики по палитре цветов
  overlay.querySelectorAll("#elap_deck_color_swatches [data-color]").forEach((el) => {
    el.addEventListener("click", () => {
      const c = el.getAttribute("data-color");
      if (colorInput) colorInput.value = c;
      overlay.querySelectorAll("#elap_deck_color_swatches [data-color]").forEach((s) => {
        s.style.borderColor = s.getAttribute("data-color") === c ? "#fff" : "transparent";
      });
      updatePreview();
    });
  });

  // Загрузка файла PNG/картинки
  overlay.querySelector("#elap_deck_file_avatar")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (avatarInput && ev.target?.result) {
        avatarInput.value = ev.target.result;
        updatePreview();
      }
    };
    reader.readAsDataURL(file);
  });

  overlay.querySelector("#elap_edit_deck_cancel")?.addEventListener("click", () => overlay.remove());

  overlay.querySelector("#elap_edit_deck_save")?.addEventListener("click", () => {
    const name = String(nameInput?.value || "").trim();
    if (!name) {
      if (window.toastr) toastr.warning("Укажите название колоды");
      return;
    }

    let rawId = String(idInput?.value || "").trim();
    if (!rawId) rawId = `deck_${sanitizeKey(name).toLowerCase()}`;

    const description = String(overlay.querySelector("#elap_edit_deck_desc")?.value || "").trim();
    const color = String(colorInput?.value || "#6366f1").trim();
    const avatar = String(avatarInput?.value || "fa-solid fa-layer-group").trim();
    const enabled = !!overlay.querySelector("#elap_edit_deck_enabled")?.checked;

    const saved = upsertDeck({
      id: rawId,
      name,
      description,
      avatar,
      color,
      enabled,
    });

    if (saved) {
      if (window.toastr) toastr.success(`Колода «${saved.name}» сохранена`);
      overlay.remove();
      if (onSaveCallback) onSaveCallback(saved.id);
    }
  });
}

/**
 * Простой, интуитивный редактор карточки (Создание / Редактирование)
 */
export function openCardEditorModal(cardId = null, onSaveCallback = null, preselectedDeckId = null) {
  const existingCard = cardId ? getCardById(cardId) : null;
  const isNew = !existingCard;
  const decks = getWorldDecks();
  const defaultDeckId = preselectedDeckId || decks[0]?.id || "deck_anatomy";

  const draft = existingCard ? deepClone(existingCard) : {
    id: "",
    deckId: defaultDeckId,
    name: "",
    type: "CONSTRAINT",
    tags: [],
    summary: "",
    content: "",
    avatar: "",
    enabled: true,
    scope: "global",
  };

  const overlay = createElapOverlay("elap_card_editor_overlay");

  overlay.innerHTML = elapModalShell(
    isNew ? `<i class="fa-solid fa-plus" style="color:#10b981;"></i> Создание новой карточки мира` : `<i class="fa-solid fa-pen-to-square" style="color:var(--elap-primary);"></i> Редактирование: «${esc(draft.name)}»`,
    `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <!-- Строка 1: Колода и Тип -->
      <div style="display:grid; grid-template-columns: 1.5fr 1fr; gap:10px;">
        <div>
          <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;"><i class="fa-solid fa-folder"></i> Привязка к колоде:</label>
          <select id="elap_edit_card_deck">
            ${decks.map((d) => `
              <option value="${esc(d.id)}" ${String(draft.deckId || '').toLowerCase() === String(d.id).toLowerCase() ? "selected" : ""}>
                📁 ${esc(d.name)}
              </option>
            `).join("")}
          </select>
        </div>
        <div>
          <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;"><i class="fa-solid fa-tags"></i> Тип карточки:</label>
          <select id="elap_edit_card_type">
            <option value="CONSTRAINT" ${draft.type === "CONSTRAINT" ? "selected" : ""}>CONSTRAINT (Ограничение)</option>
            <option value="RULE" ${draft.type === "RULE" ? "selected" : ""}>RULE (Правило мира)</option>
            <option value="KNOWLEDGE" ${draft.type === "KNOWLEDGE" ? "selected" : ""}>KNOWLEDGE (Знание)</option>
            <option value="LOCATION" ${draft.type === "LOCATION" ? "selected" : ""}>LOCATION (Локация)</option>
            <option value="NPC" ${draft.type === "NPC" ? "selected" : ""}>NPC (Персонаж)</option>
          </select>
        </div>
      </div>

      <!-- Строка 2: Название и ID -->
      <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">
        <div>
          <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">Название карточки:</label>
          <input id="elap_edit_card_name" type="text" value="${esc(draft.name)}" placeholder="Например: Анатомия хвоста кошкодевочки">
        </div>
        <div>
          <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">ID ключа (системный):</label>
          <input id="elap_edit_card_id" type="text" value="${esc(draft.id)}" placeholder="card_my_rule" ${isNew ? "" : "readonly"}>
        </div>
      </div>

      <!-- Строка 3: Теги -->
      <div>
        <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">Теги поиска и Pre-Agent (через запятую):</label>
        <input id="elap_edit_card_tags" type="text" value="${esc(Array.isArray(draft.tags) ? draft.tags.join(", ") : draft.tags || "")}" placeholder="хвост, catgirl, поза, сон, спина">
      </div>

      <!-- Строка 4: Компактная сводка (Summary для каталога) -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label style="font-weight:700; font-size:12px;">Краткая сводка (Summary для каталога):</label>
          <span style="font-size:11px; color:var(--elap-text-dim);">Видна Агенту в каталоге (~1-2 предложения, экономит токены)</span>
        </div>
        <textarea id="elap_edit_card_summary" style="min-height:55px; height:55px; font-family:inherit; font-size:12px;" placeholder="Краткое описание правила, по которому Агент понимает, нужна ли эта карточка в сцене...">${esc(draft.summary)}</textarea>
      </div>

      <!-- Строка 5: Полный контент / Директива -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label style="font-weight:700; font-size:12px;">Полный текст директивы / лора (Content):</label>
          <span style="font-size:11px; color:var(--elap-text-dim);">Инжектируется в системный промпт при активации</span>
        </div>
        <textarea id="elap_edit_card_content" style="min-height:160px; font-family:Consolas, monospace; font-size:12px;" placeholder="[ELAP DIRECTIVE: НАЗВАНИЕ]&#10;Подробные указания для основной модели, как именно учитывать это правило...">${esc(draft.content)}</textarea>
      </div>

      <!-- Кнопки управления -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:10px; border-top:1px solid var(--elap-border);">
        <div>
          <label class="checkbox_label" style="display:flex; align-items:center; gap:6px; cursor:pointer; margin:0; font-size:12px;">
            <input id="elap_edit_card_enabled" type="checkbox" ${draft.enabled !== false ? "checked" : ""}>
            <span>Включена в каталог мира</span>
          </label>
        </div>
        <div style="display:flex; gap:8px;">
          <button id="elap_edit_btn_cancel" class="elap-btn elap-btn-ghost">Отмена</button>
          <button id="elap_edit_btn_save" class="elap-btn elap-btn-success" style="font-weight:bold; padding:6px 16px !important;">
            <i class="fa-solid fa-floppy-disk"></i> Сохранить карточку
          </button>
        </div>
      </div>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  if (isNew) {
    const nameInput = overlay.querySelector("#elap_edit_card_name");
    const idInput = overlay.querySelector("#elap_edit_card_id");
    nameInput?.addEventListener("input", () => {
      const sanitized = sanitizeKey(nameInput.value).toLowerCase();
      if (sanitized) idInput.value = `card_${sanitized}`;
    });
  }

  overlay.querySelector("#elap_edit_btn_cancel")?.addEventListener("click", () => overlay.remove());

  overlay.querySelector("#elap_edit_btn_save")?.addEventListener("click", () => {
    const name = String(overlay.querySelector("#elap_edit_card_name")?.value || "").trim();
    if (!name) {
      if (window.toastr) toastr.warning("Укажите название карточки");
      return;
    }

    const deckId = overlay.querySelector("#elap_edit_card_deck")?.value || defaultDeckId;
    const type = overlay.querySelector("#elap_edit_card_type")?.value || "CONSTRAINT";
    let rawId = String(overlay.querySelector("#elap_edit_card_id")?.value || "").trim();
    if (!rawId) rawId = `card_${sanitizeKey(name).toLowerCase()}`;

    const tags = String(overlay.querySelector("#elap_edit_card_tags")?.value || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const summary = String(overlay.querySelector("#elap_edit_card_summary")?.value || "").trim();
    const content = String(overlay.querySelector("#elap_edit_card_content")?.value || "").trim();
    const enabled = !!overlay.querySelector("#elap_edit_card_enabled")?.checked;

    const saved = upsertCard({
      id: rawId,
      deckId,
      name,
      type,
      tags,
      summary,
      content,
      avatar: draft.avatar || "",
      enabled,
      scope: draft.scope || "global",
    });

    if (saved) {
      if (window.toastr) toastr.success(`Карточка «${saved.name}» сохранена`);
      overlay.remove();
      if (onSaveCallback) onSaveCallback();
    }
  });
}

/**
 * Интерактивный Дебаггер Карточек (Ручной инжект в промпт и тест чтения Агентом)
 */
export function openCardDebuggerModal(onChangeCallback = null) {
  const overlay = createElapOverlay("elap_card_debugger_overlay");

  const render = () => {
    const cards = getWorldCards();
    const activeIds = getActiveCardIds();
    const activePromptText = buildActiveCardsPrompt();

    overlay.innerHTML = elapModalShell(
      `<i class="fa-solid fa-vial" style="color:var(--elap-cyan);"></i> ELAP — Интерактивный Дебаггер Карточек`,
      `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <!-- Описание и статус -->
        <div style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.25); border-radius:var(--elap-radius-sm); padding:10px 14px;">
          <div style="font-weight:700; color:#a5b4fc; margin-bottom:4px;"><i class="fa-solid fa-terminal"></i> Прямой контроль инъекций в промпт</div>
          <div style="font-size:12px; color:var(--elap-text-muted); line-height:1.4;">
            Здесь вы можете вручную загрузить любую карточку мира в системный промпт основной модели, проверить результирующий макрос или запустить тестовый семантический анализ карточки.
          </div>
        </div>

        <!-- Выбор карточки для теста -->
        <div style="display:grid; grid-template-columns: 2fr 1fr 1fr; gap:8px; align-items:end;">
          <div>
            <label style="display:block; margin-bottom:4px; font-weight:700; font-size:12px;">Выберите карточку для загрузки:</label>
            <select id="elap_dbg_card_select" style="font-size:12px;">
              ${cards.map((c) => {
                const isActive = activeIds.includes(c.id.toLowerCase());
                return `<option value="${esc(c.id)}">${isActive ? '● [В ПРОМПТЕ] ' : ''}${esc(c.name)} (${esc(c.type)})</option>`;
              }).join("")}
            </select>
          </div>
          <button id="elap_dbg_btn_toggle_inject" class="elap-btn elap-btn-primary" style="height:36px;">
            <i class="fa-solid fa-play"></i> Загрузить в промпт
          </button>
          <button id="elap_dbg_btn_clear_active" class="elap-btn elap-btn-ghost" style="height:36px;">
            <i class="fa-solid fa-broom"></i> Сбросить всё
          </button>
        </div>

        <!-- ПРЕВЬЮ: Что сейчас внедряется в промпт модели -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label style="font-weight:700; font-size:12px;">
              Текущий результирующий блок в промпте (Макрос <code>{{cards}}</code> / <code>{{constraints}}</code>):
            </label>
            <span style="font-size:11px; color:#a5b4fc; font-weight:700;">
              ${activeIds.length ? `Активно карточек: ${activeIds.length}` : 'Пусто (ничего не внедрено)'}
            </span>
          </div>
          <textarea id="elap_dbg_active_preview" class="elap-debug-box" style="min-height:120px; font-size:12px;" readonly>${esc(activePromptText || "(В данный момент ни одна карточка не загружена в промпт)")}</textarea>
        </div>

        <!-- СИМУЛЯЦИЯ: Вызов Агента (Tool Read Simulation) -->
        <div style="background:var(--elap-bg-elevated); border:1px solid var(--elap-border); border-radius:var(--elap-radius-sm); padding:12px; margin-top:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
            <b style="font-size:12.5px; color:#fbbf24;"><i class="fa-solid fa-robot"></i> Симулятор чтения карточки Агентом</b>
            <button id="elap_dbg_btn_simulate_read" class="elap-btn elap-btn-warning" style="font-weight:bold;">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Запустить анализ карточки
            </button>
          </div>
          <div style="font-size:11.5px; color:var(--elap-text-muted); margin-bottom:8px;">
            Агент получит карточку и сформулирует точную директиву для основной модели.
          </div>
          <textarea id="elap_dbg_agent_output" class="elap-debug-box" style="min-height:120px; font-size:12px;" placeholder="Здесь появится ответ Агента после симуляции чтения карточки..." readonly></textarea>
        </div>
      </div>
      `
    );

    bindModalCloseX(overlay);

    const selectEl = overlay.querySelector("#elap_dbg_card_select");
    const toggleBtn = overlay.querySelector("#elap_dbg_btn_toggle_inject");

    const updateBtnLabel = () => {
      const selectedId = selectEl?.value;
      if (!selectedId) return;
      const isAct = activeIds.includes(selectedId.toLowerCase());
      if (toggleBtn) {
        toggleBtn.innerHTML = isAct ? `<i class="fa-solid fa-stop"></i> Убрать из промпта` : `<i class="fa-solid fa-play"></i> Загрузить в промпт`;
        if (isAct) {
          toggleBtn.className = "elap-btn elap-btn-danger";
        } else {
          toggleBtn.className = "elap-btn elap-btn-primary";
        }
      }
    };

    selectEl?.addEventListener("change", updateBtnLabel);
    updateBtnLabel();

    toggleBtn?.addEventListener("click", () => {
      const selectedId = selectEl?.value;
      if (!selectedId) return;
      if (activeIds.includes(selectedId.toLowerCase())) {
        deactivateCard(selectedId);
        if (window.toastr) toastr.info(`Карточка ${selectedId} удалена из активных`);
      } else {
        activateCard(selectedId);
        if (window.toastr) toastr.success(`Карточка ${selectedId} загружена в промпт!`);
      }
      render();
      if (onChangeCallback) onChangeCallback();
    });

    overlay.querySelector("#elap_dbg_btn_clear_active")?.addEventListener("click", () => {
      clearActiveCards();
      render();
      if (onChangeCallback) onChangeCallback();
    });

    overlay.querySelector("#elap_dbg_btn_simulate_read")?.addEventListener("click", async () => {
      const selectedId = selectEl?.value;
      if (!selectedId) return;
      const outBox = overlay.querySelector("#elap_dbg_agent_output");
      if (outBox) outBox.value = `⏳ Агент изучает карточку "${selectedId}"... Пожалуйста, подождите...`;

      try {
        const { raw, parsed } = await simulateAgentCardRead(selectedId);
        if (outBox) {
          if (parsed && typeof parsed === "object") {
            outBox.value = `✓ [Агент успешно проанализировал карточку]:\n\n📌 Рассуждение: ${parsed.reasoning || '—'}\n\n🎯 Сформулированная директива:\n${parsed.directive || '—'}\n\n--- Сырой JSON ---\n${raw}`;
          } else {
            outBox.value = raw || "Агент вернул пустой ответ";
          }
        }
      } catch (err) {
        if (outBox) outBox.value = `❌ Ошибка при вызове Агента: ${err.message}`;
      }
    });
  };

  render();
  document.body.appendChild(overlay);
}
