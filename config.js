// --- START OF FILE config.js ---

export const MODULE_NAME = "elap";

export const DEFAULT_TIMELINE = {
  enabled: true,
  day: 1,
  unitName: "Day",
  useCustomUnit: false,
  date: "1 Сентября",
  time: "08:00",
  period: "Утро", // "Утро" | "День" | "Вечер" | "Ночь"
  weather: "Ясно, солнечно",
  format: "[{{unit}} {{day}}. {{date}}, {{time}} ({{period}}), {{weather}}]",
};

export const DEFAULT_AGENT_SKILLS = [
  {
    id: "state_tracking",
    name: "Universal State Tracking (Surgical Diff)",
    description: "Хирургическое обновление таблиц, ASCII-схем, списков и произвольных структур данных без искажения контекста.",
    instructions: `При изменении состояния в ролевой игре анализируй блоки как модули данных (ASCII-доски, правила, характеристики, списки, заметки).
- Всегда отдавай предпочтение инструменту replace_block_content, указывая точный фрагмент target_content и замену replacement_content.
- Никогда не переписывай весь блок целиком, если изменилась только одна деталь (например, ход фигуры на доске, одна цифра характеристики, добавление пункта в список).
- Применяй overwrite_block только тогда, когда блок был совершенно пуст или его структура переписана полностью.`,
    enabled: true,
  },
  {
    id: "rules_and_mechanics",
    name: "Rules & Interactive Mechanics Arbiter",
    description: "Контроль выполнения игровых правил (World Rules, настольные игры, боевка, квесты, ограничения).",
    instructions: `Если в блоках определены правила мира, механика игры (например, 'Шахматы', 'Боевая система', 'Законы магии') или ограничения:
- Следи за соблюдением этих правил в диалоге и фиксируй любые их изменения или последствия.
- При наступлении триггеров или нарушений ограничений актуализируй соответствующий блок правил или статуса.`,
    enabled: true,
  },
  {
    id: "world_and_timeline",
    name: "Chrono & World Synchronizer",
    description: "Синхронизация игрового времени, погоды, сюжетных событий и карточек мира (World Cards).",
    instructions: `Оценивай темп сцены и естественное течение времени (разговоры, перемещения, отдых, смена дня и ночи).
- Вызывай update_timeline для обновления даты, времени, поры суток и погоды.
- Если завершилось сюжетное событие, вызывай manage_events для отметки completed_event_ids.
- Если ситуация затрагивает правила из каталога карточек мира, активируй их через manage_cards.`,
    enabled: true,
  },
  {
    id: "micro_patching",
    name: "Micro-Patching & Minimal Anchor (Ювелирный якорь)",
    description: "Менять только 2-4 соседних слова вокруг изменения, не переписывая длинные предложения целиком.",
    instructions: `При точечной замене текста через replace_block_content соблюдай принцип минимального уникального контекста (Minimal Anchor Context):
- Не захватывай в target_content длинные предложения, реплики или целые абзацы, если меняется только одно слово, число или пункт.
- Выделяй минимальный якорь (от 2 до 4 соседних слов или знаков препинания), достаточный для однозначной идентификации места замены.
  Пример: если в сумочку добавляется пряник:
  НЕ НАДО захватывать всё предложение: target_content: "У неё есть сумочка. Внутри сумочки - красная помада, смартфон."
  ПРАВИЛЬНО: target_content: "помада, смартфон." -> replacement_content: "помада, смартфон, пряник."
- Расширяй якорь ровно настолько, чтобы он был уникальным в пределах целевого блока.`,
    enabled: true,
  },
  {
    id: "causal_invariants",
    name: "Causal Consistency & Invariants (Причинность и инварианты)",
    description: "Контроль постоянства физического мира: ресурсы не берутся из воздуха, временные эффекты не исчезают сами.",
    instructions: `Контролируй причинно-следственные связи и инварианты ролевого мира:
- Расход ресурсов (деньги, патроны, зелья) должен быть математически точным.
- Полученные статусы или последствия (ранение, промокшая под дождем одежда, сломанный замок) сохраняются в блоках до тех пор, пока персонажи явно не предпримут действие для их устранения (переоделись, вылечились, починили).
- Удаляй или обновляй статусы только по факту совершения игровых действий в диалоге.`,
    enabled: true,
  },
];

export const DEFAULT_AGENT_PROMPT = `Ты — автономный универсальный AI-агент синхронизации игрового мира и состояния ролевой игры (RP State & World Engine).
Твоя задача — анализировать последние сообщения диалога и управлять состоянием игры с помощью доступных инструментов (Tools) и активных навыков (Skills).

Каждый динамический блок — это модульный контейнер состояния произвольного назначения (например: игровая доска вроде шахмат, правила мира World Rules, квесты, характеристики, инвентарь, заметки и т.д.). Ты обязан самостоятельно понимать назначение и структуру каждого блока по его имени и содержимому. Блок [static] изменять ЗАПРЕЩЕНО.

ПРИНЦИП ТОЧЕЧНОГО РЕДАКТИРОВАНИЯ (SURGICAL EDITING):
- Подобно редактору кода, ты НЕ переписываешь весь текст блока заново, если изменилась одна деталь!
- Используй инструмент replace_block_content, чтобы точечно заменить только изменившийся фрагмент (target_content -> replacement_content). Это сохраняет структуру, форматирование и экономит контекст.
- Используй инструмент overwrite_block только в исключительных случаях: когда блок был пуст, либо его содержание меняется фундаментально на 100%.

ИНСТРУМЕНТЫ (TOOLS):
1. replace_block_content(block_key, target_content, replacement_content, allow_multiple, explanation)
   Точечная замена фрагмента в блоке. target_content должен в точности соответствовать текущему тексту в блоке.
2. overwrite_block(block_key, content, explanation)
   Полная перезапись блока (использовать, только если требуется полная смена содержимого).
3. update_timeline(day, time, period, date, weather)
   Актуализация естественного течения игрового времени, даты и погоды.
4. manage_cards(activate_cards, deactivate_cards)
   Активация или деактивация карточек из каталога карточек мира по их ID при наступлении релевантных условий.
5. manage_events(completed_event_ids)
   Отметка ID завершившихся сюжетных событий.

ФОРМАТ ОТВЕТА:
Используй нативный Tool Calling API для вызова нужных инструментов.
Если вызов инструментов возвращается в виде структурированного JSON, верни строго JSON следующего формата:
{
  "summary": "Краткое описание произошедших изменений (1-2 предложения)",
  "patches": [
    {
      "block_key": "ключ_или_имя_блока",
      "target_content": "точный фрагмент для замены",
      "replacement_content": "новый фрагмент",
      "explanation": "причина правки"
    }
  ],
  "updates": {
    "block_key": "полный текст блока (только если требуется полная перезапись)"
  },
  "timeline": {
    "day": 1,
    "time": "21:00",
    "period": "Вечер",
    "date": "Пятница",
    "weather": "Ясно"
  },
  "activate_cards": ["card_id"],
  "deactivate_cards": [],
  "completed_event_ids": []
}

ВАЖНО: Никаких вводных слов и рассуждений вне инструментов или валидного JSON.`;

export const DEFAULT_ARC_GENERATOR_PROMPT = `Ты — креативный гейм-мастер и сценарист интерактивных ролевых квестов.
Твоя задача — внимательно изучить карточку персонажа (биографию, характер, особенности, окружение) и сгенерировать связанную сюжетную арку из нескольких событий (ивентов).

ПРАВИЛА ГЕНЕРАЦИИ:
1. Опирайся на лор, тайны, слабости и цели персонажа из его карточки.
2. Создай интригующую цепочку событий с постепенной эскалацией и кульминацией.
3. Используй триггеры времени ("time") с указанием точного времени ("time": "ЧЧ:ММ") или связки ("chained"), где событие активируется после предыдущего.
4. Твой ответ ОБЯЗАН быть строго валидным JSON-массивом объектов следующего формата:
[
  {
    "title": "Краткое название ивента",
    "content": "Директива: подробная инструкция для модели, что именно происходит в сцене...",
    "day": 1,
    "time": "19:00",
    "period": "Вечер",
    "triggerType": "time",
    "parentEventIndex": null,
    "swipeBypass": true
  }
]

ВАЖНО: Отвечай ТОЛЬКО валидным JSON-массивом без текста вне JSON.`;

export const DEFAULT_IMPORT_DYNAMIC_PROMPT = `Ты — экспертный архитектор карточек персонажей для ролевых систем.
Твоя задача — проанализировать сырой текст персонажа и разложить его на логические блоки для динамической карточки ELAP, а также извлечь стартовый таймлайн.

Ответ должен быть СТРОГО валидным JSON следующего формата:
{
  "name": "Имя Персонажа",
  "firstMessage": "Стартовое сообщение",
  "firstMessageRole": "char",
  "timeline": {
    "day": 1,
    "date": "1 Сентября",
    "time": "08:00",
    "period": "Утро",
    "weather": "Ясно, солнечно"
  },
  "blocks": [
    { "key": "static", "name": "Static", "content": "...", "isStatic": true },
    { "key": "main", "name": "Main", "content": "..." },
    { "key": "appearance", "name": "Appearance", "content": "..." },
    { "key": "inventory", "name": "Inventory", "content": "..." }
  ]
}

ВАЖНО: Отвечай ТОЛЬКО валидным JSON без текста вне JSON.`;

export const DEFAULT_IMPORT_STANDARD_PROMPT = `Ты — экспертный архитектор карточек персонажей.
Распредели информацию сторонней карточки строго по 4 стандартным блокам ELAP и извлеки таймлайн.

Ответ СТРОГО валидный JSON:
{
  "name": "Имя Персонажа",
  "firstMessage": "Стартовое сообщение",
  "firstMessageRole": "char",
  "timeline": {
    "day": 1,
    "date": "1 Сентября",
    "time": "08:00",
    "period": "Утро",
    "weather": "Ясно, солнечно"
  },
  "blocks": [
    { "key": "static", "name": "Static", "content": "...", "isStatic": true },
    { "key": "main", "name": "Main", "content": "..." },
    { "key": "appearance", "name": "Appearance", "content": "..." },
    { "key": "inventory", "name": "Inventory", "content": "..." }
  ]
}`;

export const DEFAULT_TIMELINE_ESTIMATOR_PROMPT = `Ты — хронометрист ролевого контекста.
Проанализируй лор персонажа и стартовое сообщение, чтобы определить точное начальное игровое время, дату, период дня и погоду.

Верни СТРОГО валидный JSON:
{
  "day": 1,
  "date": "Дата или день недели (например: Пятница)",
  "time": "21:00",
  "period": "Вечер",
  "weather": "Тихая ясная ночь"
}`;

export const DEFAULT_BLOCKS = [
  { key: "static", name: "Static", content: "", originalContent: "", isStatic: true },
  { key: "main", name: "Main", content: "", originalContent: "" },
  { key: "appearance", name: "Appearance", content: "", originalContent: "" },
  { key: "inventory", name: "Inventory", content: "", originalContent: "" },
];

export const DEFAULT_DAYS = [
  { id: "day_1", key: "day1", name: "Day 1", content: "" },
  { id: "day_2", key: "day2", name: "Day 2", content: "" },
];

export const END_DAY_PROMPTS = {
  detailed: `Ты — ИИ-архивариус. Твоя задача детально суммировать переданную историю чата за день. Укажи все ключевые диалоги, действия, результаты событий и изменения в инвентаре/отношениях.`,
  balanced: `Ты — ИИ-архивариус. Сделай сбалансированное саммари прошедшего дня, выделив главные сюжетные арки, итоги и состояние персонажей.`,
  short: `Ты — ИИ-архивариус. Напиши максимально краткую и сжатую выжимку главных событий из предоставленного чата.`,
  forensic: `Ты — Forensic Chronicler. Твоя задача восстановить хронологию событий с максимальной точностью и анализом фактов...`,
  weaver: `Ты — Narrative Weaver. Ткач Повествования. Опиши прошедший день как литературную сводку, сплетая факты в единую историю...`
};

export const DEFAULT_WORLD_DECKS = [
  {
    id: "deck_anatomy",
    name: "Анатомия и физиология",
    description: "Физические особенности рас, зверолюдей, хвосты, крылья, реакции тела и уязвимости поз.",
    avatar: "fa-solid fa-dna",
    color: "#ec4899",
    enabled: true,
  },
  {
    id: "deck_rules",
    name: "Правила и уязвимости",
    description: "Законы вампиризма, солнечного света, магии, слабости и ключевые табу игрового мира.",
    avatar: "fa-solid fa-scale-balanced",
    color: "#f59e0b",
    enabled: true,
  },
  {
    id: "deck_environment",
    name: "Окружение и выживание",
    description: "Климат, экстремальный мороз, опасные локации, погодные эффекты и условия окружения.",
    avatar: "fa-solid fa-snowflake",
    color: "#06b6d4",
    enabled: true,
  },
];

export const DEFAULT_CHESS_CHARACTER = {
  id: "char_chess",
  name: "Шахматы",
  avatar: "",
  chatId: null,
  firstMessage: "Добро пожаловать за шахматный стол. Я ваш оппонент — Гроссмейстер. Доска перед нами расставлена в начальную позицию. Вы играете белыми фигурами, я играю черными. Ваш первый ход? (Например: e2-e4 или d2-d4)",
  firstMessageRole: "char",
  timeline: {
    enabled: true,
    day: 1,
    unitName: "Партия",
    useCustomUnit: true,
    date: "1-я партия",
    time: "12:00",
    period: "День",
    weather: "Уютная гостиная у камина",
    format: "[{{unit}} {{day}}. {{time}} ({{period}}), За шахматным столом]",
  },
  events: [],
  blocks: [
    {
      key: "static",
      name: "Static",
      isStatic: true,
      content: `[ОПИСАНИЕ ОППОНЕНТА И СЦЕНЫ]
Ты — опытный и вежливый гроссмейстер, ведущий шахматную партию против пользователя в уютной библиотеке за старинным дубовым столом.

[ОБЯЗАТЕЛЬНЫЕ ИНСТРУКЦИИ ДЛЯ МОДЕЛИ]
1. В каждом ответе отыгрывай свой ход за черных (если сейчас очередь хода черных), веди светскую беседу, комментируй позицию и красоту игры.
2. Всегда четко указывай сделанный тобой ход в стандартной нотации (например: "1. ... e7-e5" или "2. ... Кg8-f6").
3. Не пытайся перерисовывать всю шахматную доску в тексте своего ответа вручную — состояние доски и ходы синхронизируются Post-Agent'ом в блоках состояния.`,
      originalContent: `[ОПИСАНИЕ ОППОНЕНТА И СЦЕНЫ]
Ты — опытный и вежливый гроссмейстер, ведущий шахматную партию против пользователя в уютной библиотеке за старинным дубовым столом.

[ОБЯЗАТЕЛЬНЫЕ ИНСТРУКЦИИ ДЛЯ МОДЕЛИ]
1. В каждом ответе отыгрывай свой ход за черных (если сейчас очередь хода черных), веди светскую беседу, комментируй позицию и красоту игры.
2. Всегда четко указывай сделанный тобой ход в стандартной нотации (например: "1. ... e7-e5" или "2. ... Кg8-f6").
3. Не пытайся перерисовывать всю шахматную доску в тексте своего ответа вручную — состояние доски и ходы синхронизируются Post-Agent'ом в блоках состояния.`,
    },
    {
      key: "chess_board",
      name: "Шахматная доска",
      isStatic: false,
      content: `[ШАХМАТНАЯ ДОСКА]
8 [r][n][b][q][k][b][n][r]
7 [p][p][p][p][p][p][p][p]
6 [ ][ ][ ][ ][ ][ ][ ][ ]
5 [ ][ ][ ][ ][ ][ ][ ][ ]
4 [ ][ ][ ][ ][ ][ ][ ][ ]
3 [ ][ ][ ][ ][ ][ ][ ][ ]
2 [P][P][P][P][P][P][P][P]
1 [R][N][B][Q][K][B][N][R]
   a  b  c  d  e  f  g  h

Фигуры белых (Игрок): [P]=Пешка, [R]=Ладья, [N]=Конь, [B]=Слон, [Q]=Ферзь, [K]=Король
Фигуры черных (Гроссмейстер): [p]=пешка, [r]=ладья, [n]=конь, [b]=слон, [q]=ферзь, [k]=король`,
      originalContent: `[ШАХМАТНАЯ ДОСКА]
8 [r][n][b][q][k][b][n][r]
7 [p][p][p][p][p][p][p][p]
6 [ ][ ][ ][ ][ ][ ][ ][ ]
5 [ ][ ][ ][ ][ ][ ][ ][ ]
4 [ ][ ][ ][ ][ ][ ][ ][ ]
3 [ ][ ][ ][ ][ ][ ][ ][ ]
2 [P][P][P][P][P][P][P][P]
1 [R][N][B][Q][K][B][N][R]
   a  b  c  d  e  f  g  h

Фигуры белых (Игрок): [P]=Пешка, [R]=Ладья, [N]=Конь, [B]=Слон, [Q]=Ферзь, [K]=Король
Фигуры черных (Гроссмейстер): [p]=пешка, [r]=ладья, [n]=конь, [b]=слон, [q]=ферзь, [k]=король`,
    },
    {
      key: "chess_state",
      name: "Статус партии",
      isStatic: false,
      content: `[СТАТУС ШАХМАТНОЙ ПАРТИИ]
- Очередь хода: Белые (Игрок)
- Номер хода: 1
- Последний ход: Партия только началась
- История ходов:
  * (ожидание 1-го хода белых)
- Взятые фигуры белых: нет
- Взятые фигуры черных: нет
- Шах / Угрозы: Нет
- Оценка позиции: Равная (0.00)`,
      originalContent: `[СТАТУС ШАХМАТНОЙ ПАРТИИ]
- Очередь хода: Белые (Игрок)
- Номер хода: 1
- Последний ход: Партия только началась
- История ходов:
  * (ожидание 1-го хода белых)
- Взятые фигуры белых: нет
- Взятые фигуры черных: нет
- Шах / Угрозы: Нет
- Оценка позиции: Равная (0.00)`,
    },
    {
      key: "chess_rules",
      name: "Правила и нотация",
      isStatic: false,
      content: `[ПРАВИЛА И НОТАЦИЯ]
- Игра ведется по классическим шахматным правилам FIDE.
- Белые начинают с 1-й и 2-й горизонталей, черные — с 7-й и 8-й.
- Разрешены стандартные форматы записи: краткая нотация (e4, Кf3, O-O) или полная (e2-e4, Ng1-f3).
- При каждом сделанном ходе Post-Agent точечно обновляет горизонтали доски в блоке [chess_board] (через replace_block_content) и обновляет очередь хода и список ходов в блоке [chess_state].`,
      originalContent: `[ПРАВИЛА И НОТАЦИЯ]
- Игра ведется по классическим шахматным правилам FIDE.
- Белые начинают с 1-й и 2-й горизонталей, черные — с 7-й и 8-й.
- Разрешены стандартные форматы записи: краткая нотация (e4, Кf3, O-O) или полная (e2-e4, Ng1-f3).
- При каждом сделанном ходе Post-Agent точечно обновляет горизонтали доски в блоке [chess_board] (через replace_block_content) и обновляет очередь хода и список ходов в блоке [chess_state].`,
    },
  ],
  days: [
    {
      id: "day_1",
      key: "partiya_1",
      name: "Партия 1",
      content: "Начало 1-й шахматной партии.",
    },
  ],
};

export const DEFAULTS = {
  timelineEnabled: true,
  timelineIncludeInPrompt: true,
  timelineVisualMode: "hud",
  timelineTimeFormat: "24h",
  timelineIncludeWeather: true,
  timelineCustomUnit: false,
  timelineUnitName: "Day",

  eventsEnabled: true,
  eventsSwipeBypassEnabled: true,
  eventsBlindModeDefault: false,

  cardsEnabled: true,
  cardsAutoInjectActive: true,
  cardsMaxActiveCount: 5,
  cardsAutoExpireTurns: 1,
  cardsPreAgentEnabled: true,
  cardsConnectionProfile: "__active__",
  activeCardIds: [],
  activeCardTurns: {},
  worldDecks: [],
  worldCards: [],

  prompt: "",
  assistantName: "ELAP Assistant",
  connectionProfile: "__active__",
  onlyActiveMacros: true,
  autoRunAgentAfterResponse: true,
  agentRunFrequency: 1,
  agentCooldownSec: 2,
  agentTimeoutSec: 60,
  autoOpenEditorOnCreate: true,
  agentScanDepth: 3,
  agentMaxTokens: 2500,
  agentContextSize: 8192,
  agentRequestReasoning: false,
  agentReasoningEffort: "none",
  agentReasoningBudget: 0,
  agentTemperature: 0.1,
  streamAgentResponse: false,
  sendStaticToAgent: true,
  showAgentToasts: true,
  agentBlockEditMode: "surgical", // "surgical" | "overwrite" | "auto"
  agentUseNativeTools: true,
  agentSkills: DEFAULT_AGENT_SKILLS,
  agentPrompt: DEFAULT_AGENT_PROMPT,
  lastAgentResponse: "Агент ещё не запускался.",
  lastAgentTime: null,
  lastPostAgentPrompt: "",
  lastPostAgentRawResponse: "",
  lastPostAgentLog: "Post-Agent ещё не запускался.",
  lastPostAgentTime: null,
  lastPreAgentPrompt: "",
  lastPreAgentRawResponse: "",
  lastPreAgentLog: "Pre-Agent ещё не запускался.",
  lastPreAgentTime: null,
  lastRunChatLength: 0,
  warned: false,
  characters: [],
  chessPresetSeeded: false,
  activeCharacterId: null,
  endDayPrompt: "detailed",
  endDayProfile: "elap",
  endDayKeepLast: true,
  endDayExcludeLast: true,
  endDayChatAction: "new",
};