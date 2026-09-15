// --- START OF FILE macros.js ---

import * as Macros from "/scripts/macros.js";
import { getContext } from "/scripts/extensions.js";
import {
  S,
  ensureCharactersState,
  getActiveElapCharacter,
  buildElapPromptFromCharacter,
  buildDaysPromptFromCharacter,
  getBlockContent,
  getDayContent,
  sanitizeKey,
} from "./state.js";
import { formatTimelineHeader } from "./timeline.js";
import { buildActiveEventsPrompt } from "./events.js";
import { buildActiveCardsPrompt } from "./cards.js";
import { runAgentOnCurrentChat } from "./agent.js";

const registeredMacroKeys = new Set();

function rawRegisterMacro(macroName, resolverFn) {
  if (!macroName) return false;
  const name = String(macroName).trim();
  if (!name) return false;

  if (Macros?.registeredMacros) Macros.registeredMacros[name] = resolverFn;
  if (Macros?.MacrosParser?.macros) Macros.MacrosParser.macros[name] = resolverFn;
  if (window?.MacrosParser?.macros) window.MacrosParser.macros[name] = resolverFn;

  if (registeredMacroKeys.has(name)) return true;

  let ok = false;
  try {
    if (typeof Macros.registerMacro === "function") {
      Macros.registerMacro(name, resolverFn);
      ok = true;
    } else if (typeof Macros?.MacrosParser?.registerMacro === "function") {
      Macros.MacrosParser.registerMacro(name, resolverFn);
      ok = true;
    } else if (typeof window?.MacrosParser?.registerMacro === "function") {
      window.MacrosParser.registerMacro(name, resolverFn);
      ok = true;
    }
  } catch (err) {}

  registeredMacroKeys.add(name);
  return ok;
}

function registerMacroVariants(keys, resolverFn) {
  const uniqueKeys = new Set();
  keys.forEach((k) => {
    if (k) {
      const clean = String(k).trim();
      if (clean) uniqueKeys.add(clean);
    }
  });

  uniqueKeys.forEach((k) => {
    rawRegisterMacro(k, resolverFn);
  });
}

export function registerAllElapMacros() {
  ensureCharactersState();
  const s = S();

  // 1. Универсальные макросы
  registerMacroVariants(["ELAP", "elap", "Elap"], () => {
    const active = getActiveElapCharacter();
    if (active) return buildElapPromptFromCharacter(active, 0);
    return s.prompt || "";
  });

  registerMacroVariants(["days", "DAYS", "Days", "elap_days", "ELAP_DAYS"], () => {
    const active = getActiveElapCharacter();
    if (active) return buildDaysPromptFromCharacter(active);
    return "";
  });

  registerMacroVariants(["events", "EVENTS", "Events", "elap_events"], () => {
    const active = getActiveElapCharacter();
    return active ? buildActiveEventsPrompt(active, 0) : "";
  });

  registerMacroVariants(
    [
      "cards",
      "CARDS",
      "Cards",
      "elap_cards",
      "ELAP_CARDS",
      "constraints",
      "CONSTRAINTS",
      "Constraints",
      "elap_constraints",
      "directives",
      "DIRECTIVES",
      "elap_directives",
    ],
    () => {
      return buildActiveCardsPrompt();
    }
  );

  registerMacroVariants(["timeline", "TIMELINE", "Timeline", "elap_timeline"], () => {
    return formatTimelineHeader();
  });

  registerMacroVariants(["day", "DAY", "Day"], () => {
    const active = getActiveElapCharacter();
    return active?.timeline?.day !== undefined ? String(active.timeline.day) : "1";
  });

  registerMacroVariants(["period", "PERIOD", "Period"], () => {
    const active = getActiveElapCharacter();
    return active?.timeline?.period || "Утро";
  });

  registerMacroVariants(["date", "DATE", "Date"], () => {
    const active = getActiveElapCharacter();
    return active?.timeline?.date || "";
  });

  registerMacroVariants(["time", "TIME", "Time"], () => {
    const active = getActiveElapCharacter();
    return active?.timeline?.time || "";
  });

  registerMacroVariants(["weather", "WEATHER", "Weather"], () => {
    const active = getActiveElapCharacter();
    return active?.timeline?.weather || "";
  });

  const activeChar = getActiveElapCharacter();

  // 2. Макросы активного персонажа (с префиксами имени)
  if (activeChar) {
    const activeId = activeChar.id;
    const activePrefix = sanitizeKey(activeChar.name).toLowerCase();

    registerMacroVariants([`${activePrefix}_timeline`, `${activePrefix}_TIMELINE`], () => {
      return formatTimelineHeader(activeId);
    });

    registerMacroVariants([`${activePrefix}_events`, `${activePrefix}_EVENTS`], () => {
      return buildActiveEventsPrompt(activeId, 0);
    });

    registerMacroVariants([`${activePrefix}_day`, `${activePrefix}_DAY`], () => {
      const cur = getActiveElapCharacter();
      return cur?.timeline?.day !== undefined ? String(cur.timeline.day) : "1";
    });

    registerMacroVariants([`${activePrefix}_days`, `${activePrefix}_DAYS`], () => {
      const cur = getActiveElapCharacter();
      return cur ? buildDaysPromptFromCharacter(cur) : "";
    });

    registerMacroVariants([`${activePrefix}_elap`, `${activePrefix}_ELAP`], () => {
      const cur = getActiveElapCharacter();
      return cur ? buildElapPromptFromCharacter(cur, 0) : "";
    });

    (activeChar.blocks || []).forEach((b) => {
      const bKey = sanitizeKey(b.key).toLowerCase();
      registerMacroVariants([
        `${activePrefix}_${bKey}`,
        `${activePrefix}_${bKey.toUpperCase()}`,
        `elap_${bKey}`,
        `ELAP_${bKey.toUpperCase()}`,
        `${bKey}`,
        `${bKey.toUpperCase()}`,
      ], () => {
        return getBlockContent(b.key, activeId);
      });
    });

    (activeChar.days || []).forEach((d) => {
      const dKey = sanitizeKey(d.key).toLowerCase();
      registerMacroVariants([`${activePrefix}_${dKey}`, `${activePrefix}_${dKey.toUpperCase()}`], () => {
        return getDayContent(d.key, activeId);
      });
    });
  }
}

export function registerElapSlashCommands() {
  const handler = async () => {
    if (window.toastr) toastr.info("Запуск агента ELAP через команду...");
    await runAgentOnCurrentChat(true);
    return "";
  };

  try {
    const SlashParser = window.SlashCommandParser || getContext?.()?.SlashCommandParser;
    const SlashClass = window.SlashCommand || getContext?.()?.SlashCommand;

    if (SlashParser && SlashClass) {
      if (typeof SlashClass.fromProps === "function" && typeof SlashParser.addCommandObject === "function") {
        SlashParser.addCommandObject(
          SlashClass.fromProps({
            name: "elap_startagent",
            callback: handler,
            returns: "Запуск агента ELAP",
            helpString: "Запустить аналитического агента ELAP вручную.",
          })
        );
        SlashParser.addCommandObject(
          SlashClass.fromProps({
            name: "elap_start",
            callback: handler,
            returns: "Запуск агента ELAP",
            helpString: "Синоним команды /elap_startagent",
          })
        );
      }
    }
  } catch (e) {}
}