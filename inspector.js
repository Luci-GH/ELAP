// --- START OF FILE inspector.js ---

import { eventSource, event_types, main_api } from "/script.js";
import { getActiveElapCharacter, buildAgentFullPromptPreview, esc, countTokens } from "./state.js";
import { createElapOverlay, elapModalShell, bindModalCloseX } from "./ui.js";
import { getActiveCardIds, getCardById, buildActiveCardsPrompt, openCardDebuggerModal } from "./cards.js";

let capturedMainPrompt = null;
let lastCapturedTime = null;

export function initPromptInspector() {
  if (!eventSource || !event_types) return;

  // 1. Перехват Chat Completion (OpenAI, Claude, OpenRouter и др.)
  if (event_types.CHAT_COMPLETION_PROMPT_READY) {
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
      if (data.dryRun) return;
      lastCapturedTime = new Date().toLocaleTimeString();
      capturedMainPrompt = {
        type: "chat",
        api: main_api || "chat_completion",
        time: lastCapturedTime,
        messages: Array.isArray(data.chat) ? JSON.parse(JSON.stringify(data.chat)) : [],
        raw: JSON.stringify(data.chat, null, 2),
      };
    });
  }

  // 2. Перехват Text Completion (Classic / Kobold / Ooba)
  if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) {
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
      if (data.dryRun || main_api === "openai") return;
      lastCapturedTime = new Date().toLocaleTimeString();
      capturedMainPrompt = {
        type: "raw",
        api: main_api || "text_completion",
        time: lastCapturedTime,
        raw: String(data.prompt || ""),
      };
    });
  }
}

export function openPromptInspectorModal() {
  const overlay = createElapOverlay("elap_inspector_overlay");
  const activeChar = getActiveElapCharacter();
  const agentPreview = buildAgentFullPromptPreview(activeChar);

  const activeIds = getActiveCardIds();
  const activeCardsPrompt = buildActiveCardsPrompt();

  overlay.innerHTML = elapModalShell(
    `<i class="fa-solid fa-magnifying-glass" style="color:var(--elap-primary); margin-right:8px;"></i> ELAP — Prompt Inspector (Основная модель, Агент & Карточки)`,
    `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--elap-border); padding-bottom:8px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="elap_tab_main_model" class="elap-btn elap-btn-secondary elap-btn-compact elap-btn-active"><i class="fa-solid fa-robot"></i> Основная модель</button>
        <button id="elap_tab_agent_model" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-user-secret"></i> Агент ELAP</button>
        <button id="elap_tab_cards_model" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-layer-group"></i> Карточки Мира (${activeIds.length})</button>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button id="elap_btn_copy_inspector" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-copy"></i> Копировать</button>
      </div>
    </div>

    <!-- ВКЛАДКА 1: ОСНОВНАЯ МОДЕЛЬ -->
    <div id="elap_insp_view_main">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px; opacity:0.85;">
        <span>Слепок последнего запроса: <b style="color:var(--elap-success);">${lastCapturedTime ? `${lastCapturedTime} (${capturedMainPrompt?.api || ''})` : "Запросов еще не было"}</b></span>
        <label class="checkbox_label" style="display:flex; align-items:center; gap:6px; margin:0; cursor:pointer;">
          <input id="elap_insp_raw_toggle" type="checkbox"> <span>Показать сырой JSON</span>
        </label>
      </div>

      <div id="elap_insp_main_formatted" style="max-height:540px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;"></div>
      <textarea id="elap_insp_main_raw" class="elap-debug-box" style="display:none; min-height:480px;" readonly>${esc(capturedMainPrompt?.raw || "Промпт пока не перехвачен. Отправьте сообщение в чат.")}</textarea>
    </div>

    <!-- ВКЛАДКА 2: АГЕНТ ELAP -->
    <div id="elap_insp_view_agent" style="display:none;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px;">
        <span>Текущий живой контекст: <b>${esc(activeChar?.name || "Персонаж не выбран")}</b></span>
        <span>Токены: <b style="color:var(--elap-success);">${agentPreview.totalTokens}</b> (Sys: ${agentPreview.systemTokens} | Context: ${agentPreview.userTokens})</span>
      </div>

      <div style="margin-bottom:6px;"><small><b>1. Системный промпт агента:</b></small></div>
      <textarea readonly style="font-family:monospace; min-height:120px; margin-bottom:10px;">${esc(agentPreview.systemPrompt)}</textarea>

      <div style="margin-bottom:6px;"><small><b>2. Пользовательский пейлоад (Карточка + Ивенты + Чат):</b></small></div>
      <textarea id="elap_insp_agent_payload" class="elap-debug-box" style="min-height:340px;" readonly>${esc(agentPreview.userPayload)}</textarea>
    </div>

    <!-- ВКЛАДКА 3: АКТИВНЫЕ КАРТОЧКИ И ДИРЕКТИВЫ -->
    <div id="elap_insp_view_cards" style="display:none;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px; flex-wrap:wrap; gap:8px;">
        <span>Активно карточек в текущем промпте: <b style="color:var(--elap-success);">${activeIds.length}</b></span>
        <button id="elap_insp_open_debugger" class="elap-btn elap-btn-secondary elap-btn-compact"><i class="fa-solid fa-flask"></i> Открыть Дебаггер карточек</button>
      </div>

      <div style="margin-bottom:6px;"><small><b>Инжектируемый блок ограничений и правил (Макрос {{cards}} / {{constraints}}):</b></small></div>
      <textarea id="elap_insp_cards_payload" class="elap-debug-box" style="min-height:220px;" readonly>${esc(activeCardsPrompt || "В данный момент ни одна карточка мира не активирована.")}</textarea>

      <div style="margin-top:12px;">
        <small><b>Список активных карточек:</b></small>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:6px;">
          ${activeIds.length ? activeIds.map((id) => {
            const c = getCardById(id);
            return `<div style="background:#181a20; border:1px solid #444; border-radius:6px; padding:6px 10px; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <b style="color:#9fa8da;">${esc(c?.name || id)}</b> <span style="opacity:0.6; font-size:10px;">[${esc(c?.type || 'CARD')}]</span>
                <div style="opacity:0.75; font-size:11px;">${esc(c?.summary || '')}</div>
              </div>
              <code style="font-size:10px; opacity:0.6;">${esc(id)}</code>
            </div>`;
          }).join("") : '<div style="opacity:0.6; font-style:italic; font-size:12px;">Активных карточек нет. Используйте Дебаггер для загрузки или дайте Агенту активировать их.</div>'}
        </div>
      </div>
    </div>
    `
  );

  document.body.appendChild(overlay);
  bindModalCloseX(overlay);

  // Рендер форматированных сообщений основной модели
  const renderFormattedMain = () => {
    const wrap = overlay.querySelector("#elap_insp_main_formatted");
    if (!wrap) return;

    if (!capturedMainPrompt) {
      wrap.innerHTML = `<div style="padding:20px; text-align:center; opacity:0.6;">Промпт еще не перехвачен. Отправьте сообщение в чат для захвата.</div>`;
      return;
    }

    if (capturedMainPrompt.type === "raw") {
      wrap.innerHTML = `<pre style="white-space:pre-wrap; font-family:monospace; font-size:12px; background:#121212; padding:10px; border-radius:6px;">${esc(capturedMainPrompt.raw)}</pre>`;
      return;
    }

    wrap.innerHTML = capturedMainPrompt.messages
      .map((m, idx) => {
        const role = String(m.role || "user").toLowerCase();
        const roleColor = role === "system" ? "#ffb86c" : role === "assistant" ? "#9aed7b" : "#5c6bc0";
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2);
        const tok = countTokens(content);

        return `
        <div style="border:1px solid #444; border-radius:6px; background:rgba(255,255,255,0.02); overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.35); padding:4px 10px; border-bottom:1px solid #333;">
            <b style="color:${roleColor}; font-size:11px; text-transform:uppercase;">#${idx + 1} [${esc(role)}]</b>
            <span style="font-size:10px; opacity:0.75; font-family:monospace;">~${tok} tok</span>
          </div>
          <div style="padding:8px 10px; font-family:monospace; font-size:12px; white-space:pre-wrap; max-height:220px; overflow-y:auto; word-break:break-word;">${esc(content)}</div>
        </div>`;
      })
      .join("");
  };

  renderFormattedMain();

  // Переключение вкладок
  const tabMain = overlay.querySelector("#elap_tab_main_model");
  const tabAgent = overlay.querySelector("#elap_tab_agent_model");
  const tabCards = overlay.querySelector("#elap_tab_cards_model");
  const viewMain = overlay.querySelector("#elap_insp_view_main");
  const viewAgent = overlay.querySelector("#elap_insp_view_agent");
  const viewCards = overlay.querySelector("#elap_insp_view_cards");

  const activateTab = (activeBtn, activeView) => {
    [tabMain, tabAgent, tabCards].forEach((t) => t?.classList.remove("elap-btn-active"));
    [viewMain, viewAgent, viewCards].forEach((v) => { if (v) v.style.display = "none"; });
    activeBtn?.classList.add("elap-btn-active");
    if (activeView) activeView.style.display = "block";
  };

  tabMain?.addEventListener("click", () => activateTab(tabMain, viewMain));
  tabAgent?.addEventListener("click", () => activateTab(tabAgent, viewAgent));
  tabCards?.addEventListener("click", () => activateTab(tabCards, viewCards));

  overlay.querySelector("#elap_insp_open_debugger")?.addEventListener("click", () => {
    openCardDebuggerModal();
  });

  // Переключение сырой JSON / Форматированный
  overlay.querySelector("#elap_insp_raw_toggle")?.addEventListener("change", (e) => {
    const rawBox = overlay.querySelector("#elap_insp_main_raw");
    const fmtBox = overlay.querySelector("#elap_insp_main_formatted");
    if (e.target.checked) {
      if (rawBox) rawBox.style.display = "block";
      if (fmtBox) fmtBox.style.display = "none";
    } else {
      if (rawBox) rawBox.style.display = "none";
      if (fmtBox) fmtBox.style.display = "flex";
    }
  });

  // Копирование активного промпта
  overlay.querySelector("#elap_btn_copy_inspector")?.addEventListener("click", () => {
    let textToCopy = "";

    if (viewMain && viewMain.style.display !== "none") {
      textToCopy = capturedMainPrompt?.raw || "";
    } else if (viewAgent && viewAgent.style.display !== "none") {
      textToCopy = `=== SYSTEM ===\n${agentPreview.systemPrompt}\n\n=== USER CONTEXT ===\n${agentPreview.userPayload}`;
    } else if (viewCards && viewCards.style.display !== "none") {
      textToCopy = activeCardsPrompt || "";
    }

    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        if (window.toastr) toastr.success("Промпт скопирован в буфер обмена!");
      });
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}