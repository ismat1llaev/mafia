import { useEffect, useRef, useState } from 'react';
import { roleOf } from './roles.js';
import { haptic, tg } from './tg.js';
import { useT } from './i18n.js';
import { IconBot, IconMegaphone, IconMinus, IconPlus, IconSend } from './icons.jsx';

/** Переключатель языка в правом верхнем углу. */
export function LangSwitch() {
  const { lang, setLang } = useT();
  return (
    <div className="lang-switch">
      <button
        className={lang === 'ru' ? 'on' : ''}
        onClick={() => { haptic('select'); setLang('ru'); }}
      >
        RUS
      </button>
      <button
        className={lang === 'en' ? 'on' : ''}
        onClick={() => { haptic('select'); setLang('en'); }}
      >
        ENG
      </button>
    </div>
  );
}

/** Обратный отсчёт до конца фазы с поправкой на расхождение часов. */
export function Timer({ endsAt, startedAt, skew = 0 }) {
  const { t } = useT();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  if (!endsAt) return null;

  const left = Math.max(0, Math.round((endsAt + skew - now) / 1000));
  const total = startedAt ? Math.max(1, Math.round((endsAt - startedAt) / 1000)) : null;
  const pct = total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  return (
    <>
      <div className={`timer${left <= 10 ? ' urgent' : ''}`}>
        {mm > 0 ? `${mm}:${ss}` : t('common.sec', left)}
      </div>
      {total && (
        <div className="progress" style={{ maxWidth: 200 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
    </>
  );
}

export function Avatar({ player }) {
  const initials = (player.name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className={`avatar${player.isBot ? ' avatar-bot' : ''}`}>
      {player.photo ? <img src={player.photo} alt="" /> : player.isBot ? <IconBot size={20} /> : initials}
    </div>
  );
}

/** Строка игрока. Если передан onSelect — становится кнопкой выбора цели. */
export function PlayerRow({ player, meId, selected, onSelect, disabled, right, subtitle }) {
  const { t } = useT();
  const info = player.role ? roleOf(player.role) : null;
  const clickable = !!onSelect && !disabled;

  const classes = [
    'player',
    !player.alive && 'dead',
    player.id === meId && 'me',
    selected && 'selected',
    clickable && 'selectable',
  ].filter(Boolean).join(' ');

  const defaultSub = !player.alive
    ? t(player.deathReason === 'vote' ? 'game.diedVote' : 'game.diedNight')
    : player.isSpectatingHost ? t('game.host')
    : player.connected ? t('game.inGame')
    : t('game.noSignal');

  const body = (
    <>
      <Avatar player={player} />
      <div className="player-main">
        <div className="player-name">
          {player.name}
          {player.isBot && <span className="chip-bot">{t('bots.badge')}</span>}
          {player.id === meId && <span className="dim"> · {t('common.you')}</span>}
        </div>
        <div className="player-sub">{subtitle || defaultSub}</div>
      </div>
      {right}
      {info && player.role && (
        <span className={`badge ${info.badge}`}>{t(`role.${info.key}`)}</span>
      )}
      {player.alive && !info && <span className={`dot${player.connected ? '' : ' off'}`} />}
    </>
  );

  if (!clickable) return <div className={classes}>{body}</div>;

  return (
    <button className={classes} onClick={() => { haptic('select'); onSelect(player.id); }}>
      {body}
    </button>
  );
}

export function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          disabled={disabled}
          onClick={() => { haptic('select'); onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, step = 1, onChange, format, disabled }) {
  const clamp = (v) => Math.min(max, Math.max(min, v));
  return (
    <div className="stepper">
      <button
        aria-label="−"
        disabled={disabled || value <= min}
        onClick={() => { haptic('light'); onChange(clamp(value - step)); }}
      >
        <IconMinus size={16} />
      </button>
      <span>{format ? format(value) : value}</span>
      <button
        aria-label="+"
        disabled={disabled || value >= max}
        onClick={() => { haptic('light'); onChange(clamp(value + step)); }}
      >
        <IconPlus size={16} />
      </button>
    </div>
  );
}

/** Журнал событий. Сервер присылает коды, текст собирается здесь. */
export function EventLog({ log }) {
  const { t } = useT();
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log?.length]);

  if (!log?.length) return null;
  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>{t('game.whatHappened')}</div>
      <div className="log" ref={ref}>
        {log.map((e, i) => (
          <div key={i} className={`log-item ${e.kind}`}>{t(`log.${e.code}`, e.params)}</div>
        ))}
      </div>
    </div>
  );
}

export function Chat({ messages, onSend, placeholder, variant = 'day', disabled }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages?.length]);

  const submit = (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    onSend(clean);
    setText('');
  };

  return (
    <div className="card chat">
      <div className="chat-log" ref={ref}>
        {messages?.length
          ? messages.map((m) => (
              <div key={m.id} className={`chat-msg ${variant}${m.bot ? ' from-bot' : ''}`}>
                <b>{m.name}:</b>{' '}
                {/* Боты присылают код реплики, люди — свой текст */}
                {m.code ? t(`bot.say.${m.code}`, m.params) : m.text}
              </div>
            ))
          : <div className="dim">{t('game.noMessages')}</div>}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          className="input"
          value={text}
          maxLength={300}
          disabled={disabled}
          placeholder={placeholder || t('game.write')}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" aria-label={t('game.write')} disabled={disabled || !text.trim()}>
          <IconSend size={18} />
        </button>
      </form>
    </div>
  );
}

export function PhaseHead({ Icon, iconSize = 34, title, subtitle, endsAt, startedAt, skew }) {
  return (
    <div className="phase-head">
      {Icon && <div className="phase-icon"><Icon size={iconSize} /></div>}
      <div className="phase-title">{title}</div>
      {subtitle && <div className="muted center">{subtitle}</div>}
      <Timer endsAt={endsAt} startedAt={startedAt} skew={skew} />
    </div>
  );
}

/** Правила игры. Один текст и на главной, и в лобби — чтобы не разъезжались. */
export function RulesCard() {
  const { t } = useT();
  return (
    <div className="card">
      <h2 style={{ marginBottom: 10 }}>{t('rules.title')}</h2>

      <p className="muted" style={{ marginTop: 0 }}>
        <b style={{ color: 'var(--mafia)' }}>{t('rules.mafia')}</b> {t('rules.mafiaText')}<br />
        <b style={{ color: 'var(--doctor)' }}>{t('rules.doctor')}</b> {t('rules.doctorText')}<br />
        <b style={{ color: 'var(--sheriff)' }}>{t('rules.sheriff')}</b> {t('rules.sheriffText')}<br />
        <b style={{ color: 'var(--civil)' }}>{t('rules.civil')}</b> {t('rules.civilText')}
      </p>

      <p className="muted">{t('rules.counts')}</p>
      <p className="muted">{t('rules.healRule')}</p>

      <p className="muted">
        <b>{t('rules.night')}</b> {t('rules.nightText')}<br />
        <b>{t('rules.morning')}</b> {t('rules.morningText')}<br />
        <b>{t('rules.day')}</b> {t('rules.dayText')}
      </p>

      <p className="muted" style={{ marginBottom: 0 }}>
        <b>{t('rules.townWin')}</b>{t('rules.townWinText')}<br />
        <b>{t('rules.mafiaWin')}</b>{t('rules.mafiaWinText')}
      </p>
    </div>
  );
}

/** Кнопка подписки на канал. Не показывается, пока адрес канала не задан. */
export function ChannelButton({ url, className = 'btn btn-ghost' }) {
  const { t } = useT();
  if (!url) return null;
  return (
    <button
      className={className}
      onClick={() => {
        haptic('light');
        if (tg?.openTelegramLink) tg.openTelegramLink(url);
        else window.open(url, '_blank', 'noopener');
      }}
    >
      <IconMegaphone size={18} />
      {t('common.channel')}
    </button>
  );
}
