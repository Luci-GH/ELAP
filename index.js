// --- START OF FILE index.js ---

import { getContext } from "/scripts/extensions.js";
import { S, save, ensureCharactersState, getActiveElapCharacter, esc } from "./state.js";
import { registerAllElapMacros, registerElapSlashCommands } from "./macros.js";
import { runAgentOnCurrentChat } from "./agent.js";
import {
  isSwitchingChat,
  syncCurrentChatWithCharacter,
  getElapCharacterAvatarUrl,
  patchChatAvatarsAndNames,
  findAssistantIndex,
} from "./chat.js";
import { this_chid } from "/script.js";
import { formatTimelineHeader, tagMessageWithTimelineExtra } from "./timeline.js";
import { evaluateEventsForCharacter } from "./events.js";
import { initPromptInspector } from "./inspector.js";
import {
  ensureElapStyles,
  renderSettingsUI,
  renderCharactersList,
  bindGlobalUIHandlers,
  ensureEndDayButton,
} from "./ui.js";
import { runPreAgentForCards, stepActiveCardTurns } from "./cards.js";

function initElap() {
  console.group("[ELAP Init 🚀] Инициализация Easy Long AI Play");
  S();
  ensureCharactersState();
  ensureElapStyles();
  bindGlobalUIHandlers();
  ensureEndDayButton();
  initPromptInspector();
  renderSettingsUI();
  registerAllElapMacros();
  registerElapSlashCommands();

  if (!S().warned) {
    if (window.toastr) toastr.info("ELAP загружен. Модульная структура активна.", "ELAP");
    S().warned = true;
    save();
  }
  console.groupEnd();
}

jQuery(() => {
  initElap();

  const ctx = getContext?.();
  if (ctx?.eventSource) {
    ctx.eventSource.on("app_ready", () => {
      renderSettingsUI();
      ensureEndDayButton();
      patchChatAvatarsAndNames();
    });
    ctx.eventSource.on("settings_loaded", () => { renderSettingsUI(); ensureEndDayButton(); });
    ctx.eventSource.on("extension_settings_loaded", () => {
      renderSettingsUI();
      ensureEndDayButton();
      patchChatAvatarsAndNames();
    });
    ctx.eventSource.on("chat_id_changed", async (newChatId) => {
      ensureEndDayButton();
      await syncCurrentChatWithCharacter(newChatId);
      patchChatAvatarsAndNames();
      renderCharactersList();
      renderSettingsUI();
    });
    ctx.eventSource.on("more_messages_loaded", () => {
      patchChatAvatarsAndNames();
    });
    ctx.eventSource.on("character_page_loaded", () => { ensureEndDayButton(); });

    let lastProcessedMesKey = null;
    const handleOutgoingUserMessage = async (mesId) => {
      if (isSwitchingChat) return;
      const s = S();
      if (s.cardsEnabled === false || s.cardsPreAgentEnabled === false) return;

      const chatHistory = ctx?.chat;
      if (!Array.isArray(chatHistory) || !chatHistory.length) return;

      const targetMes = chatHistory[mesId] !== undefined ? chatHistory[mesId] : chatHistory[chatHistory.length - 1];
      if (!targetMes || !targetMes.is_user) return;

      const msgKey = `${targetMes.send_date || ""}_${targetMes.mes || ""}`;
      if (lastProcessedMesKey === msgKey) return;
      lastProcessedMesKey = msgKey;

      console.log("[ELAP] ⚡ Запуск Pre-Agent для карточек мира (0% регексов, чистый LLM)...");
      const activated = await runPreAgentForCards(targetMes.mes);
      if (activated && activated.length > 0) {
        console.log("[ELAP] 🗂️ Pre-Agent активировал карточки мира:", activated);
        if (window.toastr && s.showAgentToasts !== false) {
          toastr.info(`ELAP Pre-Agent: Активировано [${activated.join(", ")}]`);
        }
      }
    };

    ctx.eventSource.on("message_sent", handleOutgoingUserMessage);
    ctx.eventSource.on("user_message_rendered", handleOutgoingUserMessage);

    ctx.eventSource.on("message_received", (mesId) => {
      if (isSwitchingChat) return;
      const assistantIdx = findAssistantIndex();
      if (assistantIdx !== -1 && String(this_chid) !== String(assistantIdx)) return;

      const activeChar = getActiveElapCharacter();
      if (!activeChar) return;

      const chatHistory = ctx?.chat;
      if (!Array.isArray(chatHistory)) return;

      const targetMes = chatHistory[mesId] !== undefined ? chatHistory[mesId] : chatHistory[chatHistory.length - 1];
      if (!targetMes || targetMes.is_user || targetMes.is_system) return;

      const avUrl = getElapCharacterAvatarUrl(activeChar);
      if (avUrl) {
        targetMes.force_avatar = avUrl;
        targetMes.original_avatar = activeChar.avatar || "";
      }
      const asstName = (S().assistantName || "ELAP Assistant").trim().toLowerCase();
      const curName = String(targetMes.name || "").trim().toLowerCase();
      if (!targetMes.name || curName === asstName || curName === "elap assistant") {
        targetMes.name = activeChar.name;
      }
    });

    ctx.eventSource.on("character_message_rendered", async (mesId) => {
      ensureEndDayButton();
      if (isSwitchingChat) return;

      const s = S();
      const chatHistory = ctx?.chat;
      if (!Array.isArray(chatHistory) || !chatHistory.length) return;

      const targetMes = chatHistory[mesId] || chatHistory[chatHistory.length - 1];
      if (!targetMes) return;

      const activeChar = getActiveElapCharacter();
      if (!activeChar) return;

      // Привязываем и сохраняем метку времени в extra сообщения
      await tagMessageWithTimelineExtra(targetMes);

      // Если предыдущее сообщение пользователя еще не имело метки, проставляем и ему
      if (mesId > 0 && chatHistory[mesId - 1] && !chatHistory[mesId - 1].extra?.elap_timeline) {
        await tagMessageWithTimelineExtra(chatHistory[mesId - 1]);
      }

      if (targetMes.is_user || targetMes.is_system) return;

      // Подставляем аватарку и имя персонажа ELAP
      const assistantIdx = findAssistantIndex();
      if (assistantIdx !== -1 && String(this_chid) === String(assistantIdx)) {
        const avUrl = getElapCharacterAvatarUrl(activeChar);
        if (avUrl && targetMes.force_avatar !== avUrl) {
          targetMes.force_avatar = avUrl;
          targetMes.original_avatar = activeChar.avatar || "";
        }
        const asstName = (s.assistantName || "ELAP Assistant").trim().toLowerCase();
        const curName = String(targetMes.name || "").trim().toLowerCase();
        if (!targetMes.name || curName === asstName || curName === "elap assistant") {
          targetMes.name = activeChar.name;
        }

        const mesWrap = document.querySelector(`.mes[mesid="${mesId}"]`);
        if (mesWrap) {
          mesWrap.setAttribute("ch_name", activeChar.name);
          if (avUrl) {
            mesWrap.setAttribute("force_avatar", "true");
            const img = mesWrap.querySelector(".avatar img");
            if (img && img.getAttribute("src") !== avUrl) {
              img.src = avUrl;
            }
          }
          const nameEl = mesWrap.querySelector(".ch_name .name_text");
          if (nameEl && (nameEl.textContent.trim().toLowerCase() === asstName || nameEl.textContent.trim().toLowerCase() === "elap assistant" || !nameEl.textContent.trim())) {
            nameEl.textContent = activeChar.name;
          }
        }
      }

      // Авто-выгрузка карточек по истечении лимита ответов (TTL)
      const expiredCards = stepActiveCardTurns();
      if (expiredCards.length > 0 && s.showAgentToasts !== false && window.toastr) {
        toastr.info(`ELAP: Карточка [${expiredCards.join(", ")}] отыграна и выгружена`);
      }

      // Оценка свайпа для ивентов
      const currentSwipeId = targetMes.swipe_id || 0;
      if (s.eventsSwipeBypassEnabled && currentSwipeId > 0) {
        evaluateEventsForCharacter(activeChar, currentSwipeId);
      }

      // UI-Бейдж над сообщением
      if (s.timelineEnabled && s.timelineVisualMode === "badge") {
        const mesWrap = document.querySelector(`.mes[mesid="${mesId}"]`);
        if (mesWrap && !mesWrap.querySelector(".elap-mes-badge")) {
          const badge = document.createElement("div");
          badge.className = "elap-mes-badge";
          badge.innerHTML = `<span>⏰ ${esc(formatTimelineHeader(activeChar))}</span>`;
          const textEl = mesWrap.querySelector(".mes_text");
          if (textEl) mesWrap.insertBefore(badge, textEl);
        }
      }

      // Проверка частоты запуска агента
      if (s.autoRunAgentAfterResponse === false) return;

      const currentChatLen = chatHistory.length;
      const freq = Math.max(1, parseInt(s.agentRunFrequency) || 1);

      let lastLen = parseInt(s.lastRunChatLength) || 0;
      if (lastLen > currentChatLen || lastLen < 0) lastLen = 0;

      const diff = currentChatLen - lastLen;
      if (diff < freq) return;

      s.lastRunChatLength = currentChatLen;
      save();

      await runAgentOnCurrentChat(false);
    });
  }
});