/**
 * Иконки интерфейса.
 *
 * Раньше их роль играли эмодзи. Проблема не только во внешнем виде: эмодзи
 * рисует шрифт системы, поэтому на разных телефонах они разного размера,
 * цвета и веса, а часть (🫀, 🗳) на старых Android просто не существует и
 * выводится квадратиком. Здесь — обычный SVG: один вес линий, цвет берётся
 * из currentColor, размер задаётся числом.
 *
 * Все иконки нарисованы в сетке 24×24 штрихом 1.7 со скруглёнными концами.
 */

const Svg = ({ size = 24, children, fill = 'none', ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

/* ─────────── логотип ─────────── */

/**
 * Две театральные маски — знак игры.
 *
 * Единственная сплошная иконка в наборе: на крупном размере штриховой
 * рисунок распадается на отдельные линии, а знак должен читаться целиком.
 * Глаза и рот вырезаны в той же фигуре правилом evenodd.
 */
export const IconMasks = ({ size = 24, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path
      d="M2.4 4.6h5.2v6.2a8.8 8.8 0 0 0 2.3 5.9 6.6 6.6 0 0 1-7.5-6.5V4.6Z"
      opacity="0.42"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.6 3.2h10.8a2.2 2.2 0 0 1 2.2 2.2v5.9a7.6 7.6 0 0 1-15.2 0V5.4a2.2 2.2 0 0 1 2.2-2.2Zm2.3 5a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Zm6.2 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Zm-6.4 5h6.6a.85.85 0 0 1 .75 1.25 4.55 4.55 0 0 1-8.1 0 .85.85 0 0 1 .75-1.25Z"
    />
  </svg>
);

/* ─────────── роли ─────────── */

/** Мафия — шляпа-федора. */
export const IconFedora = (p) => (
  <Svg {...p}>
    <path d="M7 11.4c0-3.4.6-5.9 1.4-6.6.7-.6 1.9-.2 3.6-.2s2.9-.4 3.6.2c.8.7 1.4 3.2 1.4 6.6" />
    <path d="M7.1 10.6C4 11.2 2 12.3 2 13.6 2 15.5 6.5 17 12 17s10-1.5 10-3.4c0-1.3-2-2.4-5.1-3" />
    <path d="M7.4 9.2c1.3.5 2.9.8 4.6.8s3.3-.3 4.6-.8" opacity="0.55" />
  </Svg>
);

/** Комиссар — лупа. */
export const IconGlass = (p) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.5 15.5 5 5" />
    <path d="M8.2 8.4a3.8 3.8 0 0 1 2.6-1.3" opacity="0.55" />
  </Svg>
);

/** Доктор — щит с крестом: он не лечит, а прикрывает. */
export const IconShieldPlus = (p) => (
  <Svg {...p}>
    <path d="M12 2.8 4.6 5.6v6c0 4.4 3 8.2 7.4 9.6 4.4-1.4 7.4-5.2 7.4-9.6v-6L12 2.8Z" />
    <path d="M12 8.8v5.4M9.3 11.5h5.4" />
  </Svg>
);

/** Мирный житель — человек. */
export const IconPerson = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
  </Svg>
);

/** Ведущий — микрофон. */
export const IconMic = (p) => (
  <Svg {...p}>
    <rect x="9" y="2.6" width="6" height="11" rx="3" />
    <path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0" />
    <path d="M12 17.8v3.6M9 21.4h6" />
  </Svg>
);

/* ─────────── фазы ─────────── */

/** Раздача ролей — две карты веером. */
export const IconCards = (p) => (
  <Svg {...p}>
    <rect x="9.4" y="4.4" width="10.4" height="15.2" rx="2.2" />
    <path d="M6.6 6.9 5.2 7.4a2.2 2.2 0 0 0-1.3 2.8l3 8.6a2.2 2.2 0 0 0 2.8 1.3" />
    <path d="M12.4 9.4h4.4M12.4 12.4h4.4" opacity="0.55" />
  </Svg>
);

/** Ночь — месяц. */
export const IconMoon = (p) => (
  <Svg {...p}>
    <path d="M20.4 14.6A8.7 8.7 0 0 1 9.4 3.6a8.7 8.7 0 1 0 11 11Z" />
    <path d="M17.6 3.4v2.4M16.4 4.6h2.4" opacity="0.55" />
  </Svg>
);

/** Утро — солнце над горизонтом. */
export const IconSunrise = (p) => (
  <Svg {...p}>
    <path d="M7.4 14.4a4.6 4.6 0 0 1 9.2 0" />
    <path d="M2.6 18.2h18.8" />
    <path d="M12 3.2v2.6M4.6 7.2l1.8 1.8M19.4 7.2l-1.8 1.8" opacity="0.7" />
    <path d="M5.6 21.4h3.2M15.2 21.4h3.2" opacity="0.4" />
  </Svg>
);

/** Обсуждение — реплики. */
export const IconChat = (p) => (
  <Svg {...p}>
    <path d="M15.6 13.4a2 2 0 0 1-2 2H8.2l-3.6 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9.6a2 2 0 0 1 2 2Z" />
    <path d="M18.6 8.2H20a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2v2.6l-2.8-2.6" opacity="0.6" />
  </Svg>
);

/** Голосование — урна с бюллетенем. */
export const IconBallot = (p) => (
  <Svg {...p}>
    <path d="M3.4 11.6h17.2a1 1 0 0 1 1 1.1l-.7 6.6a1.8 1.8 0 0 1-1.8 1.6H5.9a1.8 1.8 0 0 1-1.8-1.6l-.7-6.6a1 1 0 0 1 1-1.1Z" />
    <path d="M8 11.6V4.6a1.4 1.4 0 0 1 1.4-1.4h5.2A1.4 1.4 0 0 1 16 4.6v7" />
    <path d="M10.4 7.2h3.2M10.4 9.4h3.2" opacity="0.6" />
  </Svg>
);

/** Переголосование — весы. */
export const IconScales = (p) => (
  <Svg {...p}>
    <path d="M12 4.4v15.2M8 20.6h8" />
    <path d="M5.2 7.4h13.6" />
    <path d="M5.2 7.4 2.6 13.4h5.2L5.2 7.4Z" />
    <path d="M18.8 7.4l-2.6 6h5.2l-2.6-6Z" />
    <circle cx="12" cy="4.2" r="1.3" />
  </Svg>
);

/** Приговор — надгробие. */
export const IconGrave = (p) => (
  <Svg {...p}>
    <path d="M6.6 20.4v-10a5.4 5.4 0 0 1 10.8 0v10" />
    <path d="M4.2 20.6h15.6" />
    <path d="M12 8v5.4M9.6 10.2h4.8" opacity="0.7" />
  </Svg>
);

/** Конец партии — флажок. */
export const IconFlag = (p) => (
  <Svg {...p}>
    <path d="M5.6 21V3.4" />
    <path d="M5.6 4.4h11.8l-2 3.6 2 3.6H5.6" />
  </Svg>
);

/* ─────────── интерфейс ─────────── */

/** Бот. */
export const IconBot = (p) => (
  <Svg {...p}>
    <rect x="3.6" y="7.6" width="16.8" height="12.2" rx="3.4" />
    <path d="M12 3.2v4.4M8.4 13.2v1.6M15.6 13.2v1.6" />
    <circle cx="12" cy="2.6" r="1.2" />
    <path d="M3.6 12.4H2M22 12.4h-1.6" opacity="0.6" />
  </Svg>
);

/** Открытые комнаты — дверь. */
export const IconDoor = (p) => (
  <Svg {...p}>
    <path d="M6.4 21V4.6a1.6 1.6 0 0 1 1.3-1.6l7.4-1.4a1.6 1.6 0 0 1 1.9 1.6v16.2a1.6 1.6 0 0 1-1.9 1.6l-7.4-1.4A1.6 1.6 0 0 1 6.4 21Z" />
    <path d="M3.6 21.4h16.8" />
    <circle cx="13.4" cy="12.2" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

/** Правила — книга. */
export const IconBook = (p) => (
  <Svg {...p}>
    <path d="M3.4 4.4a1.6 1.6 0 0 1 1.9-1.6L11 4v16l-5.7-1.2a1.6 1.6 0 0 1-1.9-1.6Z" />
    <path d="M20.6 4.4a1.6 1.6 0 0 0-1.9-1.6L13 4v16l5.7-1.2a1.6 1.6 0 0 0 1.9-1.6Z" />
  </Svg>
);

/**
 * Настройки — ползунки, а не шестерёнка: зубцы на 18 пикселях сливаются
 * в звёздочку, а две линии с бегунками читаются на любом размере.
 */
export const IconGear = (p) => (
  <Svg {...p}>
    <path d="M3.6 8.4h4.2M13.2 8.4h7.2M3.6 15.6h7.2M16.6 15.6h3.8" />
    <circle cx="10.5" cy="8.4" r="2.6" />
    <circle cx="13.9" cy="15.6" r="2.6" />
  </Svg>
);

/** Канал — рупор. */
export const IconMegaphone = (p) => (
  <Svg {...p}>
    <path d="M4 9.4h3.2L18 4.6v14.8L7.2 14.6H4a1.6 1.6 0 0 1-1.6-1.6V11A1.6 1.6 0 0 1 4 9.4Z" />
    <path d="M20.8 9.6a3.2 3.2 0 0 1 0 4.8" />
    <path d="M7.4 14.8V19a1.8 1.8 0 0 0 3.5.5l.5-1.8" opacity="0.6" />
  </Svg>
);

/** Сколько живых — пульс. */
export const IconPulse = (p) => (
  <Svg {...p}>
    <path d="M2.6 12.4h4l2-4.8 3.4 9.2 2.4-6 1.6 3h5.4" />
  </Svg>
);

/** Пригласить — человек с плюсом. */
export const IconInvite = (p) => (
  <Svg {...p}>
    <circle cx="9.4" cy="8" r="3.6" />
    <path d="M2.8 20a6.6 6.6 0 0 1 13.2 0" />
    <path d="M19 8.6v5M16.5 11.1h5" />
  </Svg>
);

/** Копировать. */
export const IconCopy = (p) => (
  <Svg {...p}>
    <rect x="8.6" y="8.6" width="12" height="12" rx="2.4" />
    <path d="M15.4 5.6V5a1.6 1.6 0 0 0-1.6-1.6H5a1.6 1.6 0 0 0-1.6 1.6v8.8A1.6 1.6 0 0 0 5 15.4h.6" />
  </Svg>
);

/** Замок — экран «откройте через бота». */
export const IconLock = (p) => (
  <Svg {...p}>
    <rect x="4.4" y="10.4" width="15.2" height="10.6" rx="2.6" />
    <path d="M7.8 10.2V7.6a4.2 4.2 0 0 1 8.4 0v2.6" />
    <path d="M12 14.6v2.4" />
  </Svg>
);

/** Отправить сообщение. */
export const IconSend = (p) => (
  <Svg {...p}>
    <path d="M3.4 11.8 20.6 4l-7.4 17-2-6.6-7.8-2.6Z" />
  </Svg>
);

export const IconCheck = (p) => (
  <Svg {...p}>
    <path d="m4.6 12.6 4.8 4.8L19.4 7.4" />
  </Svg>
);

export const IconClose = (p) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const IconPlus = (p) => (
  <Svg {...p}>
    <path d="M12 5.4v13.2M5.4 12h13.2" />
  </Svg>
);

export const IconMinus = (p) => (
  <Svg {...p}>
    <path d="M5.4 12h13.2" />
  </Svg>
);

/** Вид «список». */
export const IconList = (p) => (
  <Svg {...p}>
    <path d="M9 6.4h11.4M9 12h11.4M9 17.6h11.4" />
    <circle cx="4.4" cy="6.4" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.4" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.4" cy="17.6" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

/** Вид «круглый стол». */
export const IconRound = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="5.2" />
    <circle cx="12" cy="3.4" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="20.6" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="20.6" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="3.4" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

/** Цель ночного выбора. */
export const IconCrosshair = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.6" />
    <path d="M12 1.8v4M12 18.2v4M22.2 12h-4M5.8 12h-4" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </Svg>
);
