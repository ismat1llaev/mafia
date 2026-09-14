/**
 * Круглый стол.
 *
 * Игроки сидят по кругу, как в живой игре: своё место всегда снизу, соседи
 * дальше по часовой стрелке. Место закреплено за игроком до конца партии —
 * убитые не исчезают из списка, а гаснут на своих стульях, поэтому вся
 * картина партии читается с одного взгляда.
 *
 * Компонент не знает правил. Что показать на месте, решает игровой экран
 * через `info(player)`: `tone` — цвет кольца, `mark` — значок на аватарке,
 * `note` — подпись (её видно только в списочном виде, на столе для неё
 * нет места). Выбор цели задаётся парой `canSelect` + `onSelect`.
 */

import { Avatar, PhaseHead, PlayerRow, Timer } from './components.jsx';
import { haptic } from './tg.js';
import { useT } from './i18n.js';
import { IconClose, IconList, IconRound } from './icons.jsx';

const VIEW_KEY = 'mafia_view';

/** Выбранный вид переживает перезаход в игру. */
export function loadView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'table';
  } catch {
    return 'table';
  }
}

export function saveView(view) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* приватный режим */ }
}

/** Кнопка в шапке: показывает, куда переключит, а не где вы сейчас. */
export function ViewSwitch({ view, onChange }) {
  const { t } = useT();
  const next = view === 'table' ? 'list' : 'table';
  return (
    <button
      className="btn btn-ghost btn-sm view-switch"
      title={t(`view.${next}`)}
      aria-label={t(`view.${next}`)}
      onClick={() => { haptic('select'); onChange(next); }}
    >
      {next === 'list' ? <IconList size={18} /> : <IconRound size={18} />}
    </button>
  );
}

/**
 * Один и тот же расклад в двух видах.
 * Так у стола и списка общий источник правды: любая фаза описывает места
 * один раз, а игрок сам выбирает, как ему удобнее смотреть.
 */
export function Seats({ view, players, meId, head, selectedId, onSelect, canSelect, info }) {
  const meta = (p) => (info ? info(p) || {} : {});
  const pickable = (p) => !!onSelect && (canSelect ? canSelect(p) : false);

  if (view === 'list') {
    return (
      <>
        <PhaseHead {...head} />
        <div className="players">
          {players.map((p) => {
            const m = meta(p);
            const can = pickable(p);
            return (
              <PlayerRow
                key={p.id}
                player={p}
                meId={meId}
                selected={selectedId === p.id}
                onSelect={can ? onSelect : undefined}
                disabled={!can}
                subtitle={m.note}
                right={m.mark ? <span className="badge badge-count">{m.mark}</span> : null}
              />
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="table-wrap">
      <Table
        players={players}
        meId={meId}
        head={head}
        selectedId={selectedId}
        onSelect={onSelect}
        pickable={pickable}
        meta={meta}
      />
      {head?.subtitle && <div className="muted center">{head.subtitle}</div>}
    </div>
  );
}

function Table({ players, meId, head, selectedId, onSelect, pickable, meta }) {
  const n = Math.max(players.length, 1);

  // Своё место — внизу по центру, как будто вы сидите ближе всех к экрану
  const mine = players.findIndex((p) => p.id === meId);
  const order = mine > 0 ? [...players.slice(mine), ...players.slice(0, mine)] : players;

  return (
    <div className={`table${n >= 10 ? ' dense' : ''}`}>
      <div className="table-felt" />

      <div className="table-center">
        {head?.Icon && <div className="phase-icon"><head.Icon size={28} /></div>}
        <div className="phase-title">{head?.title}</div>
        <Timer endsAt={head?.endsAt} startedAt={head?.startedAt} skew={head?.skew} />
      </div>

      {order.map((p, i) => {
        // Угол отсчитывается от низа круга: ось Y на экране смотрит вниз,
        // поэтому π/2 — это шесть часов, а рост угла идёт по часовой стрелке.
        const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
        const style = {
          left: `calc(50% + var(--rx) * ${Math.cos(a).toFixed(4)})`,
          top: `calc(50% + var(--ry) * ${Math.sin(a).toFixed(4)})`,
        };
        return (
          <Seat
            key={p.id}
            player={p}
            style={style}
            isMe={p.id === meId}
            selected={selectedId === p.id}
            can={pickable(p)}
            m={meta(p)}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

function Seat({ player, style, isMe, selected, can, m, onSelect }) {
  const { t } = useT();

  const cls = [
    'seat',
    !player.alive && 'dead',
    isMe && 'me',
    m.tone && `tone-${m.tone}`,
    selected && 'sel',
    can && 'pick',
  ].filter(Boolean).join(' ');

  const body = (
    <>
      <span className="seat-face">
        <Avatar player={player} />
        {!player.alive && <span className="seat-x"><IconClose size={18} /></span>}
        {m.mark && <span className="seat-mark">{m.mark}</span>}
        {player.alive && !player.connected && <span className="seat-off" title={t('game.noSignal')} />}
      </span>
      <span className="seat-name">{player.name}</span>
    </>
  );

  if (!can) return <div className={cls} style={style}>{body}</div>;

  return (
    <button
      className={cls}
      style={style}
      onClick={() => { haptic('select'); onSelect(player.id); }}
    >
      {body}
    </button>
  );
}
