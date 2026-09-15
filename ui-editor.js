// --- START OF FILE ui-editor.js ---

import {
  S,
  save,
  esc,
  deepClone,
  genId,
  sanitizeKey,
  ensureUniqueKeys,
  ensureCharactersState,
  setCurrentEditorDraft,
  currentEditorDraft,
  exportCharacterToJson,
  setActiveElapCharacter,
  extractCharacterFromPng,
  extractCharacterDataFromRaw,
} from "./state.js";
import { characters as st_characters } from "/script.js";
import { registerAllElapMacros } from "./macros.js";
import { DEFAULT_TIMELINE, DEFAULT_BLOCKS, DEFAULT_DAYS } from "./config.js";
import {
  parseExternalCharacterCard,
  registerActiveAgentAbortController,
  unregisterActiveAgentAbortController,
  stopAgentRequest,
} from "./agent.js";
import {
  switchOrStartCharacterChat,
  deleteAssistantChatFile,
  fetchAssistantChatsList,
  getElapCharacterAvatarUrl,
  patchChatAvatarsAndNames,
} from "./chat.js";
import { estimateTimelineWithAgent, getPeriodFromTime } from "./timeline.js";
import { generateStoryArcWithAgent } from "./events.js";
import { openEventsSandboxModal } from "./ui-events.js";
import {
  createElapOverlay,
  elapModalShell,
  bindModalCloseX,
  renderCharactersList,
  renderSettingsUI,
  setAgentUiBusy,
} from "./ui.js";

export function promptDeleteCharacterModal(charId, onSuccessCallback = null) {
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return;

  const overlay = createElapOverlay("elap_delete_char_overlay");
  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-trash-can" style="color:var(--elap-danger); margin-right:8px;"></i> Удаление: ${esc(char.name)}`,
    `
    <div style="margin-bottom:12px;">Вы уверены, что хотите удалить персонажа <b>«${esc(char.name)}»</b>?</div>
    ${char.chatId ? `<label style="display:flex; align-items:center; gap:6px; margin-bottom:12px;"><input id="elap_del_chat_checkbox" type="checkbox"> Удалить привязанный файл чата (<b>${esc(char.chatId)}</b>)</label>` : ""}
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button id="elap_confirm_delete_btn" class="elap-btn elap-btn-danger elap-btn-compact"><i class="fa-solid fa-trash-can"></i> Да, удалить</button>
      <button id="elap_cancel_delete_btn" class="elap-btn elap-btn-secondary elap-btn-compact">Отмена</button>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  overlay.querySelector("#elap_confirm_delete_btn")?.addEventListener("click", async () => {
    const deleteChat = !!overlay.querySelector("#elap_del_chat_checkbox")?.checked;
    if (deleteChat && char.chatId) await deleteAssistantChatFile(char.chatId);
    s.characters = s.characters.filter((c) => String(c.id) !== String(charId));
    if (String(s.activeCharacterId) === String(charId)) s.activeCharacterId = s.characters[0]?.id ?? null;
    save();
    registerAllElapMacros();
    renderCharactersList();
    renderSettingsUI();
    overlay.remove();
    if (onSuccessCallback) onSuccessCallback();
  });

  overlay.querySelector("#elap_cancel_delete_btn")?.addEventListener("click", () => overlay.remove());
}

export function openAvatarPickerModal(targetObj, onSave) {
  const overlay = createElapOverlay("elap_avatar_picker_overlay");
  const currentAvatar = String(targetObj?.avatar || "").trim();
  const stChars = Array.isArray(st_characters) ? st_characters.filter(Boolean) : [];

  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-image" style="color:var(--elap-primary); margin-right:8px;"></i> Выбор аватарки персонажа: ${esc(targetObj?.name || "")}`,
    `
    <div style="display:flex; gap:16px; align-items:flex-start; margin-bottom:16px; flex-wrap:wrap;">
      <div id="elap_av_picker_preview" style="width:84px; height:84px; border-radius:12px; overflow:hidden; border:2px solid var(--elap-primary); background:var(--elap-bg-elevated); display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 4px 12px rgba(0,0,0,0.4);">
      </div>
      <div style="flex:1; min-width:220px;">
        <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">1. Персонаж из SillyTavern:</label>
        <select id="elap_av_st_select" class="text_pole" style="width:100%; font-size:12px; margin-bottom:10px;">
          <option value="">-- Выберите персонажа из Таверны --</option>
          ${stChars.map((sc, idx) => `<option value="${idx}">${esc(sc.name || "Unnamed")}</option>`).join("")}
        </select>

        <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">2. Загрузить картинку с устройства:</label>
        <div style="margin-bottom:10px;">
          <label class="elap-btn elap-btn-secondary elap-btn-compact" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
            <i class="fa-solid fa-upload"></i> Выбрать PNG / JPG / WebP
            <input id="elap_av_file_input" type="file" accept="image/*" style="display:none;">
          </label>
        </div>

        <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">3. Или введите имя файла / URL картинки:</label>
        <input id="elap_av_url_input" type="text" class="text_pole" placeholder="URL картинки или имя файла в characters/" value="${esc(currentAvatar)}" style="width:100%; font-size:12px;">
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--elap-border-subtle); padding-top:12px;">
      <button id="elap_av_clear_btn" type="button" class="elap-btn elap-btn-ghost" style="color:var(--elap-danger);"><i class="fa-solid fa-trash-can"></i> Сбросить аватарку</button>
      <div style="display:flex; gap:8px;">
        <button id="elap_av_cancel_btn" type="button" class="elap-btn elap-btn-secondary elap-btn-compact">Отмена</button>
        <button id="elap_av_save_btn" type="button" class="elap-btn elap-btn-primary elap-btn-compact" style="font-weight:bold;"><i class="fa-solid fa-check"></i> Применить</button>
      </div>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  const previewBox = overlay.querySelector("#elap_av_picker_preview");
  const stSelect = overlay.querySelector("#elap_av_st_select");
  const fileInput = overlay.querySelector("#elap_av_file_input");
  const urlInput = overlay.querySelector("#elap_av_url_input");
  const btnSave = overlay.querySelector("#elap_av_save_btn");
  const btnClear = overlay.querySelector("#elap_av_clear_btn");
  const btnCancel = overlay.querySelector("#elap_av_cancel_btn");

  let selectedAvatar = currentAvatar;

  function renderPreview(val) {
    if (!previewBox) return;
    const testChar = { ...targetObj, avatar: val };
    const url = getElapCharacterAvatarUrl(testChar);
    if (url) {
      previewBox.innerHTML = `<img src="${esc(url)}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
      const initial = (targetObj?.name || "?").trim().charAt(0).toUpperCase();
      previewBox.innerHTML = `<span style="font-weight:700; font-size:28px; color:var(--elap-text-muted);">${esc(initial)}</span>`;
    }
  }

  renderPreview(selectedAvatar);

  stSelect?.addEventListener("change", () => {
    const idx = parseInt(stSelect.value, 10);
    if (!isNaN(idx) && stChars[idx]) {
      const sc = stChars[idx];
      selectedAvatar = sc.avatar || "";
      if (urlInput) urlInput.value = selectedAvatar;
      renderPreview(selectedAvatar);
    }
  });

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        selectedAvatar = ev.target.result;
        if (urlInput) urlInput.value = "data:image/...";
        renderPreview(selectedAvatar);
      }
    };
    reader.readAsDataURL(file);
  });

  urlInput?.addEventListener("input", () => {
    selectedAvatar = urlInput.value.trim();
    renderPreview(selectedAvatar);
  });

  btnClear?.addEventListener("click", () => {
    selectedAvatar = "";
    if (urlInput) urlInput.value = "";
    if (stSelect) stSelect.value = "";
    renderPreview(selectedAvatar);
  });

  btnCancel?.addEventListener("click", () => overlay.remove());

  btnSave?.addEventListener("click", () => {
    overlay.remove();
    if (onSave) onSave(selectedAvatar);
  });
}

export function openCharacterEditorModal(charId) {
  ensureCharactersState();
  const s = S();

  const idx = s.characters.findIndex((c) => String(c.id) === String(charId));
  if (idx < 0) return;

  const draft = deepClone(s.characters[idx]);
  setCurrentEditorDraft(draft);

  if (!Array.isArray(draft.blocks)) draft.blocks = [];
  if (!Array.isArray(draft.days)) draft.days = deepClone(DEFAULT_DAYS);
  if (!Array.isArray(draft.events)) draft.events = [];
  if (!draft.timeline) draft.timeline = deepClone(DEFAULT_TIMELINE);

  const charPrefix = sanitizeKey(draft.name).toLowerCase();
  const overlay = createElapOverlay("elap_char_prompt_overlay");
  const isBranch = Boolean(
    draft.chatId && (
      /^branch\s*#/i.test(draft.chatId) || 
      /^checkpoint\s*#/i.test(draft.chatId) || 
      (Array.isArray(draft.branches) && draft.branches.some((b) => String(b).toLowerCase() === String(draft.chatId).toLowerCase()))
    )
  );
  const boundChatLabel = draft.chatId ? esc(draft.chatId) : "(Чат еще не создан)";

  overlay.innerHTML = `
<div class="elap-modal" id="elap_editor_modal_box">
  <div class="elap-modal-sticky-header">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div id="elap_editor_char_avatar_wrap" style="position:relative; width:44px; height:44px; border-radius:10px; overflow:hidden; cursor:pointer; flex-shrink:0; border:2px solid var(--elap-primary);" title="Нажмите, чтобы изменить аватарку персонажа">
          <div id="elap_editor_char_avatar_box" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--elap-bg-elevated);"></div>
          <div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.65); text-align:center; font-size:9px; padding:1px 0; color:#fff;">
            <i class="fa-solid fa-camera"></i>
          </div>
        </div>
        <div>
          <b style="font-size:16px;"><i class="fa-solid fa-user-pen" style="color:var(--elap-primary); margin-right:6px;"></i> ELAP: <span id="elap_header_char_name">${esc(draft.name || "")}</span></b>
          <div style="font-size:11px; opacity:0.75;">Префикс: <code>{{${esc(charPrefix)}_...}}</code></div>
        </div>
      </div>
      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
        <button id="elap_btn_change_avatar" class="elap-btn elap-btn-secondary elap-btn-compact" title="Сменить аватарку персонажа"><i class="fa-solid fa-image"></i> Аватар</button>
        <button id="elap_btn_toggle_parser" class="elap-btn elap-btn-primary elap-btn-compact" title="Импорт сторонней карточки"><i class="fa-solid fa-wand-magic-sparkles"></i> Импорт</button>
        <button id="elap_editor_export_btn" class="elap-btn elap-btn-secondary elap-btn-compact" title="Экспорт в JSON"><i class="fa-solid fa-file-export"></i> JSON</button>
        <button id="elap_save_char_prompt" class="elap-btn elap-btn-success elap-btn-compact"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
        <button id="elap_close_char_prompt" class="elap-close-btn-x"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
      <div id="elap_bound_chat_wrapper" style="font-size:12px; opacity:0.85; display:flex; align-items:center; gap:6px;">
        <i class="${isBranch ? 'fa-solid fa-code-branch' : 'fa-solid fa-comments'}" ${isBranch ? 'style="color:#a78bfa;"' : ''}></i>
        <span>Файл чата: <b id="elap_bound_chat_name" style="color:var(--elap-success);">${boundChatLabel}</b></span>
        ${isBranch ? `<span class="elap-tag-badge" style="background:#7c3aed; color:#fff; font-size:10px; padding:2px 6px;"><i class="fa-solid fa-code-branch"></i> Ветка</span>` : ""}
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button id="elap_editor_open_summary" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-book-open"></i> Саммари</button>
        <button id="elap_editor_bind_chat" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-folder-open"></i> История чатов</button>
        <button id="elap_editor_open_chat" class="elap-btn elap-btn-primary elap-btn-compact"><i class="fa-solid fa-comments"></i> Чат</button>
        <button id="elap_editor_new_chat" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-plus"></i> Новый чат</button>
        <button id="elap_delete_char" class="elap-btn elap-btn-danger elap-btn-compact" title="Удалить"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </div>
  </div>

  <div class="elap-editor-split">
    <div class="elap-editor-main-col">

      <!-- ТАЙМЛАЙН -->
      <div id="elap_timeline_editor_block" class="elap-row" style="border:1px solid var(--elap-accent); border-radius:8px; padding:12px; margin-bottom:12px; background:rgba(186,104,200,0.04); transition:all 0.3s ease;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <b style="font-size:13px; color:var(--elap-accent);"><i class="fa-solid fa-clock"></i> Стартовый Таймлайн</b>
          <button id="elap_btn_lazy_timeline" class="elap-btn elap-btn-accent elap-btn-compact"><i class="fa-solid fa-bolt"></i> Заполнить агентом</button>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div style="width:80px;">
            <label style="font-size:11px; opacity:0.8;"><b>День #:</b></label>
            <input id="elap_tl_day" type="number" min="1" max="9999" value="${esc(draft.timeline.day || 1)}" class="text_pole" style="width:100%; font-size:12px; margin-top:2px;">
          </div>
          <div style="width:120px;">
            <label style="font-size:11px; opacity:0.8;"><b>Время суток:</b></label>
            <select id="elap_tl_period" class="text_pole" style="width:100%; font-size:12px; margin-top:2px;">
              <option value="Утро" ${draft.timeline.period === 'Утро' ? 'selected' : ''}>Утро</option>
              <option value="День" ${draft.timeline.period === 'День' ? 'selected' : ''}>День</option>
              <option value="Вечер" ${draft.timeline.period === 'Вечер' ? 'selected' : ''}>Вечер</option>
              <option value="Ночь" ${draft.timeline.period === 'Ночь' ? 'selected' : ''}>Ночь</option>
            </select>
          </div>
          <div style="flex:1; min-width:110px;">
            <label style="font-size:11px; opacity:0.8;"><b>Дата / День:</b></label>
            <input id="elap_tl_date" type="text" value="${esc(draft.timeline.date || 'Пятница')}" class="text_pole" style="width:100%; font-size:12px; margin-top:2px;">
          </div>
          <div style="flex:1; min-width:90px;">
            <label style="font-size:11px; opacity:0.8;"><b>Часы (ЧЧ:ММ):</b></label>
            <input id="elap_tl_time" type="text" value="${esc(draft.timeline.time || '21:00')}" class="text_pole" placeholder="21:00" style="width:100%; font-size:12px; margin-top:2px; font-family:monospace; color:var(--elap-warning);">
          </div>
          <div style="flex:1.4; min-width:140px;">
            <label style="font-size:11px; opacity:0.8;"><b>Погода:</b></label>
            <input id="elap_tl_weather" type="text" value="${esc(draft.timeline.weather || 'Тихая ясная ночь')}" class="text_pole" style="width:100%; font-size:12px; margin-top:2px;">
          </div>
        </div>
      </div>

      <!-- ЛАУНЧЕР СЮЖЕТНОЙ ПЕСОЧНИЦЫ -->
      <div class="elap-row" style="border:1px solid #5c6bc0; border-radius:8px; padding:12px; margin-bottom:12px; background:rgba(92,107,192,0.06); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="font-size:24px; color:var(--elap-accent);"><i class="fa-solid fa-crosshairs"></i></div>
          <div>
            <b style="font-size:13px; color:var(--elap-accent);">Сюжетная Песочница и Ивенты (Sandbox)</b>
            <div style="font-size:11px; opacity:0.75; margin-top:2px;">
              Графический таймлайн, привязка к сообщениям чата и ветвящиеся квесты.
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span id="elap_editor_events_badge" class="elap-tag-badge" style="background:#5c6bc0; color:#fff; font-size:11px; padding:4px 8px;">
            ${(draft.events || []).length} ивентов
          </span>
          <button id="elap_btn_open_sandbox" type="button" class="elap-btn elap-btn-accent elap-btn-compact">
            <i class="fa-solid fa-gamepad"></i> Открыть Песочницу
          </button>
        </div>
      </div>

      <!-- СТАРТОВОЕ СООБЩЕНИЕ -->
      <div class="elap-row" style="border:1px solid var(--elap-border); border-radius:8px; padding:8px 10px; margin-top:4px; background:rgba(255,255,200,0.01);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label style="font-size:12px;"><b><i class="fa-solid fa-comment-dots"></i> Стартовое сообщение при создании чата:</b></label>
          <div style="display:flex; align-items:center; gap:6px;">
            <small style="opacity:0.8; font-size:11px;">Отправитель:</small>
            <select id="elap_first_msg_role" class="text_pole" style="padding:1px 6px; font-size:11px;">
              <option value="char" ${draft.firstMessageRole === 'char' ? 'selected' : ''}>Модель (${esc(draft.name)})</option>
              <option value="user" ${draft.firstMessageRole === 'user' ? 'selected' : ''}>User (Пользователь)</option>
              <option value="system" ${draft.firstMessageRole === 'system' ? 'selected' : ''}>System (Системное)</option>
            </select>
          </div>
        </div>
        <textarea id="elap_first_message_content" style="min-height:75px; font-size:12px;">${esc(draft.firstMessage || "")}</textarea>
      </div>

      <!-- ДИНАМИЧЕСКИЕ БЛОКИ -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
        <b style="font-size:13px; color:var(--elap-accent);"><i class="fa-solid fa-cubes"></i> Блоки контекста и знаний</b>
        <span style="font-size:11px; opacity:0.8; color:#a5b4fc;"><i class="fa-solid fa-up-down-left-right" style="margin-right:4px;"></i> Перетаскивайте за угол для смены порядка в промпте</span>
      </div>
      <div id="elap_blocks_wrap" class="elap-row" style="margin-top:4px;"></div>

      <div class="elap-row" style="display:flex; gap:8px; margin-top:8px; margin-bottom:12px;">
        <input id="elap_new_block_name" type="text" placeholder="Имя нового блока (например, Inventory)" class="text_pole" style="flex:1;">
        <button id="elap_add_block" class="elap-btn elap-btn-success elap-btn-compact"><i class="fa-solid fa-plus"></i> Добавить блок</button>
      </div>
    </div>
  </div>
</div>`;

  document.body.appendChild(overlay);

  function updateEditorAvatar() {
    const box = overlay.querySelector("#elap_editor_char_avatar_box");
    if (!box) return;
    const url = getElapCharacterAvatarUrl(draft);
    if (url) {
      box.innerHTML = `<img src="${esc(url)}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
      const initial = (draft.name || "?").trim().charAt(0).toUpperCase();
      box.innerHTML = `<span style="font-weight:700; font-size:18px; color:var(--elap-primary);">${esc(initial)}</span>`;
    }
  }

  updateEditorAvatar();

  const handleAvatarChangeClick = () => {
    openAvatarPickerModal(draft, (newAvatar) => {
      draft.avatar = newAvatar;
      updateEditorAvatar();
      patchChatAvatarsAndNames(draft);
      renderCharactersList();
      if (window.toastr) toastr.success("Аватарка обновлена!");
    });
  };

  overlay.querySelector("#elap_editor_char_avatar_wrap")?.addEventListener("click", handleAvatarChangeClick);
  overlay.querySelector("#elap_btn_change_avatar")?.addEventListener("click", handleAvatarChangeClick);

  overlay.querySelector("#elap_btn_toggle_parser")?.addEventListener("click", () => {
    syncDraftFromDOM();
    openSmartImportModal({
      targetDraft: draft,
      onApplied: () => {
        drawBlocks();
        updateEditorAvatar();
        const nameEl = overlay.querySelector("#elap_header_char_name");
        if (nameEl && draft.name) nameEl.textContent = draft.name;
        const firstMsgEl = overlay.querySelector("#elap_first_message_content");
        if (firstMsgEl && draft.firstMessage) firstMsgEl.value = draft.firstMessage;
        if (draft.timeline) {
          const dayInput = overlay.querySelector("#elap_tl_day");
          if (dayInput) dayInput.value = draft.timeline.day || 1;
          const periodSelect = overlay.querySelector("#elap_tl_period");
          if (periodSelect) periodSelect.value = draft.timeline.period || "Утро";
          const dateInput = overlay.querySelector("#elap_tl_date");
          if (dateInput) dateInput.value = draft.timeline.date || "";
          const timeInput = overlay.querySelector("#elap_tl_time");
          if (timeInput) timeInput.value = draft.timeline.time || "08:00";
          const weatherInput = overlay.querySelector("#elap_tl_weather");
          if (weatherInput) weatherInput.value = draft.timeline.weather || "";
        }
      },
    });
  });

  function updateEventsCounterBadge() {
    const badge = overlay.querySelector("#elap_editor_events_badge");
    if (badge) {
      const count = (draft.events || []).length;
      const activeCount = (draft.events || []).filter((e) => e.status === "active").length;
      badge.textContent = `${count} ивентов (${activeCount} акт.)`;
    }
  }

  function updateBlockOrderNumbers() {
    const wrap = overlay.querySelector("#elap_blocks_wrap");
    if (!wrap) return;
    const rows = wrap.querySelectorAll(".elap-block-row");
    rows.forEach((r, idx) => {
      r.setAttribute("data-i", String(idx));
      const orderBadge = r.querySelector(".elap-block-order-num");
      if (orderBadge) orderBadge.textContent = `#${idx + 1}`;
      const posText = r.querySelector(".elap-order-pos-text");
      if (posText) posText.textContent = `#${idx + 1}`;
    });
  }

  function bindBlockDragAndDrop() {
    const wrap = overlay.querySelector("#elap_blocks_wrap");
    if (!wrap || wrap._dragBound) return;
    wrap._dragBound = true;

    let draggedRow = null;

    wrap.addEventListener("mousedown", (e) => {
      const handle = e.target.closest(".elap-block-corner-handle");
      if (handle) {
        const row = handle.closest(".elap-block-row");
        if (row) row.setAttribute("draggable", "true");
      }
    });

    wrap.addEventListener("dragstart", (e) => {
      const row = e.target.closest(".elap-block-row");
      if (!row) return;
      draggedRow = row;
      row.classList.add("elap-block-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.getAttribute("data-i") || "0");
    });

    wrap.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const targetRow = e.target.closest(".elap-block-row");
      if (!targetRow || !draggedRow || targetRow === draggedRow) return;

      const rect = targetRow.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        targetRow.parentNode.insertBefore(draggedRow, targetRow);
      } else {
        targetRow.parentNode.insertBefore(draggedRow, targetRow.nextSibling);
      }
      updateBlockOrderNumbers();
    });

    wrap.addEventListener("dragend", () => {
      if (draggedRow) {
        draggedRow.removeAttribute("draggable");
        draggedRow.classList.remove("elap-block-dragging");
      }
      wrap.querySelectorAll(".elap-block-row").forEach((r) => {
        r.removeAttribute("draggable");
        r.classList.remove("elap-block-dragging");
      });
      draggedRow = null;

      syncDraftFromDOM();
      updateBlockOrderNumbers();
    });

    document.addEventListener("mouseup", () => {
      if (wrap) {
        wrap.querySelectorAll(".elap-block-row[draggable='true']").forEach((r) => {
          if (!r.classList.contains("elap-block-dragging")) {
            r.removeAttribute("draggable");
          }
        });
      }
    });
  }

  function drawBlocks() {
    const wrap = overlay.querySelector("#elap_blocks_wrap");
    if (!wrap) return;

    if (!draft.blocks.length) {
      wrap.innerHTML = `<small style="opacity:.8;">Блоков нет. Добавь первый блок.</small>`;
      return;
    }

    wrap.innerHTML = draft.blocks
      .map((b, i) => {
        const isStaticBlock = !!b.isStatic || sanitizeKey(b.key).toLowerCase() === "static";
        const personalTag = `${charPrefix}_${sanitizeKey(b.key).toLowerCase()}`;
        return `
<div class="elap-row elap-block-row" data-i="${i}" data-old-key="${esc(b.key)}" style="border:1px solid ${isStaticBlock ? '#ffb86c44' : 'var(--elap-border)'}; border-radius:8px; padding:10px; margin-bottom:10px; background: ${isStaticBlock ? 'rgba(255, 184, 108, 0.03)' : 'var(--elap-bg-surface)'};">
  <div style="display:flex; gap:8px; margin-bottom:6px; align-items:center;">
    <div class="elap-block-corner-handle" title="Зажмите и перетащите блок за угол для смены очередности в промпте">
      <i class="fa-solid fa-grip-vertical"></i>
      <span class="elap-block-order-num">#${i + 1}</span>
    </div>
    <input data-f="name" type="text" value="${esc(b.name || "")}" placeholder="Название блока" style="flex:1;" ${isStaticBlock ? 'readonly style="opacity:0.8;"' : ''}>
    <span style="font-size:12px; opacity:0.8;">Ключ:</span>
    <input data-f="key" type="text" value="${esc(b.key || "")}" placeholder="Tag Key" style="width:130px; font-family:monospace; color:#9aed7b;" ${isStaticBlock ? 'readonly style="opacity:0.8; font-family:monospace; color:#ffb86c;"' : ''}>
    ${isStaticBlock ? '' : `
      <button data-act="set-base" class="elap-btn elap-btn-secondary elap-btn-compact" title="Сохранить текущее как базу"><i class="fa-solid fa-floppy-disk"></i> База</button>
      <button data-act="restore-base" class="elap-btn elap-btn-secondary elap-btn-compact" title="Сбросить к исходной базе"><i class="fa-solid fa-rotate-left"></i> Сброс</button>
      <button data-act="del-block" class="elap-btn elap-btn-danger elap-btn-compact" title="Удалить блок"><i class="fa-solid fa-trash-can"></i></button>
    `}
  </div>
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
    <div style="font-size:11px; opacity:0.75;">Макрос: <code>{{${esc(personalTag)}}}</code></div>
    <div style="font-size:10.5px; opacity:0.6; font-family:monospace;">Позиция в промпте: <b class="elap-order-pos-text">#${i + 1}</b></div>
  </div>
  <textarea data-f="content">${esc(b.content || "")}</textarea>
</div>`;
      })
      .join("");

    bindBlockDragAndDrop();
  }

  function syncDraftFromDOM() {
    draft.firstMessage = String(overlay.querySelector("#elap_first_message_content")?.value || "");
    draft.firstMessageRole = String(overlay.querySelector("#elap_first_msg_role")?.value || "char");

    draft.timeline = {
      enabled: true,
      day: Math.max(1, parseInt(overlay.querySelector("#elap_tl_day")?.value) || 1),
      period: String(overlay.querySelector("#elap_tl_period")?.value || "Утро"),
      date: String(overlay.querySelector("#elap_tl_date")?.value || "Пятница").trim(),
      time: String(overlay.querySelector("#elap_tl_time")?.value || "21:00").trim(),
      weather: String(overlay.querySelector("#elap_tl_weather")?.value || "Тихая ясная ночь").trim(),
      format: draft.timeline?.format || DEFAULT_TIMELINE.format,
    };

    const rows = overlay.querySelectorAll(".elap-block-row");
    const oldBlocks = deepClone(draft.blocks || []);

    draft.blocks = Array.from(rows).map((row, idx) => {
      const name = String(row.querySelector('[data-f="name"]')?.value || "").trim();
      const keyRaw = String(row.querySelector('[data-f="key"]')?.value || name || "block");
      const content = String(row.querySelector('[data-f="content"]')?.value || "");
      const oldKey = String(row.getAttribute("data-old-key") || "");
      const oldBlock = oldBlocks.find((b) => sanitizeKey(b.key) === sanitizeKey(oldKey)) || oldBlocks[idx] || {};
      const isStatic = oldBlock.isStatic !== undefined ? !!oldBlock.isStatic : sanitizeKey(keyRaw).toLowerCase() === "static";

      return {
        name: name || "Block",
        key: sanitizeKey(keyRaw),
        content,
        originalContent: oldBlock.originalContent !== undefined ? oldBlock.originalContent : content,
        isStatic,
      };
    });

    draft.blocks = ensureUniqueKeys(draft.blocks, "key", "block");
  }

  drawBlocks();
  updateEventsCounterBadge();

  // Автосинхронизация "Часы" ➔ "Время суток"
  overlay.querySelector("#elap_tl_time")?.addEventListener("input", (e) => {
    const timeVal = String(e.target.value || "").trim();
    const autoPeriod = getPeriodFromTime(timeVal);
    const periodSel = overlay.querySelector("#elap_tl_period");
    if (periodSel && autoPeriod) {
      periodSel.value = autoPeriod;
    }
  });

  // Открытие Песочницы Ивентов
  overlay.querySelector("#elap_btn_open_sandbox")?.addEventListener("click", () => {
    syncDraftFromDOM();
    openEventsSandboxModal(draft, () => {
      updateEventsCounterBadge();
    });
  });

  overlay.querySelector("#elap_btn_lazy_timeline")?.addEventListener("click", async () => {
    syncDraftFromDOM();
    const btn = overlay.querySelector("#elap_btn_lazy_timeline");
    try {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-gear fa-spin"></i> Оценка...`;
      const allLore = draft.blocks.map((b) => `[${b.name}]: ${b.content}`).join("\n\n");
      const res = await estimateTimelineWithAgent(allLore, draft.firstMessage);
      if (res) {
        draft.timeline.day = res.day;
        draft.timeline.date = res.date;
        draft.timeline.time = res.time;
        draft.timeline.period = res.period;
        draft.timeline.weather = res.weather;

        overlay.querySelector("#elap_tl_day").value = res.day;
        overlay.querySelector("#elap_tl_date").value = res.date;
        overlay.querySelector("#elap_tl_time").value = res.time;
        overlay.querySelector("#elap_tl_period").value = res.period;
        overlay.querySelector("#elap_tl_weather").value = res.weather;
        if (window.toastr) toastr.success("Таймлайн успешно заполнен!");
      }
    } finally {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-bolt"></i> Заполнить агентом`;
    }
  });

  overlay.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const setBaseBtn = t.closest('[data-act="set-base"]');
    if (setBaseBtn) {
      const row = setBaseBtn.closest(".elap-block-row");
      const idx = parseInt(row.getAttribute("data-i"), 10);
      const textarea = row.querySelector('[data-f="content"]');
      const curContent = textarea ? textarea.value : "";

      syncDraftFromDOM();
      if (draft.blocks[idx]) {
        draft.blocks[idx].originalContent = curContent;
        draft.blocks[idx].content = curContent;
      }

      const st = S();
      const curCharIdx = st.characters.findIndex((c) => String(c.id) === String(charId));
      if (curCharIdx >= 0) {
        st.characters[curCharIdx].blocks = deepClone(draft.blocks);
        save();
      }

      row.style.borderColor = "#50fa7b";
      setTimeout(() => { row.style.borderColor = "#444"; }, 1000);
      if (window.toastr) toastr.success("База для блока сохранена!");
      return;
    }

    const restoreBaseBtn = t.closest('[data-act="restore-base"]');
    if (restoreBaseBtn) {
      const row = restoreBaseBtn.closest(".elap-block-row");
      const idx = parseInt(row.getAttribute("data-i"), 10);
      const textarea = row.querySelector('[data-f="content"]');
      const targetBlock = draft.blocks[idx];
      if (!targetBlock) return;

      const baseText = targetBlock.originalContent !== undefined ? String(targetBlock.originalContent) : String(targetBlock.content || "");
      if (textarea) textarea.value = baseText;
      targetBlock.content = baseText;

      syncDraftFromDOM();
      const st = S();
      const curCharIdx = st.characters.findIndex((c) => String(c.id) === String(charId));
      if (curCharIdx >= 0) {
        st.characters[curCharIdx].blocks = deepClone(draft.blocks);
        save();
        registerAllElapMacros();
      }

      row.style.borderColor = "#ffb86c";
      setTimeout(() => { row.style.borderColor = "#444"; }, 1000);
      if (window.toastr) toastr.info("Блок откачен к базовому тексту.");
      return;
    }

    const delBlockBtn = t.closest('[data-act="del-block"]');
    if (delBlockBtn) {
      delBlockBtn.closest(".elap-block-row")?.remove();
      syncDraftFromDOM();
      drawBlocks();
    }
  });

  overlay.querySelector("#elap_add_block")?.addEventListener("click", () => {
    syncDraftFromDOM();
    const input = overlay.querySelector("#elap_new_block_name");
    const name = String(input?.value || "").trim();
    if (!name) return;

    draft.blocks.push({
      name,
      key: sanitizeKey(name),
      content: "",
      originalContent: "",
      isStatic: false,
    });
    input.value = "";
    drawBlocks();
  });

  overlay.querySelector("#elap_save_char_prompt")?.addEventListener("click", () => {
    syncDraftFromDOM();

    const st = S();
    const i = st.characters.findIndex((c) => String(c.id) === String(charId));
    if (i < 0) return;

    st.characters[i] = {
      ...st.characters[i],
      name: String(draft.name || st.characters[i].name || "Unnamed"),
      avatar: String(draft.avatar || st.characters[i].avatar || "").trim(),
      firstMessage: String(draft.firstMessage || ""),
      firstMessageRole: String(draft.firstMessageRole || "char"),
      timeline: deepClone(draft.timeline),
      events: deepClone(draft.events),
      blocks: deepClone(draft.blocks),
      days: deepClone(draft.days),
    };
    st.activeCharacterId = st.characters[i].id;

    save();
    registerAllElapMacros();
    patchChatAvatarsAndNames(st.characters[i]);
    renderCharactersList();
    renderSettingsUI();

    if (window.toastr) toastr.success("Карточка персонажа сохранена!");
  });

  overlay.querySelector("#elap_editor_export_btn")?.addEventListener("click", () => {
    syncDraftFromDOM();
    exportCharacterToJson(charId);
  });

  overlay.querySelector("#elap_editor_open_summary")?.addEventListener("click", () => {
    syncDraftFromDOM();
    const st = S();
    const curIdx = st.characters.findIndex((c) => String(c.id) === String(charId));
    if (curIdx >= 0) {
      st.characters[curIdx].avatar = String(draft.avatar || st.characters[curIdx].avatar || "").trim();
      st.characters[curIdx].blocks = deepClone(draft.blocks);
      st.characters[curIdx].timeline = deepClone(draft.timeline);
      st.characters[curIdx].events = deepClone(draft.events);
      save();
    }
    setCurrentEditorDraft(null);
    openSummaryModal(charId);
  });

  overlay.querySelector("#elap_editor_bind_chat")?.addEventListener("click", () => {
    syncDraftFromDOM();
    openBindChatModal(charId, () => {
      renderCharactersList();
      const isCurBranch = Boolean(
        draft.chatId && (
          /^branch\s*#/i.test(draft.chatId) || 
          /^checkpoint\s*#/i.test(draft.chatId) || 
          (Array.isArray(draft.branches) && draft.branches.some((b) => String(b).toLowerCase() === String(draft.chatId).toLowerCase()))
        )
      );
      const wrapEl = overlay.querySelector("#elap_bound_chat_wrapper");
      if (wrapEl) {
        wrapEl.innerHTML = `
          <i class="${isCurBranch ? 'fa-solid fa-code-branch' : 'fa-solid fa-comments'}" ${isCurBranch ? 'style="color:#a78bfa;"' : ''}></i>
          <span>Файл чата: <b id="elap_bound_chat_name" style="color:var(--elap-success);">${draft.chatId ? esc(draft.chatId) : "(Чат еще не создан)"}</b></span>
          ${isCurBranch ? `<span class="elap-tag-badge" style="background:#7c3aed; color:#fff; font-size:10px; padding:2px 6px;"><i class="fa-solid fa-code-branch"></i> Ветка</span>` : ""}
        `;
      } else {
        const boundEl = overlay.querySelector("#elap_bound_chat_name");
        if (boundEl) boundEl.textContent = draft.chatId || "(Чат еще не создан)";
      }
    });
  });

  overlay.querySelector("#elap_editor_open_chat")?.addEventListener("click", async () => {
    syncDraftFromDOM();
    const st = S();
    const curIdx = st.characters.findIndex((c) => String(c.id) === String(charId));
    if (curIdx >= 0) {
      st.characters[curIdx].avatar = String(draft.avatar || st.characters[curIdx].avatar || "").trim();
      st.characters[curIdx].blocks = deepClone(draft.blocks);
      st.characters[curIdx].timeline = deepClone(draft.timeline);
      st.characters[curIdx].events = deepClone(draft.events);
      save();
      patchChatAvatarsAndNames(st.characters[curIdx]);
    }
    setCurrentEditorDraft(null);
    overlay.remove();
    document.querySelector("#elap_chars_overlay")?.remove();
    await switchOrStartCharacterChat(charId, false);
  });

  overlay.querySelector("#elap_editor_new_chat")?.addEventListener("click", async () => {
    if (!confirm(`Создать новый чистый чат для ${draft.name}?`)) return;
    syncDraftFromDOM();
    const st = S();
    const curIdx = st.characters.findIndex((c) => String(c.id) === String(charId));
    if (curIdx >= 0) {
      st.characters[curIdx].avatar = String(draft.avatar || st.characters[curIdx].avatar || "").trim();
      st.characters[curIdx].blocks = deepClone(draft.blocks);
      st.characters[curIdx].timeline = deepClone(draft.timeline);
      st.characters[curIdx].events = deepClone(draft.events);
      save();
      patchChatAvatarsAndNames(st.characters[curIdx]);
    }
    setCurrentEditorDraft(null);
    overlay.remove();
    document.querySelector("#elap_chars_overlay")?.remove();
    await switchOrStartCharacterChat(charId, true);
  });

  overlay.querySelector("#elap_delete_char")?.addEventListener("click", () => {
    promptDeleteCharacterModal(charId, () => {
      setCurrentEditorDraft(null);
      overlay.remove();
    });
  });

  overlay.querySelector("#elap_close_char_prompt")?.addEventListener("click", () => {
    syncDraftFromDOM();
    const st = S();
    const curIdx = st.characters.findIndex((c) => String(c.id) === String(charId));
    if (curIdx >= 0) {
      st.characters[curIdx].avatar = String(draft.avatar || st.characters[curIdx].avatar || "").trim();
      st.characters[curIdx].blocks = deepClone(draft.blocks);
      st.characters[curIdx].timeline = deepClone(draft.timeline);
      st.characters[curIdx].events = deepClone(draft.events);
      save();
      patchChatAvatarsAndNames(st.characters[curIdx]);
    }
    setCurrentEditorDraft(null);
    overlay.remove();
    renderCharactersList();
  });
}

export function openSmartImportModal({ targetDraft = null, onApplied = null, onCreated = null } = {}) {
  const overlay = createElapOverlay("elap_smart_import_overlay");
  const isUpdatingExisting = Boolean(targetDraft);
  const currentName = targetDraft?.name || "";

  const stChars = Array.isArray(st_characters) ? st_characters.filter(Boolean) : [];

  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--elap-accent); margin-right:8px;"></i> Импорт сторонней карточки персонажа`,
    `
    <div style="font-size:12px; opacity:0.85; margin-bottom:12px;">
      Поддерживает <b>Janitor AI</b>, <b>Chub</b>, <b>SillyTavern (JSON/PNG)</b>, W++, Ali:Chat и произвольный текст описания.
    </div>

    <!-- ТАБЫ ИСТОЧНИКА -->
    <div style="display:flex; gap:6px; border-bottom:1px solid var(--elap-border); padding-bottom:8px; margin-bottom:12px;">
      <button id="elap_tab_btn_text" class="elap-btn elap-btn-primary elap-btn-compact" data-tab="text">
        <i class="fa-solid fa-clipboard"></i> Текст / JSON / Janitor
      </button>
      ${stChars.length ? `
      <button id="elap_tab_btn_tavern" class="elap-btn elap-btn-secondary elap-btn-compact" data-tab="tavern">
        <i class="fa-solid fa-masks-theater"></i> Из SillyTavern (${stChars.length})
      </button>` : ""}
      <button id="elap_tab_btn_file" class="elap-btn elap-btn-secondary elap-btn-compact" data-tab="file">
        <i class="fa-solid fa-file-arrow-up"></i> Файл карточки (.json, .png)
      </button>
    </div>

    <!-- КОНТЕНТ ТАБА 1: ТЕКСТ / JSON -->
    <div id="elap_tab_pane_text" class="elap-tab-pane">
      <textarea id="elap_smart_raw_input" style="min-height:200px; width:100%; font-size:12px; font-family:monospace; box-sizing:border-box;" placeholder="Вставьте сюда любой текст карточки (например, скопированное описание с Janitor AI) или JSON файл персонажа..."></textarea>
      <div style="font-size:11px; opacity:0.75; margin-top:4px;">
        <i class="fa-solid fa-circle-info" style="color:var(--elap-primary); margin-right:4px;"></i> Можно вставить всё описание с Janitor AI (включая First message, Personality, Scenario).
      </div>
    </div>

    <!-- КОНТЕНТ ТАБА 2: ИЗ SILLYTAVERN -->
    ${stChars.length ? `
    <div id="elap_tab_pane_tavern" class="elap-tab-pane" style="display:none;">
      <label style="font-size:12px; font-weight:600; display:block; margin-bottom:6px;">Выберите персонажа из SillyTavern:</label>
      <select id="elap_smart_st_select" class="text_pole" style="width:100%; font-size:13px; margin-bottom:10px;">
        <option value="">-- Выберите персонажа --</option>
        ${stChars.map((sc, idx) => `<option value="${idx}">${esc(sc.name || "Unnamed")}</option>`).join("")}
      </select>
      <div id="elap_smart_st_preview" style="display:none; padding:10px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid var(--elap-border); margin-bottom:8px;">
        <div style="display:flex; gap:10px; align-items:center;">
          <div id="elap_smart_st_avatar_box" style="width:48px; height:48px; border-radius:8px; overflow:hidden; flex-shrink:0; background:#333; display:flex; align-items:center; justify-content:center;"></div>
          <div style="overflow:hidden;">
            <b id="elap_smart_st_name" style="font-size:14px; color:var(--elap-accent);"></b>
            <div id="elap_smart_st_desc" style="font-size:11px; opacity:0.8; margin-top:3px; max-height:60px; overflow-y:auto; line-height:1.3;"></div>
          </div>
        </div>
      </div>
    </div>` : ""}

    <!-- КОНТЕНТ ТАБА 3: ФАЙЛ КАРТОЧКИ -->
    <div id="elap_tab_pane_file" class="elap-tab-pane" style="display:none;">
      <div id="elap_smart_drop_zone" style="border:2px dashed var(--elap-border); border-radius:8px; padding:24px; text-align:center; cursor:pointer; background:rgba(255,255,255,0.02); transition:all 0.2s ease;">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:32px; color:var(--elap-accent); margin-bottom:8px; display:block;"></i>
        <b style="font-size:13px;">Перетащите файл сюда или нажмите для выбора</b>
        <div style="font-size:11px; opacity:0.75; margin-top:4px;">Поддерживаются .json, .elap.json и .png карточки Tavern</div>
        <input id="elap_smart_file_input" type="file" accept=".json,.elap.json,.png" style="display:none;">
      </div>
      <div id="elap_smart_file_name_status" style="font-size:11.5px; color:var(--elap-success); margin-top:6px; text-align:center;"></div>
    </div>

    <!-- ОБЩИЕ ПОЛЯ: ИМЯ И НАСТРОЙКИ -->
    <div class="elap-row" style="margin-top:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <label style="font-size:12px; font-weight:600; min-width:110px;">Имя персонажа:</label>
      <input id="elap_smart_name_input" type="text" placeholder="Определится автоматически..." class="text_pole" style="flex:1; min-width:180px;" value="${isUpdatingExisting ? esc(currentName) : ""}">
    </div>

    ${isUpdatingExisting ? `
    <div class="elap-row" style="margin-top:8px; display:flex; gap:16px; font-size:12px;">
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
        <input type="radio" name="elap_smart_mode" value="update" checked>
        Обновить текущего открытого (${esc(currentName)})
      </label>
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
        <input type="radio" name="elap_smart_mode" value="new">
        Создать как нового персонажа
      </label>
    </div>` : `
    <div class="elap-row" style="margin-top:8px; display:flex; gap:16px; font-size:12px;">
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
        <input id="elap_smart_open_editor_cb" type="checkbox" checked>
        Сразу открыть редактор после создания
      </label>
    </div>`}

    <!-- ПРЕВЬЮ РЕЗУЛЬТАТА ПАРСИНГА -->
    <div id="elap_smart_preview_box" style="display:none; margin-top:10px; padding:10px; background:rgba(92,107,192,0.08); border:1px solid rgba(92,107,192,0.3); border-radius:6px; font-size:11.5px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <b style="color:var(--elap-accent);"><i class="fa-solid fa-list-check"></i> Распознанные данные:</b>
        <span id="elap_smart_preview_badge" class="elap-tag-badge" style="background:#5c6bc0; color:#fff; font-size:10px;">Готово</span>
      </div>
      <div id="elap_smart_preview_details" style="opacity:0.9; line-height:1.4;"></div>
    </div>

    <!-- СТАТУС АГЕНТА -->
    <div id="elap_smart_agent_status" style="display:none; margin-top:10px; padding:8px 12px; border-radius:6px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.3); font-size:11.5px; text-align:center;">
      <i class="fa-solid fa-gear fa-spin" style="margin-right:6px; color:var(--elap-warning);"></i>
      <span id="elap_smart_agent_status_text">Анализ карточки с помощью AI...</span>
    </div>

    <!-- ДЕЙСТВИЯ -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; gap:8px;">
        <button id="elap_btn_do_quick_import" class="elap-btn elap-btn-success elap-btn-compact" style="font-weight:bold;">
          <i class="fa-solid fa-bolt"></i> ${isUpdatingExisting ? "Применить к персонажу" : "Быстрый импорт"}
        </button>
        <button id="elap_btn_do_agent_import" class="elap-btn elap-btn-accent elap-btn-compact">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Умный разбор с AI
        </button>
      </div>
      <button id="elap_btn_close_smart_modal" class="elap-btn elap-btn-secondary elap-btn-compact">Отмена</button>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);
  overlay.querySelector("#elap_btn_close_smart_modal")?.addEventListener("click", () => overlay.remove());

  // ТАБЫ
  let activeTab = "text";
  let parsedFileData = null;
  let selectedTavernChar = null;

  const tabBtns = overlay.querySelectorAll("[data-tab]");
  const tabPanes = {
    text: overlay.querySelector("#elap_tab_pane_text"),
    tavern: overlay.querySelector("#elap_tab_pane_tavern"),
    file: overlay.querySelector("#elap_tab_pane_file"),
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.getAttribute("data-tab");
      tabBtns.forEach((b) => {
        if (b.getAttribute("data-tab") === activeTab) {
          b.classList.remove("elap-btn-secondary");
          b.classList.add("elap-btn-primary");
        } else {
          b.classList.remove("elap-btn-primary");
          b.classList.add("elap-btn-secondary");
        }
      });
      Object.keys(tabPanes).forEach((k) => {
        if (tabPanes[k]) tabPanes[k].style.display = k === activeTab ? "block" : "none";
      });
      updateLivePreview();
    });
  });

  const textarea = overlay.querySelector("#elap_smart_raw_input");
  const nameInput = overlay.querySelector("#elap_smart_name_input");
  const previewBox = overlay.querySelector("#elap_smart_preview_box");
  const previewDetails = overlay.querySelector("#elap_smart_preview_details");

  function getRawContentToParse() {
    if (activeTab === "tavern" && selectedTavernChar) {
      return { type: "tavern", char: selectedTavernChar };
    }
    if (activeTab === "file" && parsedFileData) {
      return { type: "file", data: parsedFileData };
    }
    return { type: "text", text: String(textarea?.value || "").trim() };
  }

  function updateLivePreview() {
    const src = getRawContentToParse();
    let res = null;
    if (src.type === "tavern") {
      res = extractCharacterDataFromRaw("", src.char);
    } else if (src.type === "file") {
      res = src.data;
    } else if (src.type === "text" && src.text) {
      res = extractCharacterDataFromRaw(src.text);
    }

    if (res) {
      if (!nameInput.value || nameInput.dataset.autoFilled === "true") {
        nameInput.value = res.name || "";
        nameInput.dataset.autoFilled = "true";
      }
      previewBox.style.display = "block";
      const blocksCount = Array.isArray(res.blocks) ? res.blocks.length : 0;
      const firstMsgSnippet = res.firstMessage ? `${res.firstMessage.slice(0, 60)}...` : "(нет)";
      previewDetails.innerHTML = `
        👤 <b>Имя:</b> ${esc(res.name)} |
        💬 <b>Приветствие:</b> ${esc(firstMsgSnippet)} |
        📦 <b>Блоков:</b> ${blocksCount} (${(res.blocks || []).map((b) => b.name).join(", ")})
      `;
    } else {
      previewBox.style.display = "none";
    }
  }

  textarea?.addEventListener("input", () => {
    nameInput.dataset.autoFilled = "true";
    updateLivePreview();
  });

  // TAVERN SELECTOR
  const tavernSelect = overlay.querySelector("#elap_smart_st_select");
  tavernSelect?.addEventListener("change", () => {
    const idx = parseInt(tavernSelect.value, 10);
    if (!isNaN(idx) && stChars[idx]) {
      selectedTavernChar = stChars[idx];
      const previewDiv = overlay.querySelector("#elap_smart_st_preview");
      const nameEl = overlay.querySelector("#elap_smart_st_name");
      const descEl = overlay.querySelector("#elap_smart_st_desc");
      const avBox = overlay.querySelector("#elap_smart_st_avatar_box");

      if (previewDiv) previewDiv.style.display = "block";
      if (nameEl) nameEl.textContent = selectedTavernChar.name || "Unnamed";
      if (descEl) descEl.textContent = selectedTavernChar.description || selectedTavernChar.first_mes || "";
      if (avBox) {
        if (selectedTavernChar.avatar) {
          avBox.innerHTML = `<img src="/characters/${encodeURIComponent(selectedTavernChar.avatar)}" style="width:100%; height:100%; object-fit:cover;">`;
        } else {
          avBox.innerHTML = `<span style="font-weight:bold; font-size:18px; color:#fff;">${selectedTavernChar.name?.charAt(0)?.toUpperCase() || "?"}</span>`;
        }
      }
      nameInput.value = selectedTavernChar.name || "";
      nameInput.dataset.autoFilled = "true";
      updateLivePreview();
    } else {
      selectedTavernChar = null;
      overlay.querySelector("#elap_smart_st_preview")?.style.setProperty("display", "none");
      updateLivePreview();
    }
  });

  // FILE UPLOAD & DROP
  const dropZone = overlay.querySelector("#elap_smart_drop_zone");
  const fileInput = overlay.querySelector("#elap_smart_file_input");
  const fileNameStatus = overlay.querySelector("#elap_smart_file_name_status");

  dropZone?.addEventListener("click", () => fileInput?.click());
  dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--elap-accent)";
    dropZone.style.background = "rgba(186,104,200,0.08)";
  });
  dropZone?.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "var(--elap-border)";
    dropZone.style.background = "rgba(255,255,255,0.02)";
  });
  dropZone?.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--elap-border)";
    dropZone.style.background = "rgba(255,255,255,0.02)";
    const files = e.dataTransfer.files;
    if (files && files.length) await handleFile(files[0]);
  });

  fileInput?.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (files && files.length) await handleFile(files[0]);
  });

  async function handleFile(file) {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(".png")) {
        const buffer = await file.arrayBuffer();
        const extracted = extractCharacterFromPng(buffer);
        if (!extracted) {
          if (window.toastr) toastr.error("В PNG файле не найдены метаданные карточки Tavern/Chara");
          return;
        }
        parsedFileData = extractCharacterDataFromRaw(extracted);
        if (parsedFileData && !parsedFileData.avatar) {
          const base64Png = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result || "");
            reader.onerror = () => resolve("");
            reader.readAsDataURL(file);
          });
          if (base64Png) parsedFileData.avatar = base64Png;
        }
      } else {
        const text = await file.text();
        parsedFileData = extractCharacterDataFromRaw(text);
      }

      if (parsedFileData) {
        if (fileNameStatus) fileNameStatus.textContent = `✓ Загружен файл: ${file.name}`;
        nameInput.value = parsedFileData.name || "";
        nameInput.dataset.autoFilled = "true";
        updateLivePreview();
      } else {
        if (window.toastr) toastr.error("Не удалось прочитать карточку из файла");
      }
    } catch (err) {
      if (window.toastr) toastr.error(`Ошибка чтения: ${err.message}`);
    }
  }

  // ОБРАБОТЧИК ПРИМЕНЕНИЯ / СОЗДАНИЯ
  function finalizeCharacterData(extractedData) {
    if (!extractedData) return null;
    const finalName = String(nameInput.value || extractedData.name || "Imported Character").trim();
    extractedData.name = finalName;

    const s = S();
    const mode = overlay.querySelector('input[name="elap_smart_mode"]:checked')?.value || "update";

    if (isUpdatingExisting && mode === "update") {
      targetDraft.name = finalName;
      if (extractedData.avatar) targetDraft.avatar = extractedData.avatar;
      targetDraft.firstMessage = extractedData.firstMessage || targetDraft.firstMessage || "";
      targetDraft.firstMessageRole = extractedData.firstMessageRole || targetDraft.firstMessageRole || "char";
      if (extractedData.timeline) targetDraft.timeline = deepClone(extractedData.timeline);
      if (Array.isArray(extractedData.blocks) && extractedData.blocks.length) {
        targetDraft.blocks = deepClone(extractedData.blocks);
      }
      overlay.remove();
      if (onApplied) onApplied(targetDraft);
      if (window.toastr) toastr.success(`Карточка «${finalName}» успешно обновлена!`);
      return targetDraft;
    }

    // Создание нового персонажа
    const newId = genId();
    const newChar = {
      id: newId,
      name: finalName,
      avatar: extractedData.avatar || "",
      chatId: null,
      firstMessage: String(extractedData.firstMessage || ""),
      firstMessageRole: String(extractedData.firstMessageRole || "char"),
      timeline: extractedData.timeline ? deepClone(extractedData.timeline) : deepClone(DEFAULT_TIMELINE),
      events: Array.isArray(extractedData.events) ? deepClone(extractedData.events) : [],
      blocks: Array.isArray(extractedData.blocks) && extractedData.blocks.length ? deepClone(extractedData.blocks) : deepClone(DEFAULT_BLOCKS),
      days: deepClone(DEFAULT_DAYS),
    };

    s.characters.push(newChar);
    s.activeCharacterId = newId;
    save();
    registerAllElapMacros();
    renderCharactersList();
    renderSettingsUI();

    overlay.remove();

    const openEditorCb = overlay.querySelector("#elap_smart_open_editor_cb");
    const shouldOpenEditor = openEditorCb ? openEditorCb.checked : true;

    if (onCreated) onCreated(newChar);
    if (shouldOpenEditor && !isUpdatingExisting) {
      openCharacterEditorModal(newId);
    }
    if (window.toastr) toastr.success(`Персонаж «${finalName}» успешно создан!`);
    return newChar;
  }

  // КНОПКА: БЫСТРЫЙ ИМПОРТ
  overlay.querySelector("#elap_btn_do_quick_import")?.addEventListener("click", () => {
    const src = getRawContentToParse();
    let extracted = null;
    if (src.type === "tavern") {
      extracted = extractCharacterDataFromRaw("", src.char);
    } else if (src.type === "file") {
      extracted = src.data;
    } else if (src.type === "text") {
      if (!src.text) {
        if (window.toastr) toastr.warning("Вставьте текст карточки или выберите файл/персонажа");
        return;
      }
      extracted = extractCharacterDataFromRaw(src.text);
    }

    if (!extracted) {
      if (window.toastr) toastr.error("Не удалось разобрать данные персонажа");
      return;
    }

    finalizeCharacterData(extracted);
  });

  // КНОПКА: УМНЫЙ РАЗБОР С AI
  overlay.querySelector("#elap_btn_do_agent_import")?.addEventListener("click", async () => {
    const src = getRawContentToParse();
    let textToAnalyze = "";

    if (src.type === "tavern" && src.char) {
      const c = src.char;
      textToAnalyze = `Имя: ${c.name || ""}\nОписание: ${c.description || ""}\nЛичность: ${c.personality || ""}\nСценарий: ${c.scenario || ""}\nСтартовое сообщение: ${c.first_mes || ""}`;
    } else if (src.type === "file" && src.data) {
      textToAnalyze = JSON.stringify(src.data, null, 2);
    } else if (src.type === "text") {
      textToAnalyze = src.text;
    }

    if (!textToAnalyze || !textToAnalyze.trim()) {
      if (window.toastr) toastr.warning("Вставьте текст карточки для анализа");
      return;
    }

    const btnAgent = overlay.querySelector("#elap_btn_do_agent_import");
    const statusBox = overlay.querySelector("#elap_smart_agent_status");
    const statusText = overlay.querySelector("#elap_smart_agent_status_text");

    try {
      if (btnAgent) btnAgent.disabled = true;
      if (statusBox) statusBox.style.display = "block";
      if (statusText) statusText.textContent = "Анализ текста моделью и раскладка по динамическим блокам...";

      const aiResult = await parseExternalCharacterCard(textToAnalyze, true);
      if (!aiResult || typeof aiResult !== "object") {
        throw new Error("Модель не вернула разобранный объект карточки");
      }

      finalizeCharacterData(aiResult);
    } catch (err) {
      if (window.toastr) toastr.error(`Ошибка разбора AI: ${err.message}`);
    } finally {
      if (btnAgent) btnAgent.disabled = false;
      if (statusBox) statusBox.style.display = "none";
    }
  });
}

export function openArcGeneratorModal(charOrDraft, onGeneratedCallback) {
  const overlay = createElapOverlay("elap_arc_modal");
  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--elap-accent); margin-right:8px;"></i> Генератор сюжетной арки (DnD / Квесты)`,
    `
    <div style="margin-bottom:12px; font-size:12px; opacity:0.85;">
      Агент создаст связанную цепочку сюжетных ивентов на основе лора и биографии персонажа.
    </div>
    <div class="elap-row">
      <label><b>Жанр и атмосфера квеста:</b></label>
      <select id="elap_arc_genre" class="text_pole" style="width:100%; margin-top:4px;">
        <option value="dnd_fantasy">DnD / Фэнтези Приключение (Боссы, лут, тайники)</option>
        <option value="mystery_detective">Детектив / Триллер (Улики, подозрения, гости)</option>
        <option value="catastrophe_survival">Катастрофа / Выживание (Аномалии, туман, ЧС)</option>
        <option value="slice_of_life">Повседневная драма (Внезапные гости, тайны прошлого)</option>
        <option value="absurd_comedy">Комедийный хаос (НЛО, безумные совпадения)</option>
      </select>
    </div>
    <div class="elap-row" style="margin-top:10px;">
      <label><b>Количество событий в цепочке:</b></label>
      <input id="elap_arc_count" type="number" min="2" max="10" value="3" class="text_pole" style="width:100%; margin-top:4px;">
    </div>

    <!-- ЧЕКБОКС: ИГРА ВСЛЕПУЮ -->
    <div class="elap-row" style="margin-top:12px; padding:10px; background:rgba(255,255,200,0.03); border:1px solid #444; border-radius:6px;">
      <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
        <input id="elap_arc_blind" type="checkbox" checked>
        <div>
          <b>Режим «Игра вслепую» (Без спойлеров для меня)</b>
          <div style="font-size:11px; opacity:0.75;">Текст событий будет заблокирован заглушкой до наступления момента в игре!</div>
        </div>
      </label>
    </div>

    <!-- ЧЕКБОКС: УЧИТЫВАТЬ ДИАЛОГ -->
    <div class="elap-row" style="margin-top:8px; padding:10px; background:rgba(255,255,200,0.03); border:1px solid #444; border-radius:6px;">
      <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
        <input id="elap_arc_include_chat" type="checkbox">
        <div>
          <b>Учитывать последние сообщения текущего чата</b>
          <div style="font-size:11px; opacity:0.75;">Если выключено — сюжет генерируется строго по лору карточки персонажа.</div>
        </div>
      </label>
    </div>

    <!-- ИНДИКАТОР ПРОГРЕССА ГЕНЕРАЦИИ -->
    <div id="elap_arc_status_box" style="display:none; margin-top:14px; padding:12px; border-radius:8px; background:rgba(92,107,192,0.08); border:1px solid #5c6bc0; transition:all 0.25s ease;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span id="elap_arc_spinner_icon" style="font-size:14px;"><i class="fa-solid fa-gear fa-spin"></i></span>
          <b id="elap_arc_status_title" style="font-size:13px; color:var(--elap-accent);">Генерация сюжета...</b>
        </div>
        <span id="elap_arc_timer" style="font-size:12px; font-family:monospace; color:var(--elap-warning); font-weight:bold;">00:00</span>
      </div>
      <div id="elap_arc_status_detail" style="font-size:11px; opacity:0.85; margin-top:4px; line-height:1.4;">
        Инициализация запроса...
      </div>
      <div id="elap_arc_log_wrap" style="margin-top:8px; display:none;">
        <div style="font-size:10px; opacity:0.7; margin-bottom:2px;">Стриминг / Лог ответа:</div>
        <textarea id="elap_arc_stream_preview" class="elap-debug-box" style="min-height:90px; max-height:160px; font-size:11px; font-family:monospace;" readonly></textarea>
      </div>
    </div>

    <!-- КНОПКИ ДЕЙСТВИЙ -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; flex-wrap:wrap; gap:8px;">
      <button id="elap_btn_toggle_arc_log" type="button" class="elap-btn elap-btn-secondary elap-btn-compact" style="font-size:11px; display:none;"><i class="fa-solid fa-eye"></i> Лог генерации</button>
      <div style="display:flex; gap:8px; margin-left:auto;">
        <button id="elap_btn_stop_arc_gen" type="button" class="elap-btn elap-btn-danger elap-btn-compact" style="display:none; font-weight:bold;"><i class="fa-solid fa-stop"></i> Прервать</button>
        <button id="elap_btn_run_arc_gen" type="button" class="elap-btn elap-btn-accent elap-btn-compact" style="font-weight:bold;"><i class="fa-solid fa-bolt"></i> Сгенерировать</button>
        <button id="elap_btn_cancel_arc" type="button" class="elap-btn elap-btn-secondary elap-btn-compact">Отмена</button>
      </div>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  const genreInput = overlay.querySelector("#elap_arc_genre");
  const countInput = overlay.querySelector("#elap_arc_count");
  const blindInput = overlay.querySelector("#elap_arc_blind");
  const includeChatInput = overlay.querySelector("#elap_arc_include_chat");

  const statusBox = overlay.querySelector("#elap_arc_status_box");
  const spinnerIcon = overlay.querySelector("#elap_arc_spinner_icon");
  const statusTitle = overlay.querySelector("#elap_arc_status_title");
  const statusDetail = overlay.querySelector("#elap_arc_status_detail");
  const timerEl = overlay.querySelector("#elap_arc_timer");
  const logWrap = overlay.querySelector("#elap_arc_log_wrap");
  const streamPreview = overlay.querySelector("#elap_arc_stream_preview");

  const btnRun = overlay.querySelector("#elap_btn_run_arc_gen");
  const btnStop = overlay.querySelector("#elap_btn_stop_arc_gen");
  const btnCancel = overlay.querySelector("#elap_btn_cancel_arc");
  const btnToggleLog = overlay.querySelector("#elap_btn_toggle_arc_log");

  let isGenerating = false;
  let abortController = null;
  let timerInterval = null;

  btnToggleLog?.addEventListener("click", () => {
    if (!logWrap) return;
    const isHidden = logWrap.style.display === "none";
    logWrap.style.display = isHidden ? "block" : "none";
    btnToggleLog.innerHTML = isHidden ? '<i class="fa-solid fa-eye-slash"></i> Скрыть лог' : '<i class="fa-solid fa-eye"></i> Лог генерации';
  });

  const stopGeneration = () => {
    if (!isGenerating) return;
    if (abortController) {
      try { abortController.abort(); } catch (e) {}
    }
    stopAgentRequest("Генерация сюжета остановлена пользователем");
  };

  btnStop?.addEventListener("click", stopGeneration);

  btnRun?.addEventListener("click", async () => {
    if (isGenerating) return;

    const genre = genreInput?.value || "dnd_fantasy";
    const count = parseInt(countInput?.value) || 3;
    const hideSpoilers = !!blindInput?.checked;
    const includeChat = !!includeChatInput?.checked;

    isGenerating = true;
    abortController = new AbortController();
    registerActiveAgentAbortController(abortController);

    if (genreInput) genreInput.disabled = true;
    if (countInput) countInput.disabled = true;
    if (blindInput) blindInput.disabled = true;
    if (includeChatInput) includeChatInput.disabled = true;
    if (btnCancel) btnCancel.disabled = true;

    btnRun.style.display = "none";
    btnStop.style.display = "inline-flex";
    btnToggleLog.style.display = "inline-flex";

    statusBox.style.display = "block";
    statusBox.style.borderColor = "#5c6bc0";
    statusBox.style.background = "rgba(92,107,192,0.08)";
    spinnerIcon.innerHTML = '<i class="fa-solid fa-gear fa-spin"></i>';
    statusTitle.textContent = "Агент анализирует лор и плетет сюжет...";
    statusTitle.style.color = "var(--elap-accent)";
    statusDetail.textContent = "Сбор блоков карточки и отправка запроса модели...";
    if (streamPreview) streamPreview.value = "";

    const startTime = Date.now();
    timerEl.textContent = "00:00";
    timerInterval = setInterval(() => {
      const diffSec = Math.floor((Date.now() - startTime) / 1000);
      const m = String(Math.floor(diffSec / 60)).padStart(2, "0");
      const s = String(diffSec % 60).padStart(2, "0");
      timerEl.textContent = `${m}:${s}`;
    }, 1000);

    setAgentUiBusy(true, "Генерация сюжетной арки...");

    try {
      const newEvents = await generateStoryArcWithAgent(
        charOrDraft,
        genre,
        count,
        hideSpoilers,
        includeChat,
        abortController.signal,
        (stepStatus, accText) => {
          if (statusDetail) statusDetail.textContent = stepStatus;
          if (accText && streamPreview) {
            streamPreview.value = accText;
            streamPreview.scrollTop = streamPreview.scrollHeight;
          }
        }
      );

      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      setAgentUiBusy(false, "done");

      spinnerIcon.innerHTML = '<i class="fa-solid fa-check" style="color:var(--elap-success);"></i>';
      statusBox.style.borderColor = "#50fa7b";
      statusBox.style.background = "rgba(80,250,123,0.12)";
      statusTitle.textContent = "Сюжетная арка успешно создана!";
      statusTitle.style.color = "#50fa7b";
      statusDetail.textContent = `Добавлено ${newEvents.length} событий. Закрытие окна...`;

      if (window.toastr) toastr.success("Сюжетная арка успешно создана!");

      setTimeout(() => {
        overlay.remove();
        if (onGeneratedCallback) onGeneratedCallback(newEvents);
      }, 650);

    } catch (err) {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      setAgentUiBusy(false, "hide");

      if (err.name === "AbortError" || abortController?.signal?.aborted) {
        spinnerIcon.innerHTML = '<i class="fa-solid fa-stop" style="color:var(--elap-warning);"></i>';
        statusBox.style.borderColor = "#ffb86c";
        statusBox.style.background = "rgba(255,184,108,0.1)";
        statusTitle.textContent = "Генерация прервана";
        statusTitle.style.color = "#ffb86c";
        statusDetail.textContent = "Процесс генерации был остановлен.";
      } else {
        spinnerIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--elap-danger);"></i>';
        statusBox.style.borderColor = "#ff5555";
        statusBox.style.background = "rgba(255,85,85,0.12)";
        statusTitle.textContent = "Ошибка генерации";
        statusTitle.style.color = "#ff5555";
        statusDetail.textContent = err.message || "Не удалось создать сюжетную арку.";
        if (window.toastr) toastr.error(`Ошибка генерации: ${err.message}`);
      }

      if (genreInput) genreInput.disabled = false;
      if (countInput) countInput.disabled = false;
      if (blindInput) blindInput.disabled = false;
      if (includeChatInput) includeChatInput.disabled = false;
      if (btnCancel) btnCancel.disabled = false;

      btnRun.style.display = "inline-flex";
      btnRun.innerHTML = '<i class="fa-solid fa-rotate"></i> Повторить попытку';
      btnStop.style.display = "none";
    } finally {
      unregisterActiveAgentAbortController();
      isGenerating = false;
    }
  });

  overlay.querySelector("#elap_btn_cancel_arc")?.addEventListener("click", () => {
    if (isGenerating) stopGeneration();
    overlay.remove();
  });

  overlay.querySelector('[data-act="modal-close-x"]')?.addEventListener("click", () => {
    if (isGenerating) stopGeneration();
  });
}

export async function openBindChatModal(charId, onBoundCallback = null) {
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return;

  let chats = await fetchAssistantChatsList();
  let showAll = false;

  function isChatForCharacter(c, targetChar) {
    if (!targetChar || !c) return false;
    const targetName = String(targetChar.name || "").trim().toLowerCase();
    const fileName = String(c.fileName || "").toLowerCase();
    const targetBound = String(targetChar.chatId || "").replace(/\.jsonl$/i, "").toLowerCase();

    // 0. Если чат явно определен как ветка или привязан к персонажу
    if (c.forCharacterId && String(c.forCharacterId) === String(targetChar.id)) {
      return true;
    }
    if (Array.isArray(targetChar.branches) && targetChar.branches.some((b) => b.toLowerCase() === fileName)) {
      return true;
    }

    // 1. Привязанный файл чата
    if (targetBound && (targetBound === fileName || targetBound === fileName.replace(/\.jsonl$/i, ""))) {
      return true;
    }

    // 2. Прямое вхождение имени персонажа
    if (targetName && fileName.includes(targetName)) {
      return true;
    }

    // 3. Нормализованное сравнение (без знаков препинания)
    const cleanName = targetName.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const cleanFile = fileName.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (cleanName && cleanFile.includes(cleanName)) {
      return true;
    }

    // 4. Пословное совпадение ключевых слов (>= 3 символов)
    const nameParts = cleanName.split(/\s+/).filter((w) => w.length >= 3);
    if (nameParts.length > 0 && nameParts.every((part) => cleanFile.includes(part))) {
      return true;
    }

    return false;
  }

  function getFilteredChats() {
    if (showAll) return chats;
    return chats.filter((c) => isChatForCharacter(c, char));
  }

  const overlay = createElapOverlay("elap_bind_chat_overlay");
  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-clock-rotate-left" style="color:var(--elap-accent); margin-right:8px;"></i> История чатов — «${esc(char.name)}»`,
    `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
      <div>
        <div style="font-size:12px; opacity:0.85;">
          Файлы чатов персонажа <b>«${esc(char.name)}»</b>:
        </div>
        <label style="display:inline-flex; align-items:center; gap:6px; font-size:11.5px; cursor:pointer; user-select:none; margin-top:4px; color:var(--elap-accent);">
          <input id="elap_show_all_elap_chats" type="checkbox" style="cursor:pointer;">
          <span>Показать все чаты ELAP (всех персонажей)</span>
        </label>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <span id="elap_bind_chats_count" style="font-size:11.5px; opacity:0.75; font-family:monospace;"></span>
        <button id="elap_btn_delete_all_chats" class="elap-btn elap-btn-danger elap-btn-compact" title="Удалить чаты безвозвратно">
          <i class="fa-solid fa-trash-can"></i> Удалить все
        </button>
      </div>
    </div>
    <div id="elap_bind_chats_list" style="display:flex; flex-direction:column; gap:8px; max-height:440px; overflow-y:auto; padding:2px;"></div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  const listEl = overlay.querySelector("#elap_bind_chats_list");
  const countEl = overlay.querySelector("#elap_bind_chats_count");
  const delAllBtn = overlay.querySelector("#elap_btn_delete_all_chats");
  const showAllCheckbox = overlay.querySelector("#elap_show_all_elap_chats");

  function renderChatsList() {
    const filtered = getFilteredChats();

    if (countEl) {
      countEl.textContent = showAll
        ? `Всего в ELAP: ${chats.length}`
        : `Чатов «${esc(char.name)}»: ${filtered.length} (из ${chats.length})`;
    }

    if (delAllBtn) {
      delAllBtn.disabled = !filtered.length;
      delAllBtn.style.opacity = filtered.length ? "1" : "0.5";
      delAllBtn.style.cursor = filtered.length ? "pointer" : "not-allowed";
      delAllBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> ${showAll ? `Удалить ВСЕ (${filtered.length})` : `Удалить эти (${filtered.length})`}`;
    }

    if (!filtered.length) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:32px; opacity:0.75; font-size:13px;">
          <i class="fa-solid fa-comments" style="font-size:32px; margin-bottom:10px; display:block; color:var(--elap-text-dim);"></i>
          ${showAll
            ? "История чатов ELAP пуста."
            : `У персонажа «${esc(char.name)}» пока нет сохраненных файлов чата.<div style="font-size:11px; opacity:0.7; margin-top:6px;">Включите галочку выше, чтобы увидеть чаты других персонажей.</div>`}
        </div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((c) => {
        const isCurrent = String(char.chatId || "").toLowerCase() === c.fileName.toLowerCase();
        return `
      <div class="elap-bind-row" style="display:flex; justify-content:space-between; align-items:center; border:1px solid ${isCurrent ? 'var(--elap-primary)' : 'var(--elap-border)'}; border-radius:8px; padding:8px 12px; background:${isCurrent ? 'rgba(99, 102, 241, 0.1)' : 'var(--elap-bg-surface)'}; transition:all 0.15s ease;">
        <div style="flex:1; min-width:0; margin-right:12px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <b style="font-size:13px; color:#fff; word-break:break-all;">${esc(c.fileName)}</b>
            ${isCurrent ? `<span class="elap-tag-badge" style="background:var(--elap-primary); color:#fff; font-size:10px;"><i class="fa-solid fa-link"></i> Привязан</span>` : ""}
            ${c.isBranch ? `<span class="elap-tag-badge" style="background:#7c3aed; color:#fff; font-size:10px;"><i class="fa-solid fa-code-branch"></i> Ветка</span>` : ""}
            ${c.parentChat ? `<span style="font-size:10.5px; opacity:0.7; color:#a5b4fc;"><i class="fa-solid fa-arrow-turn-up fa-rotate-90"></i> от ${esc(c.parentChat)}</span>` : ""}
          </div>
          <div style="font-size:11.5px; opacity:0.7; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${c.mesCount !== undefined ? `<span style="color:var(--elap-warning); font-family:monospace; margin-right:6px;">${c.mesCount} сообщ.</span>` : ""}${esc(c.preview.slice(0, 100)) || "(без сообщений)"}
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
          <button data-act="select-bind" data-file="${esc(c.fileName)}" class="elap-btn ${isCurrent ? 'elap-btn-success' : 'elap-btn-secondary'} elap-btn-compact" title="${isCurrent ? 'Уже привязан' : 'Привязать к персонажу'}">
            <i class="fa-solid ${isCurrent ? 'fa-check' : 'fa-link'}"></i> ${isCurrent ? 'Выбран' : 'Выбрать'}
          </button>
          <button data-act="delete-chat-file" data-file="${esc(c.fileName)}" class="elap-btn elap-btn-danger elap-btn-compact" title="Удалить этот файл чата">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>`;
      })
      .join("");
  }

  renderChatsList();

  showAllCheckbox?.addEventListener("change", (e) => {
    showAll = !!e.target.checked;
    renderChatsList();
  });

  listEl.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    // Выбрать чат
    const selectBtn = target.closest('[data-act="select-bind"]');
    if (selectBtn) {
      const fileName = selectBtn.getAttribute("data-file");
      if (fileName) {
        char.chatId = fileName;
        if (currentEditorDraft && String(currentEditorDraft.id) === String(char.id)) {
          currentEditorDraft.chatId = fileName;
        }
        save();
        overlay.remove();
        if (window.toastr) toastr.success(`Чат "${fileName}" привязан`);
        if (onBoundCallback) onBoundCallback();
      }
      return;
    }

    // Удалить конкретный чат
    const delBtn = target.closest('[data-act="delete-chat-file"]');
    if (delBtn) {
      const fileName = delBtn.getAttribute("data-file");
      if (!fileName) return;

      if (!confirm(`Удалить файл чата "${fileName}"?\nЭто действие нельзя будет отменить.`)) {
        return;
      }

      delBtn.disabled = true;
      delBtn.innerHTML = `<i class="fa-solid fa-gear fa-spin"></i>`;

      const ok = await deleteAssistantChatFile(fileName);
      if (ok) {
        if (String(char.chatId || "").toLowerCase() === fileName.toLowerCase()) {
          char.chatId = null;
          if (currentEditorDraft && String(currentEditorDraft.id) === String(char.id)) {
            currentEditorDraft.chatId = null;
          }
          save();
        }
        chats = chats.filter((c) => c.fileName.toLowerCase() !== fileName.toLowerCase());
        renderChatsList();
        if (window.toastr) toastr.success(`Чат "${fileName}" удален`);
        if (onBoundCallback) onBoundCallback();
      } else {
        delBtn.disabled = false;
        delBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i>`;
        if (window.toastr) toastr.error(`Не удалось удалить чат "${fileName}"`);
      }
      return;
    }
  });

  delAllBtn?.addEventListener("click", async () => {
    const filtered = getFilteredChats();
    if (!filtered.length) return;

    const count = filtered.length;
    const confirmMsg = showAll
      ? `ВЫ УВЕРЕНЫ, что хотите удалить ВСЕ чаты всех персонажей ELAP (${count} шт.)?\nВсе файлы переписки будут безвозвратно удалены.`
      : `Удалить все сохраненные файлы чатов персонажа «${char.name}» (${count} шт.)?\nЭто действие нельзя будет отменить.`;

    if (!confirm(confirmMsg)) {
      return;
    }

    delAllBtn.disabled = true;
    delAllBtn.innerHTML = `<i class="fa-solid fa-gear fa-spin"></i> Удаление...`;

    let deletedCount = 0;
    for (const c of [...filtered]) {
      try {
        const ok = await deleteAssistantChatFile(c.fileName);
        if (ok) deletedCount++;
      } catch (err) {}
    }

    const boundDeleted = filtered.some(
      (c) => String(char.chatId || "").toLowerCase() === c.fileName.toLowerCase()
    );
    if (boundDeleted) {
      char.chatId = null;
      if (currentEditorDraft && String(currentEditorDraft.id) === String(char.id)) {
        currentEditorDraft.chatId = null;
      }
      save();
    }

    chats = await fetchAssistantChatsList();
    renderChatsList();

    if (window.toastr) toastr.success(`Удалено чатов: ${deletedCount}`);
    if (onBoundCallback) onBoundCallback();
  });
}

export function openSummaryModal(charId) {
  ensureCharactersState();
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return;

  if (!Array.isArray(char.days)) char.days = deepClone(DEFAULT_DAYS);
  const charPrefix = sanitizeKey(char.name).toLowerCase();

  const overlay = createElapOverlay("elap_summary_overlay");
  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-book-open" style="color:var(--elap-accent); margin-right:8px;"></i> Саммари Ассистент — ${esc(char.name)}`,
    `
    <div class="elap-notice-box">
      Все дни собираются в макрос: <code>{{days}}</code> или <code>{{${esc(charPrefix)}_days}}</code>.
    </div>
    <div id="elap_days_list" class="elap-row" style="display:flex; flex-direction:column; gap:8px; margin-top:10px;"></div>
    <div class="elap-row" style="margin-top:14px;">
      <button id="elap_add_day_btn" class="elap-btn elap-btn-success elap-btn-compact" style="width:100%; padding:8px;"><i class="fa-solid fa-plus"></i> Создать новый день</button>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  function renderDays() {
    const list = overlay.querySelector("#elap_days_list");
    if (!list) return;

    list.innerHTML = !char.days.length
      ? `<small style="opacity:0.7;">Список дней пуст.</small>`
      : char.days
          .map((d) => {
            const hasContent = !!d.content.trim();
            const preview = hasContent ? esc(d.content.slice(0, 100)) + (d.content.length > 100 ? "..." : "") : "<i>(Пусто)</i>";
            const personalTag = `${charPrefix}_${sanitizeKey(d.key).toLowerCase()}`;

            return `
        <div class="elap-day-item" data-id="${esc(d.id)}" style="display:flex; justify-content:space-between; align-items:center; border:1px solid #444; border-radius:8px; padding:8px 12px; background: rgba(255,255,200,0.03); cursor:pointer;">
          <div style="flex:1; margin-right:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <b style="font-size:13px; color:#fff;">${esc(d.name)}</b>
              <code class="elap-tag-badge">{{${esc(personalTag)}}}</code>
              ${hasContent ? `<span style="font-size:11px; color:#9aed7b;">● Заполнено</span>` : `<span style="font-size:11px; color:#888;">○ Пусто</span>`}
            </div>
            <div style="font-size:11px; opacity:0.7; margin-top:4px;">${preview}</div>
          </div>
          <div style="display:flex; gap:6px;">
            <button data-act="edit-day" data-id="${esc(d.id)}" class="elap-btn elap-btn-secondary elap-btn-compact" title="Редактировать"><i class="fa-solid fa-pen-to-square"></i></button>
            <button data-act="del-day" data-id="${esc(d.id)}" class="elap-btn elap-btn-danger elap-btn-compact" title="Удалить"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>`;
          })
          .join("");
  }

  renderDays();

  overlay.querySelector("#elap_add_day_btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextIdx = char.days.length + 1;
    char.days.push({
      id: genId(),
      name: `Day ${nextIdx}`,
      key: `day${nextIdx}`,
      content: "",
    });
    ensureUniqueKeys(char.days, "key", "day");
    save();
    registerAllElapMacros();
    renderDays();
  });

  overlay.querySelector("#elap_days_list")?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const delBtn = t.closest('[data-act="del-day"]');
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      if (confirm("Удалить этот день?")) {
        char.days = char.days.filter((d) => d.id !== id);
        save();
        registerAllElapMacros();
        renderDays();
      }
      return;
    }

    const row = t.closest(".elap-day-item");
    if (row) {
      const id = row.getAttribute("data-id");
      if (id) openDayEditorModal(char.id, id, () => renderDays());
    }
  });
}

export function openDayEditorModal(charId, dayId, onSaveCallback) {
  ensureCharactersState();
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return;

  const day = (char.days || []).find((d) => String(d.id) === String(dayId));
  if (!day) return;

  const charPrefix = sanitizeKey(char.name).toLowerCase();
  const previewTag = `${charPrefix}_${sanitizeKey(day.key).toLowerCase()}`;

  const overlay = createElapOverlay("elap_day_editor_overlay");
  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-pen-to-square" style="color:var(--elap-accent); margin-right:8px;"></i> Редактирование: ${esc(day.name)} ({{${esc(previewTag)}}})`,
    `
    <div class="elap-row" style="display:flex; gap:8px; margin-bottom:12px;">
      <div style="flex:1;">
        <label><small><b>Название дня:</b></small></label>
        <input id="elap_edit_day_name" type="text" value="${esc(day.name)}" class="text_pole" style="width:100%; margin-top:4px;">
      </div>
      <div style="width:160px;">
        <label><small><b>Ключ дня:</b></small></label>
        <input id="elap_edit_day_key" type="text" value="${esc(day.key)}" class="text_pole" style="width:100%; margin-top:4px; font-family:monospace; color:#9aed7b;">
      </div>
    </div>
    <div class="elap-row">
      <label><small><b>Текст Саммари:</b></small></label>
      <textarea id="elap_edit_day_content" style="min-height:220px; font-family:monospace; margin-top:4px;">${esc(day.content || "")}</textarea>
    </div>
    <div class="elap-modal-actions" style="margin-top:16px; display:flex; justify-content:flex-end; gap:8px;">
      <button id="elap_save_day_btn" class="elap-btn elap-btn-success elap-btn-compact"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      <button id="elap_cancel_day_btn" class="elap-btn elap-btn-secondary elap-btn-compact">Отмена</button>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  overlay.querySelector("#elap_save_day_btn")?.addEventListener("click", () => {
    const name = String(overlay.querySelector("#elap_edit_day_name")?.value || "").trim();
    const keyRaw = String(overlay.querySelector("#elap_edit_day_key")?.value || "").trim();
    const content = String(overlay.querySelector("#elap_edit_day_content")?.value || "");

    day.name = name || "Day";
    day.key = sanitizeKey(keyRaw || name || "day");
    day.content = content;

    ensureUniqueKeys(char.days, "key", "day");
    save();
    registerAllElapMacros();

    overlay.remove();
    if (onSaveCallback) onSaveCallback();
    if (window.toastr) toastr.success(`Саммари "${day.name}" сохранено`);
  });

  overlay.querySelector("#elap_cancel_day_btn")?.addEventListener("click", () => overlay.remove());
}