// --- START OF FILE chat.js ---

import {
  openCharacterChat,
  doNewChat,
  renameChat,
  getPastCharacterChats,
  selectCharacterById,
  getCharacters,
  getCurrentChatId,
  chat_metadata,
  characters as st_characters,
  this_chid,
  getRequestHeaders,
  chat as st_chat,
  addOneMessage,
  clearChat,
  saveChatConditional,
  substituteParams,
  name1,
  getThumbnailUrl,
} from "/script.js";
import { getContext } from "/scripts/extensions.js";
import { getMessageTimeStamp } from "/scripts/RossAscends-mods.js";
import { S, save, setActiveElapCharacter, getActiveElapCharacter, esc } from "./state.js";
import { injectTimelineToText, advanceTimelineDay, formatTimelineHeader } from "./timeline.js";

export let isSwitchingChat = false;

export function findAssistantIndex() {
  const target = S().assistantName.trim().toLowerCase();
  if (!Array.isArray(st_characters)) return -1;
  return st_characters.findIndex((c) => c && String(c.name).trim().toLowerCase() === target);
}

export async function ensureAssistantSelected() {
  let assistantIdx = findAssistantIndex();

  if (assistantIdx === -1) {
    await getCharacters();
    assistantIdx = findAssistantIndex();
  }

  if (assistantIdx === -1) {
    if (window.toastr) toastr.warning("Сначала нажми «Создать ELAP Assistant» в меню плагина");
    return false;
  }

  if (String(this_chid) !== String(assistantIdx)) {
    try {
      await selectCharacterById(assistantIdx, { switchMenu: false });
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      return false;
    }
  }
  return true;
}

export function getElapCharacterAvatarUrl(char) {
  if (!char) return "";
  const av = String(char.avatar || "").trim();

  // 1. Прямой data: URI, http/https или относительный путь
  if (av.startsWith("data:") || av.startsWith("http://") || av.startsWith("https://") || av.startsWith("/")) {
    return av;
  }

  // 2. Если FontAwesome класс (fa-...)
  if (av.startsWith("fa-")) {
    // FontAwesome — это css класс иконки, для тега img не подходит
  } else if (av) {
    // 3. Имя файла аватарки персонажа Таверны (например, "Seraphina.png")
    try {
      if (typeof getThumbnailUrl === "function") {
        return getThumbnailUrl("avatar", av);
      }
    } catch (e) {}
    return `/thumbnail?type=avatar&file=${encodeURIComponent(av)}`;
  }

  // 4. Поиск по совпадению имени среди карточек SillyTavern
  const stChars = Array.isArray(st_characters) ? st_characters : [];
  const charName = String(char.name || "").trim().toLowerCase();
  if (charName) {
    const matched = stChars.find(
      (sc) => sc && String(sc.name || "").trim().toLowerCase() === charName
    );
    if (matched && matched.avatar && matched.avatar !== "none") {
      try {
        if (typeof getThumbnailUrl === "function") {
          return getThumbnailUrl("avatar", matched.avatar);
        }
      } catch (e) {}
      return `/thumbnail?type=avatar&file=${encodeURIComponent(matched.avatar)}`;
    }
  }

  return "";
}

export function patchChatAvatarsAndNames(charOrId = null) {
  const s = S();
  let char = null;
  if (typeof charOrId === "object" && charOrId) {
    char = charOrId;
  } else if (typeof charOrId === "string" && charOrId) {
    char = s.characters.find((c) => String(c.id) === String(charOrId));
  } else {
    char = getActiveElapCharacter();
  }
  if (!char) return;

  const assistantIdx = findAssistantIndex();
  // Применяем только если активный персонаж в Таверне — ELAP Assistant
  if (assistantIdx !== -1 && String(this_chid) !== String(assistantIdx)) {
    return;
  }

  const avUrl = getElapCharacterAvatarUrl(char);
  const chatHistory = getContext?.()?.chat || st_chat;
  if (!Array.isArray(chatHistory) || !chatHistory.length) return;

  const asstName = (s.assistantName || "ELAP Assistant").trim().toLowerCase();
  let anyChanged = false;

  chatHistory.forEach((mes, idx) => {
    if (!mes || mes.is_user || mes.is_system) return;
    const curName = String(mes.name || "").trim().toLowerCase();

    if (avUrl && mes.force_avatar !== avUrl) {
      mes.force_avatar = avUrl;
      mes.original_avatar = char.avatar || "";
      anyChanged = true;
    }

    if (!mes.name || curName === asstName || curName === "elap assistant") {
      mes.name = char.name;
      anyChanged = true;
    }

    // Обновляем DOM
    const mesWrap = document.querySelector(`.mes[mesid="${idx}"]`);
    if (mesWrap) {
      mesWrap.setAttribute("ch_name", char.name);
      if (avUrl) {
        mesWrap.setAttribute("force_avatar", "true");
        const img = mesWrap.querySelector(".avatar img");
        if (img && img.getAttribute("src") !== avUrl) {
          img.src = avUrl;
        }
      }
      const nameEl = mesWrap.querySelector(".ch_name .name_text");
      if (nameEl && (nameEl.textContent.trim().toLowerCase() === asstName || nameEl.textContent.trim().toLowerCase() === "elap assistant" || !nameEl.textContent.trim())) {
        nameEl.textContent = char.name;
      }
    }
  });

  if (anyChanged) {
    try {
      saveChatConditional();
    } catch (e) {}
  }
}

export async function fetchAssistantChatsList() {
  const ok = await ensureAssistantSelected();
  if (!ok) return [];

  const assistantIdx = findAssistantIndex();
  if (assistantIdx === -1) return [];

  const assistantChar = st_characters[assistantIdx];

  try {
    const chats = await getPastCharacterChats(assistantIdx);
    if (Array.isArray(chats)) {
      const s = S();
      const result = [];

      for (const item of chats) {
        const fileName = String(item.file_name || "").replace(/\.jsonl$/i, "");
        const isBranch = fileName.startsWith("Branch #") || fileName.startsWith("Bookmark") || fileName.startsWith("Checkpoint");
        const chatObj = {
          fileName,
          rawFile: item.file_name,
          lastMes: item.last_mes,
          mesCount: item.message_count,
          preview: item.preview_message || "",
          isBranch,
          forCharacterId: null,
          parentChat: null,
        };

        for (const ch of s.characters || []) {
          if (String(ch.chatId || "").toLowerCase() === fileName.toLowerCase()) {
            chatObj.forCharacterId = ch.id;
            break;
          }
          if (Array.isArray(ch.branches) && ch.branches.some((b) => b.toLowerCase() === fileName.toLowerCase())) {
            chatObj.isBranch = true;
            chatObj.forCharacterId = ch.id;
            break;
          }
        }

        result.push(chatObj);
      }

      // Для нераспознанных веток Branch #... опрашиваем заголовок чата через API
      const unknownBranches = result.filter(
        (c) => c.isBranch && !c.forCharacterId && assistantChar?.avatar
      );

      if (unknownBranches.length > 0) {
        let changed = false;
        await Promise.all(
          unknownBranches.map(async (ub) => {
            try {
              const res = await fetch("/api/chats/get", {
                method: "POST",
                headers: getRequestHeaders(),
                body: JSON.stringify({ avatar_url: assistantChar.avatar, file_name: ub.fileName }),
              });
              if (res.ok) {
                const chatLines = await res.json();
                const header = Array.isArray(chatLines) ? chatLines[0] : null;
                const parent = header?.chat_metadata?.main_chat;
                if (parent) {
                  ub.parentChat = String(parent).replace(/\.jsonl$/i, "");
                  const parentLower = ub.parentChat.toLowerCase();
                  const matchedChar = s.characters.find(
                    (ch) =>
                      String(ch.chatId || "").replace(/\.jsonl$/i, "").toLowerCase() === parentLower ||
                      (Array.isArray(ch.branches) && ch.branches.some((b) => b.toLowerCase() === parentLower)) ||
                      (String(ch.name || "").trim().length > 0 && parentLower.includes(String(ch.name).trim().toLowerCase()))
                  );
                  if (matchedChar) {
                    ub.forCharacterId = matchedChar.id;
                    if (!Array.isArray(matchedChar.branches)) matchedChar.branches = [];
                    if (!matchedChar.branches.includes(ub.fileName)) {
                      matchedChar.branches.push(ub.fileName);
                      changed = true;
                    }
                  }
                }
              }
            } catch (err) {}
          })
        );
        if (changed) save();
      }

      return result;
    }
  } catch (e) {}
  return [];
}

export async function syncCurrentChatWithCharacter(newChatId = null) {
  if (isSwitchingChat) return null;

  const rawChatId = String(newChatId || getCurrentChatId() || "").replace(/\.jsonl$/i, "").trim();
  if (!rawChatId) return null;

  const assistantIdx = findAssistantIndex();
  if (assistantIdx === -1 || String(this_chid) !== String(assistantIdx)) {
    return null;
  }

  const s = S();
  const activeChar = getActiveElapCharacter();
  const mainChat = String(chat_metadata?.main_chat || "").replace(/\.jsonl$/i, "").trim();

function updateEditorBoundChatDisplay(chatId, isBranch) {
  const wrapEl = document.querySelector("#elap_bound_chat_wrapper");
  if (wrapEl) {
    wrapEl.innerHTML = `
      <i class="${isBranch ? 'fa-solid fa-code-branch' : 'fa-solid fa-comments'}" ${isBranch ? 'style="color:#a78bfa;"' : ''}></i>
      <span>Файл чата: <b id="elap_bound_chat_name" style="color:var(--elap-success);">${chatId ? esc(chatId) : "(Чат еще не создан)"}</b></span>
      ${isBranch ? `<span class="elap-tag-badge" style="background:#7c3aed; color:#fff; font-size:10px; padding:2px 6px;"><i class="fa-solid fa-code-branch"></i> Ветка</span>` : ""}
    `;
  } else {
    const boundEl = document.querySelector("#elap_bound_chat_name");
    if (boundEl) boundEl.textContent = chatId || "(Чат еще не создан)";
  }
}

  // 1. Если у текущего чата есть main_chat (это ветка / бранч)
  if (mainChat) {
    const mainChatLower = mainChat.toLowerCase();
    const foundChar = s.characters.find(
      (c) =>
        String(c.chatId || "").replace(/\.jsonl$/i, "").toLowerCase() === mainChatLower ||
        (Array.isArray(c.branches) && c.branches.some((b) => b.toLowerCase() === mainChatLower)) ||
        (String(c.name || "").trim().length > 0 && mainChatLower.includes(String(c.name).trim().toLowerCase()))
    ) || activeChar;

    if (foundChar) {
      if (!Array.isArray(foundChar.branches)) foundChar.branches = [];
      if (!foundChar.branches.includes(rawChatId)) {
        foundChar.branches.push(rawChatId);
      }
      foundChar.chatId = rawChatId;
      s.activeCharacterId = foundChar.id;
      save();
      updateEditorBoundChatDisplay(rawChatId, true);
      console.log(`[ELAP] 🌿 Ветка "${rawChatId}" привязана к персонажу "${foundChar.name}"`);
      return foundChar;
    }
  }

  // 2. Если имя чата начинается с "Branch #" или "Bookmark"
  if (rawChatId.startsWith("Branch #") || rawChatId.startsWith("Bookmark") || rawChatId.startsWith("Checkpoint")) {
    if (activeChar) {
      if (!Array.isArray(activeChar.branches)) activeChar.branches = [];
      if (!activeChar.branches.includes(rawChatId)) {
        activeChar.branches.push(rawChatId);
      }
      activeChar.chatId = rawChatId;
      save();
      updateEditorBoundChatDisplay(rawChatId, true);
      console.log(`[ELAP] 🌿 Ветка "${rawChatId}" привязана к активному персонажу "${activeChar.name}"`);
      return activeChar;
    }
  }

  // 3. Если чат назван по имени персонажа
  const matchChar = s.characters.find(
    (c) => String(c.name || "").trim().length > 0 && rawChatId.toLowerCase().includes(String(c.name).trim().toLowerCase())
  );
  if (matchChar) {
    matchChar.chatId = rawChatId;
    s.activeCharacterId = matchChar.id;
    save();
    updateEditorBoundChatDisplay(rawChatId, false);
    return matchChar;
  }

  return null;
}

export async function deleteAssistantChatFile(chatFileName) {
  if (!chatFileName) return false;
  const assistantIdx = findAssistantIndex();
  const assistantChar = assistantIdx !== -1 ? st_characters[assistantIdx] : null;
  const avatarUrl = assistantChar?.avatar || "";

  const fileTarget = chatFileName.endsWith(".jsonl") ? chatFileName : `${chatFileName}.jsonl`;
  try {
    const res = await fetch("/api/chats/delete", {
      method: "POST",
      headers: getRequestHeaders(),
      body: JSON.stringify({ chatfile: fileTarget, avatar_url: avatarUrl }),
    });

    const current = String(getCurrentChatId() || "").replace(/\.jsonl$/i, "");
    const targetRaw = String(chatFileName).replace(/\.jsonl$/i, "");
    if (current.toLowerCase() === targetRaw.toLowerCase()) {
      await doNewChat({ deleteCurrentChat: false });
    }

    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function switchOrStartCharacterChat(charId, forceNew = false) {
  isSwitchingChat = true;

  try {
    const s = S();
    const char = s.characters.find((c) => String(c.id) === String(charId));
    if (!char) return;

    setActiveElapCharacter(charId);

    const ok = await ensureAssistantSelected();
    if (!ok) return;

    const currentChatName = String(getCurrentChatId() || "").replace(/\.jsonl$/i, "");

    if (char.chatId && !forceNew) {
      const targetChat = String(char.chatId).replace(/\.jsonl$/i, "");

      if (currentChatName.toLowerCase() === targetChat.toLowerCase()) {
        if (window.toastr) toastr.info(`Чат «${char.name}» уже открыт`);
        return;
      }

      await openCharacterChat(targetChat);
      const openedChat = String(getCurrentChatId() || "").replace(/\.jsonl$/i, "");
      if (openedChat) {
        char.chatId = openedChat;
        save();
      }
      patchChatAvatarsAndNames(char);
      if (window.toastr) toastr.success(`Открыт чат: ${char.name}`);
      return;
    }

    await doNewChat({ deleteCurrentChat: false });
    await new Promise((r) => setTimeout(r, 200));

    const createdChat = String(getCurrentChatId() || "").replace(/\.jsonl$/i, "");
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}@${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}m${String(now.getSeconds()).padStart(2, '0')}s`;
    const desiredName = `[ELAP] ${char.name} - ${timeStr}`;

    let finalChatId = createdChat;
    if (createdChat) {
      try {
        await renameChat(createdChat, desiredName);
        finalChatId = desiredName;
      } catch (renameErr) {}
    }

    char.chatId = finalChatId;
    save();

    await clearChat();
    st_chat.splice(0, st_chat.length);

    let firstMsgText = String(char.firstMessage || "").trim();
    if (firstMsgText.length > 0) {
      if (s.timelineEnabled !== false) {
        firstMsgText = injectTimelineToText(firstMsgText, char);
      }

      const role = char.firstMessageRole || "char";
      const isUser = role === "user";
      const isSystem = role === "system";
      
      let senderName = char.name;
      if (isUser) senderName = name1 || "User";
      if (isSystem) senderName = "System";

      const firstMsgObj = {
        name: senderName,
        is_user: isUser,
        is_system: isSystem,
        send_date: typeof getMessageTimeStamp === "function" ? getMessageTimeStamp() : Date.now(),
        mes: typeof substituteParams === "function" ? substituteParams(firstMsgText, undefined, char.name) : firstMsgText,
        extra: { elap_timeline: formatTimelineHeader(char) },
      };

      if (!isUser && !isSystem) {
        const avUrl = getElapCharacterAvatarUrl(char);
        if (avUrl) {
          firstMsgObj.force_avatar = avUrl;
          firstMsgObj.original_avatar = char.avatar || "";
        }
      }

      st_chat.push(firstMsgObj);
      addOneMessage(firstMsgObj);
    }

    await saveChatConditional();
    if (window.toastr) toastr.success(`Создан чат: ${char.name}`);
  } catch (err) {
    if (window.toastr) toastr.error("Ошибка при работе с чатом Таверны");
  } finally {
    setTimeout(() => { isSwitchingChat = false; }, 1000);
  }
}

export function refreshAssistantStatus() {
  const statusEl = document.querySelector("#elap_assistant_status");
  if (!statusEl) return;

  const foundIdx = findAssistantIndex();
  if (foundIdx === -1) {
    statusEl.innerHTML = `<span style="color:#ffb86c;">Не найден <b>${esc(S().assistantName)}</b>. Нажми «Создать ELAP Assistant».</span>`;
    return;
  }

  const char = st_characters[foundIdx];
  statusEl.innerHTML = `<span style="color:#9aed7b;">Найден: <b>${esc(char?.name || S().assistantName)}</b> (chid: ${foundIdx})</span>`;
}

export async function createAssistantCharacter() {
  const settings = S();
  const existsIdx = findAssistantIndex();
  if (existsIdx !== -1) {
    if (window.toastr) toastr.info("ELAP Assistant уже существует");
    await ensureAssistantSelected();
    return;
  }

  const card = {
    name: settings.assistantName,
    description: "Service character managed by ELAP plugin. Please do not edit manually.",
    personality: "Neutral system helper.",
    scenario: "Used to run ELAP workflows.",
    first_mes: "ELAP Assistant ready. Use ELAP plugin menu to select a character and start playing.",
    mes_example: "",
    creator_notes: "Managed by ELAP extension",
    system_prompt: "",
    post_history_instructions: "",
    tags: ["ELAP", "system"],
    creator: "ELAP",
    character_version: "1.0",
    extensions: { elap_managed: true, elap_lock: true },
  };

  try {
    const res = await fetch("/api/characters/create", {
      method: "POST",
      headers: getRequestHeaders(),
      body: JSON.stringify({ character: card }),
    });

    if (res.ok) {
      if (window.toastr) toastr.success("ELAP Assistant создан");
      await getCharacters();
      refreshAssistantStatus();
      await ensureAssistantSelected();
      return;
    }
  } catch (e) {}

  if (window.toastr) toastr.error("Не удалось создать ассистента автоматически.");
}

export async function executeEndDayChatTransition(charId, action, keepLast, lastMsgObj) {
  const s = S();
  const char = s.characters.find((c) => String(c.id) === String(charId));
  if (!char) return;

  isSwitchingChat = true;

  try {
    advanceTimelineDay(char);
    const nextDayNum = char.timeline?.day || 1;
    const tlHeader = formatTimelineHeader(char);

    if (action === 'new') {
      await doNewChat({ deleteCurrentChat: false });
      await new Promise((r) => setTimeout(r, 300));

      const createdChat = String(getCurrentChatId() || "").replace(/\.jsonl$/i, "");
      const now = new Date();
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}@${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}m`;
      
      const desiredName = `[ELAP] ${char.name} - Day ${nextDayNum} - ${timeStr}`;

      let finalChatId = createdChat;
      if (createdChat) {
        try {
          await renameChat(createdChat, desiredName);
          finalChatId = desiredName;
        } catch (e) {}
      }
      char.chatId = finalChatId;
      save();

      await clearChat();
      st_chat.splice(0, st_chat.length);
    } else {
      await clearChat();
      st_chat.splice(0, st_chat.length);
    }

    if (keepLast && lastMsgObj) {
      let mesText = lastMsgObj.mes || "";
      if (s.timelineEnabled !== false) {
        mesText = injectTimelineToText(mesText, char);
      }

      const newMsg = {
        name: lastMsgObj.name || (lastMsgObj.is_user ? (name1 || "User") : char.name),
        is_user: !!lastMsgObj.is_user,
        is_system: !!lastMsgObj.is_system,
        send_date: typeof getMessageTimeStamp === "function" ? getMessageTimeStamp() : Date.now(),
        mes: mesText,
        extra: { elap_timeline: tlHeader },
      };

      if (!newMsg.is_user && !newMsg.is_system) {
        const avUrl = getElapCharacterAvatarUrl(char);
        if (avUrl) {
          newMsg.force_avatar = avUrl;
          newMsg.original_avatar = char.avatar || "";
        }
      }
      
      st_chat.push(newMsg);
      addOneMessage(newMsg);
    } else {
      const sysContent = tlHeader
        ? `${tlHeader}\n\n*Начат новый день. События прошлого дня заархивированы и сохранены в память Ассистента.*`
        : `*Начат День ${nextDayNum}. События прошлого дня заархивированы.*`;

      const sysMsg = {
        name: "System",
        is_user: false,
        is_system: true,
        send_date: typeof getMessageTimeStamp === "function" ? getMessageTimeStamp() : Date.now(),
        mes: sysContent,
        extra: { elap_timeline: tlHeader },
      };
      
      st_chat.push(sysMsg);
      addOneMessage(sysMsg);
    }

    await saveChatConditional();
    if (window.toastr) toastr.success(`Переход в День ${nextDayNum} завершен!`);
  } catch (err) {
    console.error("[ELAP End Day] Ошибка при смене чата:", err);
  } finally {
    setTimeout(() => { isSwitchingChat = false; }, 1000);
  }
}