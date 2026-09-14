/**
 * Оформление ролей и фаз.
 *
 * Здесь только то, что не зависит от языка: значок, цвет, классы.
 * Названия и описания живут в словарях (i18n.js) под ключами
 * `role.<роль>` и `phase.<фаза>`.
 *
 * Значок — не строка, а компонент из icons.jsx. Места отрисовки просто
 * подставляют его: `<info.Icon size={34} />`.
 */

import {
  IconBallot,
  IconCards,
  IconChat,
  IconFedora,
  IconFlag,
  IconGlass,
  IconGrave,
  IconMic,
  IconMoon,
  IconPerson,
  IconScales,
  IconShieldPlus,
  IconSunrise,
} from './icons.jsx';

export const ROLE_INFO = {
  mafia: { key: 'mafia', Icon: IconFedora, className: 'mafia', badge: 'badge-mafia' },
  sheriff: { key: 'sheriff', Icon: IconGlass, className: 'sheriff', badge: 'badge-sheriff' },
  doctor: { key: 'doctor', Icon: IconShieldPlus, className: 'doctor', badge: 'badge-doctor' },
  civilian: { key: 'civilian', Icon: IconPerson, className: 'civilian', badge: 'badge-civil' },
  host: { key: 'host', Icon: IconMic, className: 'host', badge: 'badge-host' },
};

export const PHASE_ICON = {
  roles: IconCards,
  night: IconMoon,
  day: IconSunrise,
  discussion: IconChat,
  voting: IconBallot,
  revote: IconScales,
  verdict: IconGrave,
  ended: IconFlag,
};

export function roleOf(role) {
  return ROLE_INFO[role] || ROLE_INFO.host;
}
