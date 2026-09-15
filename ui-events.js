// --- START OF FILE ui-events.js ---

import { getContext } from "/scripts/extensions.js";
import { S, save, esc, deepClone, genId, sanitizeKey } from "./state.js";
import { registerAllElapMacros } from "./macros.js";
import { createElapOverlay, elapModalShell, bindModalCloseX } from "./ui.js";
import { openArcGeneratorModal } from "./ui-editor.js";
import {
  timeStringToMinutes,
  minutesToTimeString,
  getPeriodFromTime,
  syncAllChatMessagesExtra,
  tagMessageWithTimelineExtra,
} from "./timeline.js";

/**
 * Просмотр только одного конкретного сообщения чата по ID
 */
export function openSingleMessageInspectModal(mesId, mesObj) {
  const overlay = createElapOverlay("elap_single_msg_overlay");
  const tl = mesObj.extra?.elap_timeline || { day: 1, time: "08:00", weather: "" };

  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-comment" style="color:var(--elap-primary); margin-right:8px;"></i> Сообщение #${mesId + 1} — ${esc(mesObj.name || (mesObj.is_user ? "User" : "Char"))}`,
    `
    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:6px; margin-bottom:12px; font-size:12px;">
      <div>
        <span><i class="fa-solid fa-calendar-day"></i> <b>День ${tl.day}</b></span>
        <span style="margin-left:12px;"><i class="fa-solid fa-clock"></i> <b>${esc(tl.time)} (${esc(tl.period || getPeriodFromTime(tl.time))})</b></span>
        ${tl.weather ? `<span style="margin-left:12px;"><i class="fa-solid fa-cloud-sun"></i> <b>${esc(tl.weather)}</b></span>` : ""}
      </div>
      <span style="opacity:0.6; font-size:11px;">Дата отправки: ${esc(mesObj.send_date || "")}</span>
    </div>

    <div style="max-height:500px; overflow-y:auto; font-size:13px; line-height:1.55; white-space:pre-wrap; background:#121316; padding:12px; border-radius:8px; border:1px solid #3e424f; font-family:Consolas, monospace;">${esc(mesObj.mes)}</div>

    <div style="display:flex; justify-content:flex-end; margin-top:14px;">
      <button id="elap_btn_close_single_msg" class="elap-btn elap-btn-secondary elap-btn-compact">Закрыть</button>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);
  overlay.querySelector("#elap_btn_close_single_msg")?.addEventListener("click", () => overlay.remove());
}

/**
 * Графическая Сюжетная Песочница (Timeline Sandbox)
 */
export async function openEventsSandboxModal(charDraft, onUpdateCallback = null) {
  if (!charDraft) return;
  if (!Array.isArray(charDraft.events)) charDraft.events = [];

  // Синхронизируем extra во всех сообщениях перед открытием
  await syncAllChatMessagesExtra();

  const overlay = createElapOverlay("elap_sandbox_overlay");
  let selectedDay = parseInt(charDraft.timeline?.day) || 1;
  let globalRevealSpoilers = false;

  const renderSandbox = () => {
    const ctx = getContext?.();
    const chat = ctx?.chat || [];

    // Вытягиваем ВСЕ сообщения, у которых есть extra.elap_timeline
    const chatMilestones = [];
    chat.forEach((m, idx) => {
      if (m.extra?.elap_timeline) {
        chatMilestones.push({
          mesId: idx,
          name: m.name || (m.is_user ? "User" : charDraft.name),
          isUser: !!m.is_user,
          mes: m.mes || "",
          preview: String(m.mes || "").replace(/\n/g, " ").slice(0, 50) + "...",
          timeline: m.extra.elap_timeline,
        });
      }
    });

    // Определяем максимальный день
    const eventDays = charDraft.events.map((e) => parseInt(e.day) || 1);
    const msgDays = chatMilestones.map((m) => parseInt(m.timeline.day) || 1);
    const maxDay = Math.max(parseInt(charDraft.timeline?.day) || 1, ...eventDays, ...msgDays, 3);

    // Данные для выбранного дня
    const currentStoryTime = charDraft.timeline?.time || "08:00";
    const currentStoryDay = parseInt(charDraft.timeline?.day) || 1;
    const isCurrentDayActive = selectedDay === currentStoryDay;

    // Сообщения и ивенты этого дня
    const dayMessages = chatMilestones.filter((m) => (parseInt(m.timeline.day) || 1) === selectedDay);
    const dayEvents = charDraft.events.filter((e) => (parseInt(e.day) || 1) === selectedDay);

    // Расчет пинов для 24-часовой шкалы (00:00 - 23:59 -> 0 - 1440 минут)
    let pinsHtml = "";

    // 1. Пины сообщений
    dayMessages.forEach((m) => {
      const mins = timeStringToMinutes(m.timeline.time);
      const pct = Math.max(1, Math.min(99, (mins / 1440) * 100));
      pinsHtml += `
        <div class="elap-ruler-pin pin-msg" style="left: ${pct}%;" 
             data-act="inspect-msg" data-mid="${m.mesId}" 
             data-tooltip="[${esc(m.timeline.time)}] ${esc(m.name)}: #${m.mesId + 1}">
          <i class="fa-solid fa-comment"></i>
        </div>
      `;
    });

    // 2. Пины ивентов
    dayEvents.forEach((e) => {
      const idx = charDraft.events.indexOf(e);
      const mins = timeStringToMinutes(e.time || "12:00");
      const pct = Math.max(1, Math.min(99, (mins / 1440) * 100));
      pinsHtml += `
        <div class="elap-ruler-pin pin-event" style="left: ${pct}%;" 
             data-act="edit-event" data-i="${idx}" 
             data-tooltip="[${esc(e.time || '12:00')}] Ивент: «${esc(e.title)}» (${e.status})">
          <i class="fa-solid fa-crosshairs"></i>
        </div>
      `;
    });

    // 3. Пин «Сейчас» (если это текущий день игры)
    if (isCurrentDayActive) {
      const nowMins = timeStringToMinutes(currentStoryTime);
      const nowPct = Math.max(1, Math.min(99, (nowMins / 1440) * 100));
      pinsHtml += `
        <div class="elap-ruler-pin pin-current" style="left: ${nowPct}%;" 
             data-tooltip="СЕЙЧАС В СЮЖЕТЕ: ${esc(currentStoryTime)}">
          <i class="fa-solid fa-clock"></i>
        </div>
      `;
    }

    // Собираем единый хронологический поток (Time Stream)
    const streamItems = [];

    dayMessages.forEach((m) => {
      streamItems.push({
        type: "msg",
        timeMins: timeStringToMinutes(m.timeline.time),
        timeStr: m.timeline.time,
        data: m,
      });
    });

    dayEvents.forEach((e) => {
      streamItems.push({
        type: "event",
        timeMins: timeStringToMinutes(e.time || "12:00"),
        timeStr: e.time || "12:00",
        data: e,
      });
    });

    // Сортировка строго по минутам!
    streamItems.sort((a, b) => a.timeMins - b.timeMins);

    let streamHtml = "";
    if (!streamItems.length) {
      streamHtml = `
        <div style="padding:28px; text-align:center; opacity:0.6; font-size:12px;">
          На День ${selectedDay} еще нет сообщений или событий.<br/>
          Кликните в любое место временной шкалы выше, чтобы запланировать ивент на нужное время!
        </div>`;
    } else {
      streamItems.forEach((item) => {
        if (item.type === "msg") {
          const m = item.data;
          streamHtml += `
            <div class="elap-stream-row stream-msg" data-act="inspect-msg" data-mid="${m.mesId}">
              <div class="elap-stream-time-badge">${esc(item.timeStr)}</div>
              <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; font-size:11px; opacity:0.8; margin-bottom:2px;">
                  <b>${esc(m.name)} (Сообщение #${m.mesId + 1})</b>
                  <span>${esc(m.timeline.period || getPeriodFromTime(item.timeStr))}</span>
                </div>
                <div style="font-size:12px; color:#e2e8f0; font-family:Consolas, monospace;">${esc(m.preview)}</div>
              </div>
            </div>`;
        } else {
          const e = item.data;
          const idx = charDraft.events.indexOf(e);
          const isHidden = !globalRevealSpoilers && !!e.hidden && !e._peeked;
          const statusColor = e.status === "active" ? "var(--elap-warning)" : e.status === "completed" ? "var(--elap-success)" : "var(--elap-accent)";
          const statusIcon = e.status === "active" ? '<i class="fa-solid fa-bolt"></i>' : e.status === "completed" ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-hourglass-half"></i>';
          const statusText = e.status === "active" ? "Активно" : e.status === "completed" ? "Завершено" : "Ожидает";

          streamHtml += `
            <div class="elap-stream-row stream-event">
              <div class="elap-stream-time-badge" style="color:var(--elap-accent);">${esc(item.timeStr)}</div>
              <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <b style="font-size:13px; color:#fff;"><i class="fa-solid fa-crosshairs" style="color:var(--elap-accent); margin-right:4px;"></i>${esc(e.title)}</b>
                    <span class="elap-tag-badge" style="border:1px solid ${statusColor}; color:${statusColor};">${statusIcon} ${statusText}</span>
                    ${e.triggerType === "chained" ? `<span style="font-size:11px; opacity:0.75; color:var(--elap-accent);">[<i class="fa-solid fa-link"></i> Цепочка]</span>` : ""}
                  </div>
                  <div style="display:flex; gap:4px;">
                    <button data-act="toggle-hide" data-i="${idx}" class="elap-btn elap-btn-secondary elap-btn-compact" title="${e.hidden ? "Показать" : "Скрыть"}"><i class="fa-solid ${e.hidden ? "fa-eye-slash" : "fa-eye"}"></i></button>
                    <button data-act="edit-event" data-i="${idx}" class="elap-btn elap-btn-secondary elap-btn-compact" title="Редактировать"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button data-act="del-event" data-i="${idx}" class="elap-btn elap-btn-danger elap-btn-compact" title="Удалить"><i class="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
                ${
                  isHidden
                    ? `
                  <div class="elap-event-spoiler-shield">
                    <div style="font-size:11px; font-weight:bold; color:var(--elap-accent);"><i class="fa-solid fa-eye-slash"></i> СЮЖЕТНАЯ ТАЙНА (Скрыто)</div>
                    <button data-act="peek-spoiler" data-i="${idx}" class="elap-btn elap-btn-secondary elap-btn-compact" style="margin-top:4px; font-size:10px;"><i class="fa-solid fa-eye"></i> Подсмотреть текст</button>
                  </div>`
                    : `
                  <div style="font-size:12px; font-family:monospace; line-height:1.35; background:rgba(0,0,0,0.35); padding:8px; border-radius:6px;">
                    ${esc(e.content || "(Пустая директива)")}
                  </div>`
                }
              </div>
            </div>`;
        }
      });
    }

    // Дни (табы)
    let dayTabsHtml = "";
    for (let d = 1; d <= maxDay; d++) {
      const isSel = d === selectedDay;
      const isCur = d === currentStoryDay;
      dayTabsHtml += `
        <button data-act="select-day" data-day="${d}" class="elap-btn elap-btn-secondary elap-btn-compact ${isSel ? 'elap-btn-active' : ''}">
          День ${d} ${isCur ? '●' : ''}
        </button>
      `;
    }

    overlay.innerHTML = `
<div class="elap-modal elap-modal-expanded" style="display:flex; flex-direction:column; max-height:92vh;">
  <!-- ШАПКА -->
  <div class="elap-modal-header" style="display:flex; justify-content:space-between; align-items:center;">
    <div>
      <b style="font-size:16px; color:var(--elap-accent);"><i class="fa-solid fa-gamepad"></i> Динамический Таймлайн & Песочница: ${esc(charDraft.name)}</b>
      <span style="font-size:11px; margin-left:10px; color:var(--elap-success);"><i class="fa-solid fa-clock"></i> Текущее время сюжета: День ${currentStoryDay}, ${currentStoryTime}</span>
    </div>
    <div style="display:flex; gap:6px;">
      <button id="sb_btn_gen_arc" class="elap-btn elap-btn-accent elap-btn-compact" style="font-weight:bold;"><i class="fa-solid fa-bolt"></i> AI-Арка</button>
      <button id="sb_btn_add_event_now" class="elap-btn elap-btn-success elap-btn-compact" style="font-weight:bold;"><i class="fa-solid fa-plus"></i> Создать ивент</button>
      <button id="sb_btn_close_x" class="elap-close-btn-x"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>

  <!-- ВЫБОР ДНЯ -->
  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
    <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
      <span style="font-size:12px; opacity:0.8;">Дни:</span>
      ${dayTabsHtml}
      <button id="sb_btn_add_day" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-plus"></i> День ${maxDay + 1}</button>
    </div>

    <div style="display:flex; gap:8px; align-items:center;">
      <button id="sb_btn_toggle_spoilers" class="elap-btn elap-btn-secondary elap-btn-compact" style="font-size:11px;">
        <i class="fa-solid ${globalRevealSpoilers ? "fa-eye-slash" : "fa-eye"}"></i> ${globalRevealSpoilers ? "Скрыть все спойлеры" : "Раскрыть все"}
      </button>
    </div>
  </div>

  <!-- ИНТЕРАКТИВНЫЙ ГРАФИК: 24-ЧАСОВАЯ ШКАЛА -->
  <div class="elap-ruler-container">
    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
      <span style="font-weight:bold; color:#ffb86c;">График времени: День ${selectedDay}</span>
      <small style="opacity:0.7;">Кликните в любую точку шкалы, чтобы добавить событие на это время</small>
    </div>

    <div class="elap-ruler-track" id="sb_ruler_track" title="Кликните для создания ивента">
      ${pinsHtml}
    </div>

    <div class="elap-ruler-ticks">
      <span>00:00</span>
      <span>03:00</span>
      <span>06:00</span>
      <span>09:00</span>
      <span>12:00</span>
      <span>15:00</span>
      <span>18:00</span>
      <span>21:00</span>
      <span>23:59</span>
    </div>
  </div>

  <!-- ХРОНОЛОГИЧЕСКИЙ ПОТОК -->
  <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column;">
    <div style="font-size:12px; font-weight:bold; margin-bottom:8px; color:#ba68c8;">
      Хронология Дня ${selectedDay} (Сообщения чата из extra и сюжетные ивенты):
    </div>
    <div class="elap-stream-list" id="sb_stream_viewport">
      ${streamHtml}
    </div>
  </div>
</div>
    `;

    // Клик по линейке времени (Ruler) -> Добавление ивента на точные минуты!
    const track = overlay.querySelector("#sb_ruler_track");
    track?.addEventListener("click", (e) => {
      // Игнорируем клик, если нажали прямо на пин
      if (e.target.closest(".elap-ruler-pin")) return;

      const rect = track.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const totalMinutes = Math.round(pct * 1440);
      const clickedTimeStr = minutesToTimeString(totalMinutes, "24h");

      openEventEditorModal(charDraft, null, () => {
        saveAndSync();
        renderSandbox();
      }, { day: selectedDay, time: clickedTimeStr });
    });

    // Переключение дней
    overlay.querySelectorAll('[data-act="select-day"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDay = parseInt(btn.getAttribute("data-day"), 10) || 1;
        renderSandbox();
      });
    });

    // Добавить день
    overlay.querySelector("#sb_btn_add_day")?.addEventListener("click", () => {
      selectedDay = maxDay + 1;
      renderSandbox();
    });

    // Глобальное раскрытие спойлеров
    overlay.querySelector("#sb_btn_toggle_spoilers")?.addEventListener("click", () => {
      globalRevealSpoilers = !globalRevealSpoilers;
      renderSandbox();
    });

    // Кнопка создания ивента
    overlay.querySelector("#sb_btn_add_event_now")?.addEventListener("click", () => {
      openEventEditorModal(charDraft, null, () => {
        saveAndSync();
        renderSandbox();
      }, { day: selectedDay, time: currentStoryTime });
    });

    // AI-генератор арки
    overlay.querySelector("#sb_btn_gen_arc")?.addEventListener("click", () => {
      openArcGeneratorModal(charDraft, (newEvents) => {
        charDraft.events = deepClone(newEvents);
        saveAndSync();
        renderSandbox();
      });
    });

    // Закрытие
    overlay.querySelector("#sb_btn_close_x")?.addEventListener("click", () => {
      saveAndSync();
      overlay.remove();
      if (onUpdateCallback) onUpdateCallback();
    });
  };

  const saveAndSync = () => {
    const s = S();
    const curIdx = s.characters.findIndex((c) => String(c.id) === String(charDraft.id));
    if (curIdx >= 0) {
      s.characters[curIdx].events = deepClone(charDraft.events);
      save();
      registerAllElapMacros();
    }
  };

  // Делегирование событий
  overlay.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    // Клик по сообщению -> просмотр одного сообщения
    const msgCard = t.closest('[data-act="inspect-msg"]');
    if (msgCard) {
      const mid = parseInt(msgCard.getAttribute("data-mid"), 10);
      const ctx = getContext?.();
      const mes = ctx?.chat?.[mid];
      if (mes) {
        openSingleMessageInspectModal(mid, mes);
      }
      return;
    }

    // Подсмотреть текст спойлера
    const peekBtn = t.closest('[data-act="peek-spoiler"]');
    if (peekBtn) {
      const idx = parseInt(peekBtn.getAttribute("data-i"), 10);
      if (charDraft.events[idx]) {
        charDraft.events[idx]._peeked = true;
        renderSandbox();
      }
      return;
    }

    // Переключить скрытность
    const hideBtn = t.closest('[data-act="toggle-hide"]');
    if (hideBtn) {
      const idx = parseInt(hideBtn.getAttribute("data-i"), 10);
      if (charDraft.events[idx]) {
        charDraft.events[idx].hidden = !charDraft.events[idx].hidden;
        charDraft.events[idx]._peeked = false;
        saveAndSync();
        renderSandbox();
      }
      return;
    }

    // Редактировать ивент
    const editBtn = t.closest('[data-act="edit-event"]');
    if (editBtn) {
      const idx = parseInt(editBtn.getAttribute("data-i"), 10);
      openEventEditorModal(charDraft, idx, () => {
        saveAndSync();
        renderSandbox();
      });
      return;
    }

    // Удалить ивент
    const delBtn = t.closest('[data-act="del-event"]');
    if (delBtn) {
      const idx = parseInt(delBtn.getAttribute("data-i"), 10);
      if (confirm("Удалить этот сюжетный ивент?")) {
        charDraft.events.splice(idx, 1);
        saveAndSync();
        renderSandbox();
      }
      return;
    }
  });

  document.body.appendChild(overlay);
  renderSandbox();
}

/**
 * Редактор отдельного события с точным указанием времени xx:xx
 */
export function openEventEditorModal(charDraft, eventIndex = null, onSaveCallback = null, preset = null) {
  const isEdit = eventIndex !== null && charDraft.events[eventIndex];
  const curEvent = isEdit ? deepClone(charDraft.events[eventIndex]) : {
    id: genId(),
    title: "",
    content: "",
    day: preset?.day || charDraft.timeline?.day || 1,
    time: preset?.time || "12:00",
    period: "День",
    triggerType: "time",
    parentEventId: null,
    swipeBypass: true,
    status: "pending",
    hidden: false,
  };

  const overlay = createElapOverlay("elap_event_editor_overlay");
  const otherEvents = charDraft.events.filter((e, idx) => idx !== eventIndex);

  let parentOptionsHtml = `<option value="">(Нет родительского события)</option>`;
  otherEvents.forEach((ev) => {
    parentOptionsHtml += `<option value="${esc(ev.id)}" ${curEvent.parentEventId === ev.id ? 'selected' : ''}>${esc(ev.title)} (День ${ev.day}, ${ev.time || '12:00'})</option>`;
  });

  overlay.innerHTML = elapModalShell(
    isEdit ? `<i class="fa-solid fa-pen-to-square" style="color:var(--elap-accent); margin-right:8px;"></i> Редактирование: ${esc(curEvent.title || "Ивент")}` : `<i class="fa-solid fa-crosshairs" style="color:var(--elap-accent); margin-right:8px;"></i> Создание сюжетного события`,
    `
    <div class="elap-row" style="margin-bottom:8px;">
      <label><small><b>Название события:</b></small></label>
      <input id="ee_title" type="text" value="${esc(curEvent.title)}" class="text_pole" placeholder="Например: Визит инспектора / Подброшенный конверт" style="width:100%; margin-top:3px;">
    </div>

    <div class="elap-row" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
      <div style="flex:1; min-width:130px;">
        <label><small><b>Тип триггера:</b></small></label>
        <select id="ee_trigger_type" class="text_pole" style="width:100%; margin-top:3px;">
          <option value="time" ${curEvent.triggerType === 'time' ? 'selected' : ''}>По точному времени</option>
          <option value="chained" ${curEvent.triggerType === 'chained' ? 'selected' : ''}>Цепочка (После другого)</option>
        </select>
      </div>

      <div id="ee_time_wrap" style="display:${curEvent.triggerType === 'chained' ? 'none' : 'flex'}; gap:8px; flex:2; min-width:200px;">
        <div style="width:80px;">
          <label><small><b>День #:</b></small></label>
          <input id="ee_day" type="number" min="1" max="9999" value="${esc(curEvent.day || 1)}" class="text_pole" style="width:100%; margin-top:3px;">
        </div>
        <div style="flex:1;">
          <label><small><b>Время (ЧЧ:ММ):</b></small></label>
          <input id="ee_time" type="text" value="${esc(curEvent.time || '12:00')}" class="text_pole" placeholder="19:00" style="width:100%; margin-top:3px; font-family:monospace; color:var(--elap-warning);">
        </div>
      </div>

      <div id="ee_chained_wrap" style="display:${curEvent.triggerType === 'chained' ? 'block' : 'none'}; flex:2; min-width:200px;">
        <label><small><b>Срабатывать строго после:</b></small></label>
        <select id="ee_parent_id" class="text_pole" style="width:100%; margin-top:3px;">${parentOptionsHtml}</select>
      </div>
    </div>

    <div class="elap-row" style="margin-bottom:10px;">
      <label><small><b>Директива события (Инструкция для модели, когда наступает это время):</b></small></label>
      <textarea id="ee_content" style="min-height:120px; font-family:monospace; margin-top:4px;" placeholder="Директива для модели: что происходит в мире или с персонажем...">${esc(curEvent.content || "")}</textarea>
    </div>

    <div class="elap-row" style="margin-bottom:8px; padding:8px 10px; background:rgba(255,255,200,0.03); border:1px solid #444; border-radius:6px;">
      <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
        <input id="ee_swipe_bypass" type="checkbox" ${curEvent.swipeBypass !== false ? 'checked' : ''}>
        <div>
          <b>Свайп-защита от рельсов</b>
          <div style="font-size:11px; opacity:0.75;">Если игрок свайпает ответ, этот ивент выгружается.</div>
        </div>
      </label>
    </div>

    <div class="elap-row" style="margin-bottom:14px; padding:8px 10px; background:rgba(255,255,200,0.03); border:1px solid #444; border-radius:6px;">
      <label class="checkbox_label" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
        <input id="ee_hidden" type="checkbox" ${curEvent.hidden ? 'checked' : ''}>
        <div>
          <b>Режим «Скрыто» (Без спойлеров для меня)</b>
          <div style="font-size:11px; opacity:0.75;">Текст события будет заблокирован заглушкой в интерфейсе.</div>
        </div>
      </label>
    </div>

    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button id="ee_save_btn" class="elap-btn elap-btn-success elap-btn-compact" style="font-weight:bold;"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
      <button id="ee_cancel_btn" class="elap-btn elap-btn-secondary elap-btn-compact">Отмена</button>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  const trigSelect = overlay.querySelector("#ee_trigger_type");
  const timeWrap = overlay.querySelector("#ee_time_wrap");
  const chainWrap = overlay.querySelector("#ee_chained_wrap");

  trigSelect?.addEventListener("change", (e) => {
    if (e.target.value === "chained") {
      timeWrap.style.display = "none";
      chainWrap.style.display = "block";
    } else {
      timeWrap.style.display = "flex";
      chainWrap.style.display = "none";
    }
  });

  overlay.querySelector("#ee_save_btn")?.addEventListener("click", () => {
    const title = String(overlay.querySelector("#ee_title")?.value || "").trim() || "Событие";
    const content = String(overlay.querySelector("#ee_content")?.value || "").trim();
    const triggerType = overlay.querySelector("#ee_trigger_type")?.value || "time";
    const day = Math.max(1, parseInt(overlay.querySelector("#ee_day")?.value) || 1);
    const time = String(overlay.querySelector("#ee_time")?.value || "12:00").trim();
    const parentEventId = overlay.querySelector("#ee_parent_id")?.value || null;
    const swipeBypass = !!overlay.querySelector("#ee_swipe_bypass")?.checked;
    const hidden = !!overlay.querySelector("#ee_hidden")?.checked;

    const eventObj = {
      id: curEvent.id || genId(),
      title,
      content,
      triggerType,
      day,
      time,
      period: getPeriodFromTime(time),
      parentEventId,
      swipeBypass,
      status: curEvent.status || "pending",
      hidden,
    };

    if (isEdit) {
      charDraft.events[eventIndex] = eventObj;
    } else {
      charDraft.events.push(eventObj);
    }

    overlay.remove();
    if (onSaveCallback) onSaveCallback();
  });

  overlay.querySelector("#ee_cancel_btn")?.addEventListener("click", () => overlay.remove());
}