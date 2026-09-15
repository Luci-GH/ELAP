// --- START OF FILE ui.js ---

import { getContext } from "/scripts/extensions.js";
import { characters as st_characters } from "/script.js";
import {
  DEFAULT_AGENT_PROMPT,
  DEFAULT_BLOCKS,
  DEFAULT_DAYS,
  DEFAULT_TIMELINE,
  DEFAULTS,
  MODULE_NAME,
} from "./config.js";
import {
  S,
  save,
  esc,
  deepClone,
  genId,
  sanitizeKey,
  ensureCharactersState,
  getElapCharacters,
  getActiveElapCharacter,
  setActiveElapCharacter,
  buildElapPromptFromCharacter,
  buildDaysPromptFromCharacter,
  currentEditorDraft,
  getProfileDetails,
  resolveProfileModel,
  exportAllCharactersToJson,
  importCharacterFromJson,
  duplicateElapCharacter,
  buildAgentFullPromptPreview,
  extractCharacterFromPng,
  addOrResetChessCharacter,
} from "./state.js";
import { registerAllElapMacros } from "./macros.js";
import { openCardsManagerModal, openCardDebuggerModal, runPreAgentForCards } from "./cards.js";
import {
  getConnectionProfiles,
  runAgentOnCurrentChat,
  stopAgentRequest,
  isAgentBusy,
  generateEndDaySummary,
} from "./agent.js";
import {
  switchOrStartCharacterChat,
  refreshAssistantStatus,
  createAssistantCharacter,
  executeEndDayChatTransition,
  getElapCharacterAvatarUrl,
} from "./chat.js";
import { formatTimelineHeader, getPeriodFromTime } from "./timeline.js";
import { openPromptInspectorModal } from "./inspector.js";
import { openCharacterEditorModal, promptDeleteCharacterModal, openSmartImportModal } from "./ui-editor.js";

let agentHudTimer = null;
let agentHudStartTime = 0;

export function updateAgentHud(status = "running", detailText = "") {
  let hud = document.querySelector("#elap_agent_hud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "elap_agent_hud";
    hud.className = "elap-agent-hud";
    hud.innerHTML = `
      <div class="elap-hud-spinner"></div>
      <div class="elap-hud-body">
        <div class="elap-hud-title"><b>ELAP Agent:</b> <span id="elap_hud_status_text">Анализ диалога...</span></div>
        <div class="elap-hud-sub" id="elap_hud_timer">00:00</div>
      </div>
      <button id="elap_hud_btn_stop" class="elap-hud-stop-btn" title="Прервать работу агента"><i class="fa-solid fa-stop"></i> Стоп</button>
    `;
    document.body.appendChild(hud);

    hud.querySelector("#elap_hud_btn_stop")?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      stopAgentRequest();
    });
  }

  const statusTextEl = hud.querySelector("#elap_hud_status_text");
  const timerEl = hud.querySelector("#elap_hud_timer");

  if (status === "running") {
    hud.classList.remove("elap-hud-hidden", "elap-hud-aborted", "elap-hud-success");
    hud.classList.add("elap-hud-active");

    if (statusTextEl) statusTextEl.textContent = detailText || "Анализ изменений...";
    
    if (!agentHudTimer) {
      agentHudStartTime = Date.now();
      timerEl.textContent = "00:00";
      agentHudTimer = setInterval(() => {
        const diffSec = Math.floor((Date.now() - agentHudStartTime) / 1000);
        const m = String(Math.floor(diffSec / 60)).padStart(2, "0");
        const sec = String(diffSec % 60).padStart(2, "0");
        if (timerEl) timerEl.textContent = `${m}:${sec}`;
      }, 1000);
    }
  } else if (status === "success") {
    if (agentHudTimer) { clearInterval(agentHudTimer); agentHudTimer = null; }
    hud.classList.remove("elap-hud-active");
    hud.classList.add("elap-hud-success");
    if (statusTextEl) statusTextEl.textContent = detailText || "Обновление завершено!";
    setTimeout(() => { hud.classList.add("elap-hud-hidden"); }, 2500);
  } else if (status === "aborted") {
    if (agentHudTimer) { clearInterval(agentHudTimer); agentHudTimer = null; }
    hud.classList.remove("elap-hud-active");
    hud.classList.add("elap-hud-aborted");
    if (statusTextEl) statusTextEl.textContent = detailText || "Прервано";
    setTimeout(() => { hud.classList.add("elap-hud-hidden"); }, 3000);
  } else {
    if (agentHudTimer) { clearInterval(agentHudTimer); agentHudTimer = null; }
    hud.classList.add("elap-hud-hidden");
  }
}

export function setAgentUiBusy(busy, reason = "") {
  if (busy) {
    document.body.classList.add("elap-agent-busy");
    updateAgentHud("running", reason || "Анализ диалога...");
  } else {
    document.body.classList.remove("elap-agent-busy");
    if (!reason || reason === "done") {
      updateAgentHud("success", "Готово!");
    } else if (reason === "hide") {
      updateAgentHud("hidden");
    } else {
      updateAgentHud("aborted", reason);
    }
  }
}

export function ensureElapStyles() {}

export function createElapOverlay(id) {
  document.querySelector(`#${id}`)?.remove();
  const overlay = document.createElement("div");
  overlay.id = id;
  overlay.className = "elap-overlay";

  const stopEvent = (e) => e.stopPropagation();
  overlay.addEventListener("mousedown", stopEvent);
  overlay.addEventListener("mouseup", stopEvent);
  overlay.addEventListener("pointerdown", stopEvent);
  overlay.addEventListener("touchstart", stopEvent);

  return overlay;
}

export function elapModalShell(title, bodyHtml, showCloseX = true) {
  return `
  <div class="elap-modal">
    <div class="elap-modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <b style="font-size:16px;">${title}</b>
      ${showCloseX ? `<button class="elap-close-btn-x" data-act="modal-close-x" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>` : ""}
    </div>
    ${bodyHtml}
  </div>`;
}

export function bindModalCloseX(overlay) {
  overlay.querySelector('[data-act="modal-close-x"]')?.addEventListener("click", () => overlay.remove());
}

export function liveUpdateEditorDOMIfOpen(charId, updatedBlockKeysMap = {}) {
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return;

  const overlay = document.querySelector("#elap_char_prompt_overlay");
  if (overlay) {
    if (currentEditorDraft && String(currentEditorDraft.id) === String(charId)) {
      currentEditorDraft.blocks = deepClone(char.blocks);
      currentEditorDraft.events = deepClone(char.events || []);
      currentEditorDraft.timeline = deepClone(char.timeline || DEFAULT_TIMELINE);
    }

    // 1. Обновляем инпуты таймлайна в открытом окне редактора
    const tl = char.timeline || DEFAULT_TIMELINE;
    const dayInput = overlay.querySelector("#elap_tl_day");
    const periodSelect = overlay.querySelector("#elap_tl_period");
    const dateInput = overlay.querySelector("#elap_tl_date");
    const timeInput = overlay.querySelector("#elap_tl_time");
    const weatherInput = overlay.querySelector("#elap_tl_weather");

    if (dayInput) dayInput.value = tl.day || 1;
    if (periodSelect) periodSelect.value = tl.period || getPeriodFromTime(tl.time || "08:00");
    if (dateInput) dateInput.value = tl.date || "";
    if (timeInput) timeInput.value = tl.time || "08:00";
    if (weatherInput) weatherInput.value = tl.weather || "";

    // Подсветка блока таймлайна при его обновлении агентом
    if (updatedBlockKeysMap["__timeline__"]) {
      const tlBlock = overlay.querySelector("#elap_timeline_editor_block");
      if (tlBlock) {
        tlBlock.style.transition = "all 0.4s ease";
        tlBlock.style.backgroundColor = "rgba(186, 104, 200, 0.22)";
        tlBlock.style.borderColor = "#ba68c8";
        setTimeout(() => {
          tlBlock.style.backgroundColor = "";
          tlBlock.style.borderColor = "#ba68c8";
        }, 2000);
      }
    }

    // 2. Обновляем динамические текстовые блоки
    const rows = overlay.querySelectorAll(".elap-block-row");
    rows.forEach((row) => {
      const keyInput = row.querySelector('[data-f="key"]');
      const contentTextarea = row.querySelector('[data-f="content"]');
      if (!keyInput || !contentTextarea) return;

      const currentKey = sanitizeKey(keyInput.value).toLowerCase();
      const block = char.blocks.find((b) => sanitizeKey(b.key).toLowerCase() === currentKey);

      if (block) {
        contentTextarea.value = block.content;
        if (updatedBlockKeysMap[currentKey]) {
          row.style.transition = "all 0.4s ease";
          row.style.backgroundColor = "rgba(154, 237, 123, 0.22)";
          row.style.borderColor = "#9aed7b";
          setTimeout(() => {
            row.style.backgroundColor = "";
            row.style.borderColor = "#444";
          }, 2000);
        }
      }
    });

    // 3. Обновляем счетчик на бейдже ивентов
    const eventsBadge = overlay.querySelector("#elap_editor_events_badge");
    if (eventsBadge) {
      const total = (char.events || []).length;
      const active = (char.events || []).filter((e) => e.status === "active").length;
      eventsBadge.textContent = `${total} ивентов (${active} акт.)`;
    }

    if (typeof overlay._renderEventsList === "function") {
      overlay._renderEventsList();
    }
  }
}

export function hardResetElap() {
  const extension_settings = getContext?.()?.extensionSettings || {};
  extension_settings[MODULE_NAME] = {
    ...DEFAULTS,
    characters: [],
    activeCharacterId: null,
    warned: true,
  };
  save();
  ensureCharactersState();
  registerAllElapMacros();
  renderSettingsUI();
  if (window.toastr) toastr.success("Данные ELAP сброшены!");
}

export function renderCharAvatarHtml(char) {
  if (!char) return `<div class="elap-char-avatar"><i class="fa-solid fa-user"></i></div>`;
  const av = String(char.avatar || "").trim();
  if (av && (av.startsWith("data:") || av.startsWith("http") || av.startsWith("/"))) {
    return `<div class="elap-char-avatar"><img src="${esc(av)}" alt="${esc(char.name)}"></div>`;
  }
  if (av && av.includes("fa-")) {
    return `<div class="elap-char-avatar"><i class="${esc(av)}"></i></div>`;
  }
  const resolvedUrl = getElapCharacterAvatarUrl(char);
  if (resolvedUrl) {
    return `<div class="elap-char-avatar"><img src="${esc(resolvedUrl)}" alt="${esc(char.name)}" onerror="this.parentElement.innerHTML='<span class=\\\'elap-char-avatar-initial\\\'>${esc(char.name?.charAt(0)?.toUpperCase() || '?')}</span>'"></div>`;
  }

  const initial = (char.name || "?").trim().charAt(0).toUpperCase();
  return `<div class="elap-char-avatar elap-char-avatar-initial">${esc(initial)}</div>`;
}

export function openCharactersModal() {
  ensureCharactersState();

  const overlay = createElapOverlay("elap_chars_overlay");
  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-users" style="color:var(--elap-accent); margin-right:8px;"></i> ELAP — Персонажи`,
    `
    <div class="elap-row" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      <input id="elap_new_char_name" type="text" placeholder="Имя нового персонажа (например, Lucy)" class="text_pole" style="flex:1; min-width:180px;">
      <button id="elap_create_char_btn" class="elap-btn elap-btn-success elap-btn-compact"><i class="fa-solid fa-plus"></i> Создать</button>
      <button id="elap_btn_smart_import" class="elap-btn elap-btn-accent elap-btn-compact" title="Импорт карточки Janitor AI, Chub, Tavern, из текста или файла"><i class="fa-solid fa-wand-magic-sparkles"></i> Импорт карточки</button>
      <button id="elap_btn_add_chess_preset" class="elap-btn elap-btn-secondary elap-btn-compact" title="Добавить или сбросить персонажа 'Шахматы' с интерактивной доской"><i class="fa-solid fa-chess"></i> Шахматы</button>
      <button id="elap_btn_import_char" class="elap-btn elap-btn-secondary elap-btn-compact" title="Загрузить .json или .png"><i class="fa-solid fa-file-import"></i> Файл</button>
      <button id="elap_btn_export_all" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-file-export"></i> Экспорт всех</button>
      <input id="elap_file_importer" type="file" accept=".json,.elap.json,.png" style="display:none;" multiple>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; margin-bottom:2px; gap:8px; flex-wrap:wrap;">
      <div style="position:relative; flex:1; max-width:280px;">
        <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:9px; top:50%; transform:translateY(-50%); font-size:11px; opacity:0.6;"></i>
        <input id="elap_search_chars_input" type="text" placeholder="Поиск персонажа..." class="text_pole" style="padding-left:26px; font-size:12px; width:100%;">
      </div>
      <div id="elap_chars_counter" style="font-size:11.5px; opacity:0.75; font-family:monospace;"></div>
    </div>
    <div id="elap_chars_list" class="elap-chars-grid"></div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  const createAction = () => {
    const input = overlay.querySelector("#elap_new_char_name");
    const name = String(input?.value || "").trim();
    if (!name) return;

    const s = S();
    const newId = genId();
    const item = {
      id: newId,
      name,
      chatId: null,
      firstMessage: "",
      firstMessageRole: "char",
      timeline: deepClone(DEFAULT_TIMELINE),
      events: [],
      blocks: deepClone(DEFAULT_BLOCKS),
      days: deepClone(DEFAULT_DAYS),
    };
    s.characters.push(item);
    s.activeCharacterId = newId;
    save();
    registerAllElapMacros();

    renderCharactersList();
    renderSettingsUI();

    if (s.autoOpenEditorOnCreate !== false) {
      setActiveElapCharacter(newId);
      openCharacterEditorModal(newId);
    }
  };

  overlay.querySelector("#elap_create_char_btn")?.addEventListener("click", createAction);
  overlay.querySelector("#elap_new_char_name")?.addEventListener("keydown", (e) => { if (e.key === "Enter") createAction(); });

  overlay.querySelector("#elap_btn_smart_import")?.addEventListener("click", () => {
    openSmartImportModal({
      onCreated: () => {
        renderCharactersList();
        renderSettingsUI();
      },
    });
  });

  const searchInput = overlay.querySelector("#elap_search_chars_input");
  searchInput?.addEventListener("input", (e) => {
    renderCharactersList(e.target.value);
  });

  const fileInput = overlay.querySelector("#elap_file_importer");
  overlay.querySelector("#elap_btn_import_char")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    for (const file of files) {
      try {
        if (file.name.toLowerCase().endsWith(".png")) {
          const buffer = await file.arrayBuffer();
          const extracted = extractCharacterFromPng(buffer);
          if (extracted) {
            const dataObj = typeof extracted === "object" ? extracted : JSON.parse(extracted);
            if (!dataObj.avatar && !dataObj.data?.avatar) {
              const base64Png = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result || "");
                reader.onerror = () => resolve("");
                reader.readAsDataURL(file);
              });
              if (base64Png) dataObj.avatar = base64Png;
            }
            importCharacterFromJson(dataObj);
          }
        } else {
          const text = await file.text();
          importCharacterFromJson(text);
        }
      } catch (err) {}
    }
    fileInput.value = "";
    registerAllElapMacros();
    renderCharactersList();
    renderSettingsUI();
  });

  overlay.querySelector("#elap_btn_add_chess_preset")?.addEventListener("click", () => {
    addOrResetChessCharacter();
    registerAllElapMacros();
    renderCharactersList();
    renderSettingsUI();
    if (window.toastr) {
      toastr.success("Персонаж 'Шахматы' успешно добавлен и активирован!");
    }
  });

  overlay.querySelector("#elap_btn_export_all")?.addEventListener("click", () => exportAllCharactersToJson());
  renderCharactersList();
}

export function renderCharactersList(filterText = "") {
  const root = document.querySelector("#elap_chars_list");
  if (!root) return;

  const s = S();
  let chars = getElapCharacters();
  const counter = document.querySelector("#elap_chars_counter");
  if (counter) counter.textContent = `Всего: ${chars.length}`;

  if (filterText && filterText.trim()) {
    const q = filterText.trim().toLowerCase();
    chars = chars.filter((c) => String(c.name || "").toLowerCase().includes(q) || String(c.chatId || "").toLowerCase().includes(q));
  }

  if (!chars.length) {
    root.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:32px; opacity:0.75; font-size:13px;">
      <i class="fa-solid fa-users-slash" style="font-size:32px; margin-bottom:10px; display:block; color:var(--elap-text-dim);"></i>
      ${filterText ? 'Персонажи не найдены по запросу' : 'Список пуст. Создайте или импортируйте персонажа.'}
    </div>`;
    return;
  }

  root.innerHTML = chars
    .map((c) => {
      const active = String(c.id) === String(s.activeCharacterId);
      const prefix = sanitizeKey(c.name).toLowerCase();
      const isBranch = Boolean(
        c.chatId && (
          /^branch\s*#/i.test(c.chatId) || 
          /^checkpoint\s*#/i.test(c.chatId) || 
          (Array.isArray(c.branches) && c.branches.some((b) => String(b).toLowerCase() === String(c.chatId).toLowerCase()))
        )
      );
      const chatDisplay = c.chatId ? esc(c.chatId) : "<i>(Чат не создан)</i>";
      const tlDay = c.timeline?.day || 1;
      const tlTime = c.timeline?.time || "08:00";
      const eventsCount = Array.isArray(c.events) ? c.events.length : 0;
      const blocksCount = Array.isArray(c.blocks) ? c.blocks.length : 0;

      const activeBtnHtml = active
        ? `<button disabled class="elap-btn elap-btn-success elap-btn-compact" style="cursor:default;"><i class="fa-solid fa-circle-check"></i> Выбран</button>`
        : `<button data-act="set-active" data-id="${esc(String(c.id))}" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-regular fa-circle"></i> Выбрать</button>`;

      return `
<div class="elap-char-card ${active ? 'elap-char-card-active' : ''}" data-id="${esc(String(c.id))}">
  <div class="elap-char-card-header">
    ${renderCharAvatarHtml(c)}
    <div class="elap-char-header-text">
      <div class="elap-char-card-name" title="${esc(c.name)}">${esc(c.name)}</div>
      <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
        <code class="elap-tag-pill" title="Префикс макросов">{{${esc(prefix)}_...}}</code>
        ${active ? `<span class="elap-char-active-badge"><i class="fa-solid fa-circle-check"></i> Активен</span>` : ''}
      </div>
    </div>
  </div>

  <div class="elap-char-card-body">
    <div class="elap-char-meta-row">
      <span class="elap-char-meta-pill timeline-pill" title="Игровое время">
        <i class="fa-solid fa-clock"></i> День ${tlDay}, ${tlTime}
      </span>
      <span class="elap-char-meta-pill" title="Сюжетные события">
        <i class="fa-solid fa-crosshairs"></i> ${eventsCount}
      </span>
      <span class="elap-char-meta-pill" title="Блоки контекста">
        <i class="fa-solid fa-cubes"></i> ${blocksCount}
      </span>
    </div>
    <div class="elap-char-chat-status" title="Привязанный файл чата: ${c.chatId ? esc(c.chatId) : 'не создан'}${isBranch ? ' (Ветка)' : ''}">
      <i class="${isBranch ? 'fa-solid fa-code-branch' : 'fa-solid fa-comments'}" ${isBranch ? 'style="color:#a78bfa;"' : ''}></i>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Чат: ${chatDisplay}</span>
      ${isBranch ? `<span class="elap-tag-badge" style="background:#7c3aed; color:#fff; font-size:9.5px; padding:1px 5px; margin-left:auto; flex-shrink:0;"><i class="fa-solid fa-code-branch"></i> Ветка</span>` : ''}
    </div>
  </div>

  <div class="elap-char-card-footer">
    <div class="elap-char-primary-actions">
      ${activeBtnHtml}
      <button data-act="open-chat" data-id="${esc(String(c.id))}" class="elap-btn elap-btn-primary elap-btn-compact" title="Открыть чат"><i class="fa-solid fa-comments"></i> Чат</button>
      <button data-act="open-char" data-id="${esc(String(c.id))}" class="elap-btn elap-btn-accent elap-btn-compact" title="Редактор"><i class="fa-solid fa-pen-to-square"></i> Редактор</button>
    </div>
    <div class="elap-char-secondary-actions">
      <button data-act="new-chat" data-id="${esc(String(c.id))}" class="elap-btn elap-btn-secondary elap-btn-compact" title="Новый чат"><i class="fa-solid fa-plus"></i></button>
      <button data-act="clone-char" data-id="${esc(String(c.id))}" class="elap-btn elap-btn-secondary elap-btn-compact" title="Клон"><i class="fa-solid fa-clone"></i></button>
      <button data-act="export-char" data-id="${esc(String(c.id))}" class="elap-btn elap-btn-secondary elap-btn-compact" title="Экспорт JSON"><i class="fa-solid fa-file-export"></i></button>
      <button data-act="delete-char" data-id="${esc(String(c.id))}" class="elap-btn elap-btn-danger elap-btn-compact" title="Удалить"><i class="fa-solid fa-trash-can"></i></button>
    </div>
  </div>
</div>`;
    })
    .join("");

  root.onclick = async (e) => {
    e.stopPropagation();
    const t = e.target;
    if (!(t instanceof Element)) return;

    const setActiveBtn = t.closest('[data-act="set-active"]');
    if (setActiveBtn) {
      const id = setActiveBtn.getAttribute("data-id");
      if (id) {
        setActiveElapCharacter(id);
        registerAllElapMacros();
        renderCharactersList();
        renderSettingsUI();
      }
      return;
    }

    const chatBtn = t.closest('[data-act="open-chat"]');
    if (chatBtn) {
      const id = chatBtn.getAttribute("data-id");
      if (id) {
        document.querySelector("#elap_chars_overlay")?.remove();
        await switchOrStartCharacterChat(id, false);
      }
      return;
    }

    const newChatBtn = t.closest('[data-act="new-chat"]');
    if (newChatBtn) {
      const id = newChatBtn.getAttribute("data-id");
      if (id && confirm("Создать новый чат для этого персонажа?")) {
        document.querySelector("#elap_chars_overlay")?.remove();
        await switchOrStartCharacterChat(id, true);
      }
      return;
    }

    const editBtn = t.closest('[data-act="open-char"]');
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      if (id) {
        setActiveElapCharacter(id);
        openCharacterEditorModal(id);
      }
      return;
    }

    const cloneBtn = t.closest('[data-act="clone-char"]');
    if (cloneBtn) {
      const id = cloneBtn.getAttribute("data-id");
      if (id) {
        duplicateElapCharacter(id);
        renderCharactersList();
        renderSettingsUI();
      }
      return;
    }

    const exportBtn = t.closest('[data-act="export-char"]');
    if (exportBtn) {
      const id = exportBtn.getAttribute("data-id");
      if (id) exportCharacterToJson(id);
      return;
    }

    const delBtn = t.closest('[data-act="delete-char"]');
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      if (id) promptDeleteCharacterModal(id);
      return;
    }
  };
}

export function openEndDayModal() {
  ensureCharactersState();
  const s = S();
  const activeChar = getActiveElapCharacter();

  if (!activeChar) {
    if (window.toastr) toastr.warning("Сначала выберите персонажа в ELAP!");
    return;
  }

  const ctx = getContext?.();
  const chatHistory = ctx?.chat || [];
  const lastMsg = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
  const lastMsgPreview = lastMsg ? esc(String(lastMsg.mes).slice(0, 80)) + "..." : "(Чат пуст)";

  let targetDay = (activeChar.days || []).find((d) => !d.content || !d.content.trim());
  if (!targetDay) {
    const nextIdx = (activeChar.days || []).length + 1;
    targetDay = { id: genId(), name: `Day ${nextIdx}`, key: `day${nextIdx}`, content: "" };
    activeChar.days.push(targetDay);
  }

  const currentTlDay = activeChar.timeline?.day || 1;

  const overlay = createElapOverlay("elap_end_day_overlay");
  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-moon" style="color:var(--elap-accent); margin-right:8px;"></i> Завершение дня ${currentTlDay} ➔ День ${currentTlDay + 1} — «${esc(activeChar.name)}»`,
    `
    <div class="elap-editor-split" style="gap:20px;">
      <div style="flex: 1; min-width:300px; background:rgba(0,0,0,0.25); padding:14px; border-radius:10px; border:1px solid var(--elap-border);">
        <b style="color:var(--elap-accent); font-size:14px; display:block; margin-bottom:12px;"><i class="fa-solid fa-sliders"></i> Настройки Саммаризации</b>
        
        <div class="elap-row">
          <label style="font-size:12px; opacity:0.9;"><b>Промпт архиватора:</b></label>
          <select id="ed_cfg_prompt" class="text_pole" style="width:100%; margin-top:4px;">
            <option value="detailed" ${s.endDayPrompt === 'detailed' ? 'selected' : ''}>Detailed (Детальный анализ)</option>
            <option value="balanced" ${s.endDayPrompt === 'balanced' ? 'selected' : ''}>Balanced (Сбалансированный)</option>
            <option value="short" ${s.endDayPrompt === 'short' ? 'selected' : ''}>Short (Краткая выжимка)</option>
            <option value="forensic" ${s.endDayPrompt === 'forensic' ? 'selected' : ''}>Forensic Chronicler (Хронология)</option>
            <option value="weaver" ${s.endDayPrompt === 'weaver' ? 'selected' : ''}>Narrative Weaver (Сюжетный)</option>
          </select>
        </div>

        <div class="elap-row">
          <label style="font-size:12px; opacity:0.9;"><b>Модель (Connection Profile):</b></label>
          <select id="ed_cfg_profile" class="text_pole" style="width:100%; margin-top:4px;">
            <option value="elap" ${s.endDayProfile === 'elap' ? 'selected' : ''}>Профиль ELAP Агента</option>
            <option value="main" ${s.endDayProfile === 'main' ? 'selected' : ''}>Основной профиль Таверны</option>
          </select>
        </div>

        <div class="elap-row">
          <label style="font-size:12px; opacity:0.9;"><b>Действие с чатом после сохранения:</b></label>
          <select id="ed_cfg_action" class="text_pole" style="width:100%; margin-top:4px;">
            <option value="new" ${s.endDayChatAction === 'new' ? 'selected' : ''}>Создать новый чистый чат (Рекомендуется)</option>
            <option value="clear" ${s.endDayChatAction === 'clear' ? 'selected' : ''}>Очистить текущий чат</option>
          </select>
        </div>

        <div style="margin-top:16px; border-top:1px solid var(--elap-border); padding-top:12px;">
          <b style="font-size:12px; color:var(--elap-warning);"><i class="fa-solid fa-comment"></i> Последнее сообщение:</b><br/>
          <small style="opacity:0.7; font-style:italic;">"${lastMsgPreview}"</small>
        </div>

        <div class="elap-row" style="margin-top:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="ed_cfg_exclude" ${s.endDayExcludeLast ? 'checked' : ''}>
            <span style="font-size:12px;"><b>Исключить</b> его из саммари</span>
          </label>
        </div>
        <div class="elap-row" style="margin-top:4px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="ed_cfg_keep" ${s.endDayKeepLast ? 'checked' : ''}>
            <span style="font-size:12px;"><b>Перенести</b> его стартовым в новый чат</span>
          </label>
        </div>

        <button id="ed_btn_generate" class="elap-btn elap-btn-accent" style="width:100%; margin-top:20px; font-weight:bold; padding:10px;">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Сгенерировать Саммари
        </button>
        <button id="ed_btn_stop" class="elap-btn elap-btn-danger" style="width:100%; margin-top:8px; display:none;">
          <i class="fa-solid fa-stop"></i> Остановить
        </button>
      </div>

      <div style="flex: 2; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:6px;">
          <label><small><b>Редактор Саммари (Цель: <span style="color:var(--elap-success);">${esc(targetDay.name)}</span>)</b></small></label>
        </div>
        <textarea id="ed_result_text" style="flex:1; min-height:350px; font-family:monospace; background:#121212;" placeholder="Здесь появится сгенерированное саммари..."></textarea>
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button id="ed_btn_cancel" class="elap-btn elap-btn-secondary elap-btn-compact">Отмена</button>
          <button id="ed_btn_save_execute" class="elap-btn elap-btn-success elap-btn-compact" style="font-weight:bold; padding:8px 16px !important;" disabled>
            <i class="fa-solid fa-floppy-disk"></i> Сохранить и Перейти в День ${currentTlDay + 1} <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  const btnGen = overlay.querySelector("#ed_btn_generate");
  const btnStop = overlay.querySelector("#ed_btn_stop");
  const btnSave = overlay.querySelector("#ed_btn_save_execute");
  const resultText = overlay.querySelector("#ed_result_text");

  const saveLocalSettings = () => {
    s.endDayPrompt = overlay.querySelector("#ed_cfg_prompt").value;
    s.endDayProfile = overlay.querySelector("#ed_cfg_profile").value;
    s.endDayChatAction = overlay.querySelector("#ed_cfg_action").value;
    s.endDayExcludeLast = overlay.querySelector("#ed_cfg_exclude").checked;
    s.endDayKeepLast = overlay.querySelector("#ed_cfg_keep").checked;
    save();
  };

  overlay.querySelectorAll("select, input").forEach((el) => el.addEventListener("change", saveLocalSettings));

  btnGen.addEventListener("click", async () => {
    saveLocalSettings();
    btnGen.style.display = "none";
    btnStop.style.display = "block";
    btnSave.disabled = true;
    resultText.value = "⏳ Анализ диалога и генерация саммари прошедшего дня...";

    try {
      const finalContent = await generateEndDaySummary({
        promptType: s.endDayPrompt,
        profile: s.endDayProfile,
        excludeLast: s.endDayExcludeLast,
      }, (accText) => {
        resultText.value = accText;
        resultText.scrollTop = resultText.scrollHeight;
      });

      if (finalContent) {
        resultText.value = finalContent;
        btnSave.disabled = false;
        if (window.toastr) toastr.success("Саммари готово!");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        resultText.value = `❌ Ошибка генерации: ${err.message}`;
      } else {
        resultText.value = "⏹ Генерация остановлена.";
      }
    } finally {
      btnGen.style.display = "block";
      btnStop.style.display = "none";
      if (resultText.value.trim() && !resultText.value.startsWith("❌") && !resultText.value.startsWith("⏹") && !resultText.value.startsWith("⏳")) {
        btnSave.disabled = false;
      }
    }
  });

  btnStop.addEventListener("click", () => stopAgentRequest("Генерация саммари остановлена"));

  resultText.addEventListener("input", () => {
    if (resultText.value.trim().length > 10) btnSave.disabled = false;
  });

  btnSave.addEventListener("click", async () => {
    const finalSummary = resultText.value.trim();
    if (!finalSummary) return;

    targetDay.content = finalSummary;
    save();
    registerAllElapMacros();
    overlay.remove();

    const currentChatCtx = getContext?.()?.chat || [];
    const actualLastMsg = currentChatCtx.length > 0 ? currentChatCtx[currentChatCtx.length - 1] : null;
    await executeEndDayChatTransition(activeChar.id, s.endDayChatAction, s.endDayKeepLast, actualLastMsg);
  });

  overlay.querySelector("#ed_btn_cancel")?.addEventListener("click", () => overlay.remove());
}

let currentSettingsTab = "agent";

export function openSettingsModal() {
  const s = S();
  const overlay = createElapOverlay("elap_settings_overlay");
  const initProfInfo = getProfileDetails(s.connectionProfile);

  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-sliders" style="color:var(--elap-primary); margin-right:8px;"></i> ELAP — Настройки Модели, Таймлайна и Агента`,
    `
    <!-- НАВИГАЦИЯ ПО ВКЛАДКАМ -->
    <div class="elap-tabs-header">
      <button class="elap-tab-btn ${currentSettingsTab === 'agent' ? 'active' : ''}" data-tab="agent">
        <i class="fa-solid fa-robot"></i> 🤖 Агент и Модель
      </button>
      <button class="elap-tab-btn ${currentSettingsTab === 'prompt' ? 'active' : ''}" data-tab="prompt">
        <i class="fa-solid fa-terminal"></i> 📜 Промпт и Навыки
      </button>
      <button class="elap-tab-btn ${currentSettingsTab === 'timeline' ? 'active' : ''}" data-tab="timeline">
        <i class="fa-solid fa-clock"></i> ⏰ Таймлайн и Ивенты
      </button>
      <button class="elap-tab-btn ${currentSettingsTab === 'cards' ? 'active' : ''}" data-tab="cards">
        <i class="fa-solid fa-layer-group"></i> 🃏 Карточки Мира
      </button>
      <button class="elap-tab-btn ${currentSettingsTab === 'debug' ? 'active' : ''}" data-tab="debug">
        <i class="fa-solid fa-bug"></i> 🛠️ Дебаггер и Система
      </button>
    </div>

    <!-- ТАБ 1: АГЕНТ И МОДЕЛЬ -->
    <div id="elap_tab_pane_agent" class="elap-tab-pane" style="${currentSettingsTab === 'agent' ? '' : 'display:none;'}">
      <div class="elap-notice-box" style="margin-bottom:12px;">Параметры подключения модели, reasoning, режим правок (Diff Patch) и триггеры автозапуска агента.</div>

      <!-- CONNECTION PROFILE -->
      <div class="elap-row" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label><b><i class="fa-solid fa-network-wired"></i> Connection Profile для Агента:</b></label>
          <button id="elap_btn_refresh_profiles" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-rotate"></i> Обновить</button>
        </div>
        <select id="elap_cfg_profile" class="text_pole" style="width:100%; margin-top:2px; padding:6px 8px;"></select>
        <div id="elap_profile_info" style="font-size:11px; margin-top:6px; padding:6px 10px; background:rgba(255,255,200,0.03); border:1px solid #444; border-radius:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fa-solid fa-robot"></i> Модель: <b style="color:var(--elap-success);" id="elap_info_model">${esc(initProfInfo.model)}</b></span>
            <span><i class="fa-solid fa-plug"></i> API: <b style="color:var(--elap-warning);" id="elap_info_api">${esc(initProfInfo.api)}</b></span>
          </div>
          <small id="elap_info_hint" style="opacity:0.75; font-size:10px; display:block; margin-top:3px;">${esc(initProfInfo.hint || "")}</small>
        </div>
      </div>

      <!-- REASONING ПАРАМЕТРЫ -->
      <div class="elap-row" style="border:1px solid #5c6bc0; border-radius:8px; padding:10px; margin-bottom:12px; background:rgba(92,107,192,0.05);">
        <div style="font-size:13px; font-weight:bold; color:#ba68c8; margin-bottom:8px;">
          <i class="fa-solid fa-brain"></i> Параметры генерации и Reasoning (Модель Агента)
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
            <input id="elap_cfg_req_reasoning" type="checkbox" ${s.agentRequestReasoning === true ? "checked" : ""}>
            <b>Request Model Reasoning (Разрешить мысли/рассуждения)</b>
          </label>
        </div>

        <div id="elap_reasoning_controls_wrap" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px; opacity:${s.agentRequestReasoning ? '1' : '0.5'};">
          <div style="flex:1; min-width:140px;">
            <label style="font-size:11px; opacity:0.9;"><b>Reasoning Effort:</b></label>
            <select id="elap_cfg_reasoning_effort" class="text_pole" style="width:100%; margin-top:2px; font-size:12px;">
              <option value="none" ${s.agentReasoningEffort === 'none' ? 'selected' : ''}>none (Отключено / 0 Budget)</option>
              <option value="minimal" ${s.agentReasoningEffort === 'minimal' ? 'selected' : ''}>minimal (Минимум)</option>
              <option value="low" ${s.agentReasoningEffort === 'low' ? 'selected' : ''}>low (Низкий)</option>
              <option value="medium" ${s.agentReasoningEffort === 'medium' ? 'selected' : ''}>medium (Средний)</option>
              <option value="high" ${s.agentReasoningEffort === 'high' ? 'selected' : ''}>high (Глубокий)</option>
              <option value="custom" ${s.agentReasoningEffort === 'custom' ? 'selected' : ''}>custom budget (Точный лимит)</option>
            </select>
          </div>
          <div id="elap_custom_budget_wrap" style="flex:1; min-width:140px; display:${s.agentReasoningEffort === 'custom' ? 'block' : 'none'};">
            <label style="font-size:11px; opacity:0.9;"><b>Reasoning Budget (tokens):</b></label>
            <input id="elap_cfg_reasoning_budget" type="number" min="0" max="64000" step="128" value="${esc(s.agentReasoningBudget || 0)}" class="text_pole" style="width:100%; margin-top:2px;">
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div style="flex:1; min-width:130px;">
            <label style="font-size:11px; opacity:0.9;"><b>Context Size (tokens):</b></label>
            <input id="elap_cfg_context_size" type="number" min="512" max="2000000" step="512" value="${esc(s.agentContextSize || 8192)}" class="text_pole" style="width:100%; margin-top:2px;">
          </div>
          <div style="flex:1; min-width:130px;">
            <label style="font-size:11px; opacity:0.9;"><b>Max Response Tokens:</b></label>
            <input id="elap_cfg_max_tokens" type="number" min="100" max="64000" step="50" value="${esc(s.agentMaxTokens || 2500)}" class="text_pole" style="width:100%; margin-top:2px;">
          </div>
          <div style="flex:1; min-width:110px;">
            <label style="font-size:11px; opacity:0.9;"><b>Temperature:</b></label>
            <input id="elap_cfg_temperature" type="number" min="0.0" max="2.0" step="0.05" value="${esc(s.agentTemperature !== undefined ? s.agentTemperature : 0.1)}" class="text_pole" style="width:100%; margin-top:2px;">
          </div>
        </div>
      </div>

      <!-- РЕЖИМ РЕДАКТИРОВАНИЯ БЛОКОВ -->
      <div class="elap-row" style="margin-bottom:12px; padding:10px 12px; background:rgba(99,102,241,0.07); border:1px solid rgba(99,102,241,0.3); border-radius:6px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label for="elap_cfg_edit_mode" style="margin:0; font-weight:700; font-size:12.5px;">
            <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--elap-primary);"></i> Режим редактирования блоков:
          </label>
          <span style="font-size:11px; opacity:0.75;">Diff patch vs Перезапись</span>
        </div>
        <select id="elap_cfg_edit_mode" class="text_pole" style="width:100%; font-size:12px;">
          <option value="surgical" ${s.agentBlockEditMode === "surgical" || !s.agentBlockEditMode ? "selected" : ""}>
            🎯 Хирургический патч (Target Diff) — Редактирует только то, что изменилось (Рекомендуется)
          </option>
          <option value="overwrite" ${s.agentBlockEditMode === "overwrite" ? "selected" : ""}>
            📄 Полная перезапись (Классический) — Переписывает весь блок с нуля, как было раньше
          </option>
          <option value="auto" ${s.agentBlockEditMode === "auto" ? "selected" : ""}>
            ⚡ Авто / На выбор модели — Модель сама решает точечно заменить или переписать
          </option>
        </select>
      </div>

      <!-- NATIVE TOOL CALLING -->
      <div class="elap-row" style="margin-bottom:12px; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid #444; border-radius:6px;">
        <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input id="elap_cfg_native_tools" type="checkbox" ${s.agentUseNativeTools !== false ? "checked" : ""}>
          <b><i class="fa-solid fa-screwdriver-wrench" style="color:#38bdf8;"></i> Использовать Native Tool Calling API (OpenAI, Claude, Gemini, OpenRouter)</b>
        </label>
      </div>

      <!-- АВТОЗАПУСК И ПОВЕДЕНИЕ АГЕНТА -->
      <div class="elap-row" style="margin-bottom:8px; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid #444; border-radius:6px;">
        <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input id="elap_cfg_auto_run" type="checkbox" ${s.autoRunAgentAfterResponse !== false ? "checked" : ""}>
          <b>Запускать агента после ответа модели?</b>
        </label>
      </div>

      <div id="elap_cfg_freq_wrap" class="elap-row" style="margin-bottom:12px; margin-left:10px; padding:6px 10px; border-left:3px solid #555; opacity:${s.autoRunAgentAfterResponse !== false ? '1' : '0.45'};">
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <div style="flex:1; min-width:140px;">
            <label style="display:block; font-size:12px; margin-bottom:4px;"><b>Частота (Раз в N сообщ.):</b></label>
            <input id="elap_cfg_frequency" type="number" min="1" max="100" value="${esc(s.agentRunFrequency || 1)}" class="text_pole" style="width:100%;">
          </div>
          <div style="flex:1; min-width:140px;">
            <label style="display:block; font-size:12px; margin-bottom:4px;"><b>Кулдаун (сек):</b></label>
            <input id="elap_cfg_cooldown" type="number" min="0" max="60" value="${esc(s.agentCooldownSec || 2)}" class="text_pole" style="width:100%;">
          </div>
          <div style="flex:1; min-width:140px;">
            <label style="display:block; font-size:12px; margin-bottom:4px;"><b>Глубина чтения:</b></label>
            <input id="elap_cfg_depth" type="number" min="1" max="50" value="${esc(s.agentScanDepth || 3)}" class="text_pole" style="width:100%;">
          </div>
        </div>
      </div>

      <div class="elap-row" style="margin-bottom:8px; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid #444; border-radius:6px;">
        <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input id="elap_cfg_stream" type="checkbox" ${s.streamAgentResponse === true ? "checked" : ""}>
          <b>Стриминг текста в дебаггер</b>
        </label>
      </div>

      <div class="elap-row" style="margin-bottom:8px; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid #444; border-radius:6px;">
        <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input id="elap_cfg_send_static" type="checkbox" ${s.sendStaticToAgent !== false ? "checked" : ""}>
          <b>Присылать статичный лор агенту?</b>
        </label>
      </div>

      <div class="elap-row" style="margin-bottom:12px; padding:8px 10px; background:rgba(255,255,200,0.03); border:1px solid #444; border-radius:6px;">
        <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input id="elap_cfg_agent_toasts" type="checkbox" ${s.showAgentToasts !== false ? "checked" : ""}>
          <b>Уведомления о работе агента (Toast)</b>
        </label>
      </div>
    </div>

    <!-- ТАБ 2: ПРОМПТ И НАВЫКИ -->
    <div id="elap_tab_pane_prompt" class="elap-tab-pane" style="${currentSettingsTab === 'prompt' ? '' : 'display:none;'}">
      <div class="elap-notice-box" style="margin-bottom:12px;">Системные инструкции агента, модульные протоколы состояния (Skills) и мониторинг расхода токенов.</div>

      <!-- НАВЫКИ АГЕНТА (SKILLS) -->
      <div class="elap-row" style="margin-bottom:12px; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid #444; border-radius:6px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <b><i class="fa-solid fa-graduation-cap" style="color:#a855f7;"></i> Навыки Агента (Skills & Protocols):</b>
          <span style="font-size:11px; opacity:0.75;">Модульные инструкции состояния</span>
        </div>
        <div id="elap_skills_container" style="display:flex; flex-direction:column; gap:6px;">
          ${(s.agentSkills || []).map((sk) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; background:rgba(0,0,0,0.2); border:1px solid #333; border-radius:5px;">
              <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                <input type="checkbox" class="elap-skill-toggle" data-skill-id="${esc(sk.id)}" ${sk.enabled !== false ? "checked" : ""}>
                <div style="font-size:12px; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${esc(sk.name)}</div>
              </div>
              <span style="font-size:10.5px; opacity:0.7; margin-left:8px; text-align:right;">${esc(sk.description || "")}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- ПРОМПТ ДЛЯ АГЕНТА -->
      <div class="elap-row" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label><b><i class="fa-solid fa-terminal"></i> Системный промпт для Агента:</b></label>
          <button id="elap_btn_reset_agent_prompt" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-rotate-left"></i> По умолчанию</button>
        </div>
        <textarea id="elap_cfg_prompt" style="min-height:220px; font-family:monospace; font-size:12px; width:100%; box-sizing:border-box;">${esc(s.agentPrompt || DEFAULT_AGENT_PROMPT)}</textarea>
      </div>

      <!-- ТОКЕНЫ -->
      <div class="elap-token-box" style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <b style="font-size:12px; color:var(--elap-primary);"><i class="fa-solid fa-chart-simple"></i> Счетчик контекста промпта</b>
          <button id="elap_btn_recalc_tokens" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-rotate"></i> Пересчитать</button>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:6px; opacity:0.85;">
          <span>Системный: <b id="elap_tok_sys">0</b></span>
          <span>Контекст чата/ивентов: <b id="elap_tok_payload">0</b></span>
          <span>Итого: <b id="elap_tok_total" style="color:var(--elap-success);">0</b> / <span id="elap_tok_limit">8192</span></span>
        </div>
        <div class="elap-token-bar-wrap">
          <div id="elap_token_progress" class="elap-token-bar" style="width:0%;"></div>
        </div>
      </div>
    </div>

    <!-- ТАБ 3: ТАЙМЛАЙН И ИВЕНТЫ -->
    <div id="elap_tab_pane_timeline" class="elap-tab-pane" style="${currentSettingsTab === 'timeline' ? '' : 'display:none;'}">
      <div class="elap-notice-box" style="margin-bottom:12px;">Управление виртуальным временем, погодой, отображением в интерфейсе и сюжетными ивентами.</div>

      <!-- ТАЙМЛАЙН -->
      <div class="elap-row" style="margin-bottom:12px; padding:12px; background:rgba(186,104,200,0.06); border:1px solid #ba68c8; border-radius:8px;">
        <div style="font-size:13px; font-weight:bold; color:#ba68c8; margin-bottom:8px;">
          <i class="fa-solid fa-clock"></i> Таймлайн (Игровое время)
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="elap_cfg_timeline_enabled" type="checkbox" ${s.timelineEnabled !== false ? "checked" : ""}>
            <b>Включить Таймлайн</b>
          </label>
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="elap_cfg_timeline_prompt" type="checkbox" ${s.timelineIncludeInPrompt !== false ? "checked" : ""}>
            <b>Включать блок таймлайна в карточку {{ELAP}}</b>
          </label>
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="elap_cfg_timeline_weather" type="checkbox" ${s.timelineIncludeWeather !== false ? "checked" : ""}>
            <b>Включать погоду в заголовок таймлайна</b>
          </label>
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label style="font-size:11px; opacity:0.9;"><b>Отображение Таймлайна в интерфейсе:</b></label>
          <select id="elap_cfg_vis_mode" class="text_pole" style="width:100%; margin-top:3px;">
            <option value="hud" ${s.timelineVisualMode === 'hud' ? 'selected' : ''}>Плавающий HUD/Виджет (Чистый чат)</option>
            <option value="badge" ${s.timelineVisualMode === 'badge' ? 'selected' : ''}>UI-Бейдж над сообщением (Метаданные)</option>
            <option value="ghost" ${s.timelineVisualMode === 'ghost' ? 'selected' : ''}>Призрак (Только в карточке)</option>
          </select>
        </div>

        <div class="elap-row" style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px; border:1px solid #444;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:4px;">
            <input id="elap_cfg_custom_unit" type="checkbox" ${s.timelineCustomUnit ? "checked" : ""}>
            <b>Кастомная единица вместо «Day / День»</b>
          </label>
          <div id="elap_custom_unit_wrap" style="display:${s.timelineCustomUnit ? 'block' : 'none'};">
            <input id="elap_cfg_unit_name" type="text" value="${esc(s.timelineUnitName || 'Day')}" class="text_pole" placeholder="Сцена, Глава, Акт, Эпизод" style="width:100%;">
            <small style="opacity:0.75; font-size:10px; color:#ffb86c;">ℹ️ Не влияет на старые сообщения в чатах!</small>
          </div>
        </div>
      </div>

      <!-- ИВЕНТЫ -->
      <div class="elap-row" style="margin-bottom:12px; padding:12px; background:rgba(236,72,153,0.06); border:1px solid #ec4899; border-radius:8px;">
        <div style="font-size:13px; font-weight:bold; color:#f472b6; margin-bottom:8px;">
          <i class="fa-solid fa-bolt"></i> Сюжетные Ивенты (Sandbox Events)
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="elap_cfg_events_enabled" type="checkbox" ${s.eventsEnabled !== false ? "checked" : ""}>
            <b>Включить Сюжетные Ивенты (Sandbox Events)</b>
          </label>
        </div>

        <div class="elap-row" style="margin-bottom:4px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="elap_cfg_swipe_bypass" type="checkbox" ${s.eventsSwipeBypassEnabled !== false ? "checked" : ""}>
            <b>Свайп-защита от рельсов (Сброс ивента при свайпе в чате)</b>
          </label>
        </div>
      </div>
    </div>

    <!-- ТАБ 4: КАРТОЧКИ МИРА -->
    <div id="elap_tab_pane_cards" class="elap-tab-pane" style="${currentSettingsTab === 'cards' ? '' : 'display:none;'}">
      <div class="elap-notice-box" style="margin-bottom:12px;">Система динамических карточек мира и локаций (World Cards Engine). Pre-Agent сканирует сообщения и автоматически активирует карточки без регулярных выражений.</div>

      <div class="elap-row" style="border:1px solid #2e7d32; border-radius:8px; padding:12px; margin-bottom:12px; background:rgba(46,125,50,0.06);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="font-size:13px; font-weight:bold; color:#81c784;">
            <i class="fa-solid fa-layer-group"></i> Управление Колодами Мира
          </div>
          <div style="display:flex; gap:6px;">
            <button id="elap_cfg_btn_open_cards_mgr" class="elap-btn elap-btn-primary elap-btn-compact"><i class="fa-solid fa-layer-group"></i> Открыть Колоды</button>
            <button id="elap_cfg_btn_open_cards_dbg" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-bug"></i> Дебаггер карточек</button>
          </div>
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
            <input id="elap_cfg_cards_enabled" type="checkbox" ${s.cardsEnabled !== false ? "checked" : ""}>
            <b>Включить систему карточек мира</b>
          </label>
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
            <input id="elap_cfg_cards_preagent" type="checkbox" ${s.cardsPreAgentEnabled !== false ? "checked" : ""}>
            <b><i class="fa-solid fa-bolt" style="color:#f59e0b;"></i> Pre-Agent (семантическая проверка правил ДО ответа модели)</b>
          </label>
        </div>

        <div class="elap-row" style="margin-bottom:8px;">
          <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
            <input id="elap_cfg_cards_autoinject" type="checkbox" ${s.cardsAutoInjectActive !== false ? "checked" : ""}>
            <b>Автоматически внедрять активные карточки в промпт ({{elap}})</b>
          </label>
        </div>

        <div style="font-size:11.5px; opacity:0.8; margin-top:8px; padding:8px 10px; background:rgba(0,0,0,0.25); border-radius:6px; line-height:1.4;">
          <i class="fa-solid fa-circle-info" style="color:var(--elap-emerald); margin-right:4px;"></i>
          <b>Принцип работы:</b> При отправке сообщения пользователем нейросеть (Pre-Agent) находит подходящие карточки и активирует их на установленное число ходов (TTL). По истечении ходов карточка сама выгружается из промпта.
        </div>
      </div>
    </div>

    <!-- ТАБ 5: ДЕБАГГЕР И СИСТЕМА -->
    <div id="elap_tab_pane_debug" class="elap-tab-pane" style="${currentSettingsTab === 'debug' ? '' : 'display:none;'}">
      <div class="elap-notice-box" style="margin-bottom:12px;">
        Инспектор запросов и ответов для <b>Post-Agent</b> (синхронизация блоков) и <b>Pre-Agent</b> (роутер карточек). Здесь можно детально изучить отправленный в модель промпт и сырой ответ без открытия консоли браузера.
      </div>

      <!-- ВЫБОР АГЕНТА ДЛЯ ДЕБАГА -->
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <button id="elap_dbg_btn_select_post" class="elap-btn elap-btn-primary elap-btn-compact" style="flex:1;"><i class="fa-solid fa-robot"></i> Post-Agent (Блоки & Таймлайн)</button>
        <button id="elap_dbg_btn_select_pre" class="elap-btn elap-btn-secondary elap-btn-compact" style="flex:1;"><i class="fa-solid fa-layer-group"></i> Pre-Agent (Карточки Мира)</button>
      </div>

      <!-- БЛОК ДЕБАГА POST-AGENT -->
      <div id="elap_dbg_view_post">
        <div class="elap-row" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b><i class="fa-solid fa-robot" style="color:var(--elap-accent);"></i> Post-Agent: Ответ и действия</b>
            <span id="elap_dbg_post_time" style="font-size:11px; opacity:0.75; margin-left:6px;">(${esc(s.lastPostAgentTime || s.lastAgentTime || "ещё не запускался")})</span>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button id="elap_btn_run_manual" class="elap-btn elap-btn-primary elap-btn-compact" title="Запустить Post-Agent по текущему чату"><i class="fa-solid fa-play"></i> Запустить</button>
            <button id="elap_btn_stop_agent" class="elap-btn elap-btn-danger elap-btn-compact"><i class="fa-solid fa-stop"></i> Стоп</button>
            <button id="elap_dbg_post_toggle_raw" class="elap-btn elap-btn-secondary elap-btn-compact" title="Переключить между логом и сырым ответом"><i class="fa-solid fa-code"></i> RAW / Лог</button>
            <button id="elap_btn_copy_debug" class="elap-btn elap-btn-secondary elap-btn-compact" title="Копировать ответ"><i class="fa-solid fa-copy"></i> Копия ответа</button>
            <button id="elap_btn_clear_debug" class="elap-btn elap-btn-secondary elap-btn-compact" title="Очистить"><i class="fa-solid fa-broom"></i></button>
          </div>
        </div>
        <textarea id="elap_debug_output" class="elap-debug-box" style="min-height:180px; width:100%; box-sizing:border-box; font-family:monospace; font-size:11.5px;" readonly>${esc(s.lastPostAgentLog || s.lastAgentResponse || "")}</textarea>

        <div style="margin-top:10px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
          <b style="font-size:12px; opacity:0.9;"><i class="fa-solid fa-paper-plane"></i> Отправленный промпт в Post-Agent (System + Context Payload):</b>
          <button id="elap_btn_copy_post_prompt" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-copy"></i> Копировать промпт</button>
        </div>
        <textarea id="elap_dbg_post_prompt" class="elap-debug-box" style="min-height:130px; width:100%; box-sizing:border-box; font-family:monospace; font-size:11px; opacity:0.85;" readonly>${esc(s.lastPostAgentPrompt || "(Промпт ещё не отправлялся)")}</textarea>
      </div>

      <!-- БЛОК ДЕБАГА PRE-AGENT -->
      <div id="elap_dbg_view_pre" style="display:none;">
        <div class="elap-row" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b><i class="fa-solid fa-layer-group" style="color:#81c784;"></i> Pre-Agent: Ответ и активация карточек</b>
            <span id="elap_dbg_pre_time" style="font-size:11px; opacity:0.75; margin-left:6px;">(${esc(s.lastPreAgentTime || "ещё не запускался")})</span>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button id="elap_dbg_pre_toggle_raw" class="elap-btn elap-btn-secondary elap-btn-compact" title="Переключить между логом и сырым ответом"><i class="fa-solid fa-code"></i> RAW / Лог</button>
            <button id="elap_btn_copy_pre_resp" class="elap-btn elap-btn-secondary elap-btn-compact" title="Копировать ответ"><i class="fa-solid fa-copy"></i> Копия ответа</button>
            <button id="elap_btn_clear_pre" class="elap-btn elap-btn-secondary elap-btn-compact" title="Очистить"><i class="fa-solid fa-broom"></i></button>
          </div>
        </div>
        <textarea id="elap_dbg_pre_output" class="elap-debug-box" style="min-height:180px; width:100%; box-sizing:border-box; font-family:monospace; font-size:11.5px;" readonly>${esc(s.lastPreAgentLog || "Pre-Agent ещё не запускался.")}</textarea>

        <div style="margin-top:10px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
          <b style="font-size:12px; opacity:0.9;"><i class="fa-solid fa-paper-plane"></i> Отправленный промпт в Pre-Agent (Каталог карточек + Действие):</b>
          <button id="elap_btn_copy_pre_prompt" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-copy"></i> Копировать промпт</button>
        </div>
        <textarea id="elap_dbg_pre_prompt" class="elap-debug-box" style="min-height:130px; width:100%; box-sizing:border-box; font-family:monospace; font-size:11px; opacity:0.85;" readonly>${esc(s.lastPreAgentPrompt || "(Промпт ещё не отправлялся)")}</textarea>

        <!-- ТЕСТОВЫЙ ПРОГОН PRE-AGENT -->
        <div style="margin-top:12px; padding:10px; background:rgba(0,0,0,0.25); border:1px solid #444; border-radius:6px;">
          <b style="font-size:12px;"><i class="fa-solid fa-flask"></i> Ручной тест Pre-Agent:</b>
          <div style="font-size:11px; opacity:0.75; margin-bottom:6px;">Отправьте действие игрока на проверку роутеру, чтобы увидеть какие карточки мира среагируют:</div>
          <div style="display:flex; gap:6px;">
            <input id="elap_dbg_pre_test_input" type="text" class="text_pole" placeholder="Например: Я выхожу из таверны в снежную бурю..." style="flex:1; font-size:12px;">
            <button id="elap_dbg_pre_test_btn" class="elap-btn elap-btn-primary elap-btn-compact"><i class="fa-solid fa-bolt"></i> Проверить</button>
          </div>
        </div>
      </div>

      <hr style="margin:16px 0; border:none; border-top:1px solid #444;">

      <!-- СБРОС НАСТРОЕК -->
      <div class="elap-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:rgba(244,63,94,0.06); border:1px solid rgba(244,63,94,0.3); border-radius:8px;">
        <div>
          <b style="color:#fb7185; font-size:12.5px;"><i class="fa-solid fa-triangle-exclamation"></i> Опасная зона: Сброс ELAP</b>
          <div style="font-size:11px; opacity:0.75; margin-top:2px;">Полный сброс всех данных расширения ELAP к исходным настройкам</div>
        </div>
        <button id="elap_btn_hard_reset" class="elap-btn elap-btn-danger elap-btn-compact"><i class="fa-solid fa-triangle-exclamation"></i> Сброс настроек</button>
      </div>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  // ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
  const tabBtns = overlay.querySelectorAll(".elap-tab-btn");
  const tabPanes = {
    agent: overlay.querySelector("#elap_tab_pane_agent"),
    prompt: overlay.querySelector("#elap_tab_pane_prompt"),
    timeline: overlay.querySelector("#elap_tab_pane_timeline"),
    cards: overlay.querySelector("#elap_tab_pane_cards"),
    debug: overlay.querySelector("#elap_tab_pane_debug"),
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (!tab || !tabPanes[tab]) return;
      currentSettingsTab = tab;
      tabBtns.forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === tab));
      Object.keys(tabPanes).forEach((key) => {
        if (tabPanes[key]) tabPanes[key].style.display = key === tab ? "block" : "none";
      });
      if (tab === "prompt" && typeof updateTokensDisplay === "function") {
        updateTokensDisplay();
      }
    });
  });

  overlay.querySelector("#elap_cfg_timeline_enabled")?.addEventListener("change", (e) => { s.timelineEnabled = !!e.target.checked; save(); registerAllElapMacros(); renderSettingsUI(); });
  overlay.querySelector("#elap_cfg_events_enabled")?.addEventListener("change", (e) => { s.eventsEnabled = !!e.target.checked; save(); registerAllElapMacros(); });
  overlay.querySelector("#elap_cfg_swipe_bypass")?.addEventListener("change", (e) => { s.eventsSwipeBypassEnabled = !!e.target.checked; save(); });
  overlay.querySelector("#elap_cfg_cards_enabled")?.addEventListener("change", (e) => { s.cardsEnabled = !!e.target.checked; save(); registerAllElapMacros(); renderSettingsUI(); });
  overlay.querySelector("#elap_cfg_cards_preagent")?.addEventListener("change", (e) => {
    s.cardsPreAgentEnabled = !!e.target.checked;
    save();
    if (window.toastr) toastr.info(s.cardsPreAgentEnabled ? "Pre-Agent карточек ВКЛЮЧЁН" : "Pre-Agent выключен");
  });
  overlay.querySelector("#elap_cfg_cards_autoinject")?.addEventListener("change", (e) => { s.cardsAutoInjectActive = !!e.target.checked; save(); registerAllElapMacros(); });
  overlay.querySelector("#elap_cfg_btn_open_cards_mgr")?.addEventListener("click", () => openCardsManagerModal());
  overlay.querySelector("#elap_cfg_btn_open_cards_dbg")?.addEventListener("click", () => openCardDebuggerModal());
  overlay.querySelector("#elap_cfg_timeline_prompt")?.addEventListener("change", (e) => { s.timelineIncludeInPrompt = !!e.target.checked; save(); });
  overlay.querySelector("#elap_cfg_timeline_weather")?.addEventListener("change", (e) => { s.timelineIncludeWeather = !!e.target.checked; save(); });
  overlay.querySelector("#elap_cfg_vis_mode")?.addEventListener("change", (e) => { s.timelineVisualMode = e.target.value; save(); });

  const unitCheck = overlay.querySelector("#elap_cfg_custom_unit");
  const unitWrap = overlay.querySelector("#elap_custom_unit_wrap");
  unitCheck?.addEventListener("change", (e) => {
    s.timelineCustomUnit = !!e.target.checked;
    if (unitWrap) unitWrap.style.display = s.timelineCustomUnit ? "block" : "none";
    save();
  });
  overlay.querySelector("#elap_cfg_unit_name")?.addEventListener("input", (e) => {
    s.timelineUnitName = e.target.value;
    save();
  });

  const updateTokensDisplay = () => {
    const preview = buildAgentFullPromptPreview();
    const limit = Math.max(512, parseInt(s.agentContextSize) || 8192);

    const sysEl = overlay.querySelector("#elap_tok_sys");
    const payloadEl = overlay.querySelector("#elap_tok_payload");
    const totalEl = overlay.querySelector("#elap_tok_total");
    const limitEl = overlay.querySelector("#elap_tok_limit");
    const barEl = overlay.querySelector("#elap_token_progress");

    if (sysEl) sysEl.textContent = preview.systemTokens;
    if (payloadEl) payloadEl.textContent = preview.userTokens;
    if (totalEl) totalEl.textContent = preview.totalTokens;
    if (limitEl) limitEl.textContent = limit;

    if (barEl) {
      const pct = Math.min(100, Math.round((preview.totalTokens / limit) * 100));
      barEl.style.width = `${pct}%`;
      barEl.style.backgroundColor = pct > 90 ? "#ff5555" : pct > 70 ? "#ffb86c" : "#5c6bc0";
    }
  };

  updateTokensDisplay();
  overlay.querySelector("#elap_btn_recalc_tokens")?.addEventListener("click", updateTokensDisplay);

  const updateProfileInfoBadge = (profId) => {
    const info = getProfileDetails(profId);
    const modelEl = overlay.querySelector("#elap_info_model");
    const apiEl = overlay.querySelector("#elap_info_api");
    const hintEl = overlay.querySelector("#elap_info_hint");
    if (modelEl) modelEl.textContent = info.model;
    if (apiEl) apiEl.textContent = info.api;
    if (hintEl) hintEl.textContent = info.hint || "";
  };

  const populateProfilesDropdown = () => {
    const select = overlay.querySelector("#elap_cfg_profile");
    if (!select) return;

    const profiles = getConnectionProfiles();
    const isCurActive = !s.connectionProfile || s.connectionProfile === "__active__";

    let optionsHtml = `<option value="__active__" ${isCurActive ? "selected" : ""}>🟢 [Текущее активное подключение Таверны]</option>`;
    if (profiles.length) {
      optionsHtml += profiles
        .map((p) => {
          const modelName = resolveProfileModel(p);
          const isSelected = String(p.id) === String(s.connectionProfile);
          return `<option value="${p.id}" ${isSelected ? "selected" : ""}>📁 ${esc(p.name)} (${esc(modelName)})</option>`;
        })
        .join("");
    }
    select.innerHTML = optionsHtml;
    select.onchange = () => {
      s.connectionProfile = select.value;
      save();
      updateProfileInfoBadge(s.connectionProfile);
    };
    updateProfileInfoBadge(s.connectionProfile);
  };

  populateProfilesDropdown();
  overlay.querySelector("#elap_btn_refresh_profiles")?.addEventListener("click", populateProfilesDropdown);

  const reqReasoningCheckbox = overlay.querySelector("#elap_cfg_req_reasoning");
  const reasoningControlsWrap = overlay.querySelector("#elap_reasoning_controls_wrap");
  const reasoningEffortSelect = overlay.querySelector("#elap_cfg_reasoning_effort");
  const customBudgetWrap = overlay.querySelector("#elap_custom_budget_wrap");

  reqReasoningCheckbox?.addEventListener("change", (e) => {
    s.agentRequestReasoning = !!e.target.checked;
    if (reasoningControlsWrap) reasoningControlsWrap.style.opacity = s.agentRequestReasoning ? "1" : "0.5";
    save();
  });

  reasoningEffortSelect?.addEventListener("change", (e) => {
    s.agentReasoningEffort = e.target.value;
    if (customBudgetWrap) customBudgetWrap.style.display = s.agentReasoningEffort === "custom" ? "block" : "none";
    save();
  });

  overlay.querySelector("#elap_cfg_reasoning_budget")?.addEventListener("input", (e) => { s.agentReasoningBudget = Math.max(0, parseInt(e.target.value) || 0); save(); });
  overlay.querySelector("#elap_cfg_context_size")?.addEventListener("input", (e) => { s.agentContextSize = Math.max(512, parseInt(e.target.value) || 8192); save(); updateTokensDisplay(); });
  overlay.querySelector("#elap_cfg_max_tokens")?.addEventListener("input", (e) => { s.agentMaxTokens = Math.max(100, parseInt(e.target.value) || 2500); save(); });
  overlay.querySelector("#elap_cfg_temperature")?.addEventListener("input", (e) => { s.agentTemperature = Math.max(0, Math.min(2.0, parseFloat(e.target.value) || 0.1)); save(); });

  const autoRunCheckbox = overlay.querySelector("#elap_cfg_auto_run");
  const freqWrap = overlay.querySelector("#elap_cfg_freq_wrap");
  autoRunCheckbox?.addEventListener("change", (e) => {
    s.autoRunAgentAfterResponse = !!e.target.checked;
    if (freqWrap) freqWrap.style.opacity = s.autoRunAgentAfterResponse ? "1" : "0.45";
    save();
  });

  overlay.querySelector("#elap_cfg_frequency")?.addEventListener("input", (e) => { s.agentRunFrequency = Math.max(1, parseInt(e.target.value) || 1); save(); });
  overlay.querySelector("#elap_cfg_cooldown")?.addEventListener("input", (e) => { s.agentCooldownSec = Math.max(0, parseInt(e.target.value) || 0); save(); });
  overlay.querySelector("#elap_cfg_depth")?.addEventListener("input", (e) => { s.agentScanDepth = Math.max(1, parseInt(e.target.value) || 3); save(); updateTokensDisplay(); });
  overlay.querySelector("#elap_cfg_stream")?.addEventListener("change", (e) => { s.streamAgentResponse = !!e.target.checked; save(); });
  overlay.querySelector("#elap_cfg_send_static")?.addEventListener("change", (e) => { s.sendStaticToAgent = !!e.target.checked; save(); updateTokensDisplay(); });
  overlay.querySelector("#elap_cfg_agent_toasts")?.addEventListener("change", (e) => { s.showAgentToasts = !!e.target.checked; save(); });
  overlay.querySelector("#elap_cfg_edit_mode")?.addEventListener("change", (e) => {
    s.agentBlockEditMode = e.target.value;
    save();
    if (window.toastr) {
      const modeLabel = e.target.options[e.target.selectedIndex]?.text.split("—")[0].trim();
      toastr.info(`Режим агента: ${modeLabel}`);
    }
  });
  overlay.querySelector("#elap_cfg_native_tools")?.addEventListener("change", (e) => {
    s.agentUseNativeTools = !!e.target.checked;
    save();
    if (window.toastr) {
      toastr.info(s.agentUseNativeTools ? "Native Tool Calling API включен" : "Native Tool Calling API выключен");
    }
  });
  overlay.querySelectorAll(".elap-skill-toggle").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-skill-id");
      const targetSkill = (s.agentSkills || []).find((sk) => String(sk.id) === String(id));
      if (targetSkill) {
        targetSkill.enabled = !!e.target.checked;
        save();
        updateTokensDisplay();
      }
    });
  });
  overlay.querySelector("#elap_cfg_prompt")?.addEventListener("input", (e) => { s.agentPrompt = e.target.value; save(); updateTokensDisplay(); });

  overlay.querySelector("#elap_btn_reset_agent_prompt")?.addEventListener("click", () => {
    if (confirm("Сбросить промпт агента по умолчанию?")) {
      s.agentPrompt = DEFAULT_AGENT_PROMPT;
      overlay.querySelector("#elap_cfg_prompt").value = DEFAULT_AGENT_PROMPT;
      save();
      updateTokensDisplay();
    }
  });

  // --- ДЕБАГГЕР: ПЕРЕКЛЮЧЕНИЕ POST-AGENT / PRE-AGENT ---
  const btnSelPost = overlay.querySelector("#elap_dbg_btn_select_post");
  const btnSelPre = overlay.querySelector("#elap_dbg_btn_select_pre");
  const viewPost = overlay.querySelector("#elap_dbg_view_post");
  const viewPre = overlay.querySelector("#elap_dbg_view_pre");

  btnSelPost?.addEventListener("click", () => {
    btnSelPost.className = "elap-btn elap-btn-primary elap-btn-compact";
    btnSelPre.className = "elap-btn elap-btn-secondary elap-btn-compact";
    if (viewPost) viewPost.style.display = "block";
    if (viewPre) viewPre.style.display = "none";
  });

  btnSelPre?.addEventListener("click", () => {
    btnSelPre.className = "elap-btn elap-btn-primary elap-btn-compact";
    btnSelPost.className = "elap-btn elap-btn-secondary elap-btn-compact";
    if (viewPre) viewPre.style.display = "block";
    if (viewPost) viewPost.style.display = "none";
  });

  // --- POST-AGENT КНОПКИ ---
  let postAgentShowRaw = false;
  overlay.querySelector("#elap_dbg_post_toggle_raw")?.addEventListener("click", () => {
    postAgentShowRaw = !postAgentShowRaw;
    const out = overlay.querySelector("#elap_debug_output");
    if (out) {
      out.value = postAgentShowRaw
        ? (s.lastPostAgentRawResponse || "(Сырой ответ пуст)")
        : (s.lastPostAgentLog || s.lastAgentResponse || "");
    }
    if (window.toastr) toastr.info(postAgentShowRaw ? "Отображен сырой ответ модели" : "Отображен форматированный лог действий");
  });

  overlay.querySelector("#elap_btn_run_manual")?.addEventListener("click", async () => {
    await runAgentOnCurrentChat(true);
    const out = overlay.querySelector("#elap_debug_output");
    const pr = overlay.querySelector("#elap_dbg_post_prompt");
    const tm = overlay.querySelector("#elap_dbg_post_time");
    if (out) out.value = s.lastPostAgentLog || s.lastAgentResponse || "";
    if (pr) pr.value = s.lastPostAgentPrompt || "";
    if (tm) tm.textContent = `(${s.lastPostAgentTime || ""})`;
  });

  overlay.querySelector("#elap_btn_stop_agent")?.addEventListener("click", () => { stopAgentRequest("Остановлено вручную"); });

  overlay.querySelector("#elap_btn_clear_debug")?.addEventListener("click", () => {
    s.lastAgentResponse = "Лог очищен.";
    s.lastPostAgentLog = "Лог очищен.";
    s.lastPostAgentRawResponse = "";
    s.lastPostAgentPrompt = "";
    save();
    const out = overlay.querySelector("#elap_debug_output");
    const pr = overlay.querySelector("#elap_dbg_post_prompt");
    if (out) out.value = s.lastPostAgentLog;
    if (pr) pr.value = "";
    if (window.toastr) toastr.info("Лог Post-Agent очищен");
  });

  overlay.querySelector("#elap_btn_copy_debug")?.addEventListener("click", () => {
    const txt = overlay.querySelector("#elap_debug_output")?.value;
    if (txt) navigator.clipboard.writeText(txt).then(() => toastr.success("Ответ Post-Agent скопирован"));
  });

  overlay.querySelector("#elap_btn_copy_post_prompt")?.addEventListener("click", () => {
    const txt = overlay.querySelector("#elap_dbg_post_prompt")?.value;
    if (txt) navigator.clipboard.writeText(txt).then(() => toastr.success("Промпт Post-Agent скопирован"));
  });

  // --- PRE-AGENT КНОПКИ ---
  let preAgentShowRaw = false;
  overlay.querySelector("#elap_dbg_pre_toggle_raw")?.addEventListener("click", () => {
    preAgentShowRaw = !preAgentShowRaw;
    const out = overlay.querySelector("#elap_dbg_pre_output");
    if (out) {
      out.value = preAgentShowRaw
        ? (s.lastPreAgentRawResponse || "(Сырой ответ пуст)")
        : (s.lastPreAgentLog || "Pre-Agent ещё не запускался.");
    }
    if (window.toastr) toastr.info(preAgentShowRaw ? "Отображен сырой ответ Pre-Agent" : "Отображен лог карточек");
  });

  overlay.querySelector("#elap_btn_copy_pre_resp")?.addEventListener("click", () => {
    const txt = overlay.querySelector("#elap_dbg_pre_output")?.value;
    if (txt) navigator.clipboard.writeText(txt).then(() => toastr.success("Ответ Pre-Agent скопирован"));
  });

  overlay.querySelector("#elap_btn_copy_pre_prompt")?.addEventListener("click", () => {
    const txt = overlay.querySelector("#elap_dbg_pre_prompt")?.value;
    if (txt) navigator.clipboard.writeText(txt).then(() => toastr.success("Промпт Pre-Agent скопирован"));
  });

  overlay.querySelector("#elap_btn_clear_pre")?.addEventListener("click", () => {
    s.lastPreAgentLog = "Pre-Agent лог очищен.";
    s.lastPreAgentRawResponse = "";
    s.lastPreAgentPrompt = "";
    save();
    const out = overlay.querySelector("#elap_dbg_pre_output");
    const pr = overlay.querySelector("#elap_dbg_pre_prompt");
    if (out) out.value = s.lastPreAgentLog;
    if (pr) pr.value = "";
    if (window.toastr) toastr.info("Лог Pre-Agent очищен");
  });

  overlay.querySelector("#elap_dbg_pre_test_btn")?.addEventListener("click", async () => {
    const input = overlay.querySelector("#elap_dbg_pre_test_input");
    const text = String(input?.value || "").trim() || "Тестовое действие: я выхожу из теплой комнаты на улицу в метель и мороз";
    const out = overlay.querySelector("#elap_dbg_pre_output");
    const pr = overlay.querySelector("#elap_dbg_pre_prompt");
    const tm = overlay.querySelector("#elap_dbg_pre_time");
    if (out) out.value = `⏳ Pre-Agent сканирует действие: "${text}"...\nСверяем с каталогом карточек мира...`;

    try {
      const activated = await runPreAgentForCards(text);
      if (out) out.value = s.lastPreAgentLog || "Готово.";
      if (pr) pr.value = s.lastPreAgentPrompt || "";
      if (tm) tm.textContent = `(${s.lastPreAgentTime || ""})`;
      if (window.toastr) {
        if (activated.length > 0) {
          toastr.success(`Pre-Agent активировал карточки: [${activated.join(", ")}]`);
        } else {
          toastr.info("Pre-Agent завершил проверку: подходящих карточек не найдено");
        }
      }
    } catch (err) {
      if (out) out.value = `❌ Ошибка: ${err.message}`;
    }
  });

  overlay.querySelector("#elap_btn_hard_reset")?.addEventListener("click", () => {
    if (confirm("Полностью сбросить все данные и карточки ELAP?")) {
      hardResetElap();
      overlay.remove();
    }
  });
}

export function renderSettingsUI() {
  ensureCharactersState();
  const settings = S();

  const container = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
  if (!container) return;

  document.querySelector("#elap_settings")?.remove();

  const active = getActiveElapCharacter();
  const profileInfo = getProfileDetails(settings.connectionProfile);

  const html = `
<div id="elap_settings" class="elap-settings-block">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b><i class="fa-solid fa-brain" style="color:var(--elap-primary); margin-right:6px;"></i> Easy Long AI Play (ELAP)</b>
    </div>
    <div class="inline-drawer-content">
      <div class="elap-row elap-drawer-actions" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">
        <button id="elap_btn_open_inspector" class="elap-btn elap-btn-primary elap-btn-compact"><i class="fa-solid fa-magnifying-glass"></i> Inspector</button>
        <button id="elap_btn_open_cards" class="elap-btn elap-btn-accent elap-btn-compact"><i class="fa-solid fa-layer-group"></i> Колоды Мира</button>
        <button id="elap_btn_open_characters" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-users"></i> Персонажи</button>
        <button id="elap_btn_open_settings" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-sliders"></i> Настройки</button>
      </div>
      <div class="elap-row" style="margin-top:10px; display:flex; flex-direction:column; gap:4px; font-size:12px;">
        <div><i class="fa-solid fa-user" style="color:var(--elap-primary); width:16px;"></i> Активный: <b>${esc(active?.name || "не выбран")}</b></div>
        <div><i class="fa-solid fa-clock" style="color:var(--elap-accent); width:16px;"></i> Таймлайн: <b>${settings.timelineEnabled !== false ? "День " + (active?.timeline?.day || 1) + " (" + esc(active?.timeline?.time || '08:00') + ")" : "Отключен"}</b></div>
        <div><i class="fa-solid fa-crosshairs" style="color:var(--elap-accent); width:16px;"></i> Ивентов: <b>${Array.isArray(active?.events) ? active.events.length : 0}</b></div>
        <div><i class="fa-solid fa-layer-group" style="color:var(--elap-success); width:16px;"></i> Карточки Мира: <b>${settings.cardsEnabled !== false ? "Включены (" + (Array.isArray(settings.activeCardIds) ? settings.activeCardIds.length : 0) + " акт.)" : "Отключены"}</b></div>
        <div><i class="fa-solid fa-robot" style="color:var(--elap-primary); width:16px;"></i> Агент: <b>${esc(profileInfo.name)}</b> <span style="opacity:0.75; font-size:11px;">(${esc(profileInfo.model)})</span></div>
        <div><i class="fa-solid fa-bolt" style="color:var(--elap-warning); width:16px;"></i> Автозапуск: <b>${settings.autoRunAgentAfterResponse !== false ? `Раз в ${settings.agentRunFrequency || 1} сообщ.` : "Отключен"}</b></div>
      </div>
      <hr style="margin:10px 0; border:none; border-top:1px solid var(--elap-border);">
      <div class="elap-row"><b><i class="fa-solid fa-robot"></i> ELAP Assistant</b></div>
      <div id="elap_assistant_status" class="elap-row"></div>
      <div class="elap-row" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
        <button id="elap_check_assistant" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-rotate"></i> Проверить</button>
        <button id="elap_create_assistant" class="elap-btn elap-btn-primary elap-btn-compact"><i class="fa-solid fa-user-plus"></i> Создать Assistant</button>
      </div>
    </div>
  </div>
</div>`;

  container.insertAdjacentHTML("beforeend", html);

  document.querySelector("#elap_check_assistant")?.addEventListener("click", refreshAssistantStatus);
  document.querySelector("#elap_create_assistant")?.addEventListener("click", createAssistantCharacter);

  refreshAssistantStatus();
}

export function ensureEndDayButton() {
  if (document.querySelector("#elap_btn_end_day")) return;
  const sendBtn = document.querySelector("#send_but");
  if (!sendBtn) return;

  const endDayBtn = document.createElement("div");
  endDayBtn.id = "elap_btn_end_day";
  endDayBtn.className = "elap-chat-btn";
  endDayBtn.title = "ELAP: Завершить день (Итоги / Саммари дня)";
  endDayBtn.innerHTML = `<i class="fa-solid fa-moon"></i>`;
  sendBtn.parentNode.insertBefore(endDayBtn, sendBtn);
}

export function bindGlobalUIHandlers() {
  $(document)
    .off("click.elap", "#elap_btn_open_inspector")
    .on("click.elap", "#elap_btn_open_inspector", (e) => {
      e.preventDefault();
      openPromptInspectorModal();
    });

  $(document)
    .off("click.elap", "#elap_btn_open_cards")
    .on("click.elap", "#elap_btn_open_cards", (e) => {
      e.preventDefault();
      openCardsManagerModal();
    });

  $(document)
    .off("click.elap", "#elap_btn_open_characters")
    .on("click.elap", "#elap_btn_open_characters", (e) => {
      e.preventDefault();
      openCharactersModal();
    });

  $(document)
    .off("click.elap", "#elap_btn_open_settings")
    .on("click.elap", "#elap_btn_open_settings", (e) => {
      e.preventDefault();
      openSettingsModal();
    });

  $(document)
    .off("click.elap", "#elap_btn_end_day")
    .on("click.elap", "#elap_btn_end_day", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEndDayModal();
    });

  $(document)
    .off("click.elap_swipe_lock", ".swipe_left, .swipe_right, .mes_swipe_left, .mes_swipe_right, #option_regenerate")
    .on("click.elap_swipe_lock", ".swipe_left, .swipe_right, .mes_swipe_left, .mes_swipe_right, #option_regenerate", (e) => {
      if (isAgentBusy()) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (window.toastr) {
          toastr.warning("Агент ELAP анализирует диалог. Подождите завершения или нажмите «⏹ Стоп».");
        }
        return false;
      }
    });
}