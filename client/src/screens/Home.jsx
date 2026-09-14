import { useState } from 'react';
import { haptic } from '../tg.js';
import { ChannelButton, RulesCard } from '../components.jsx';
import { useT } from '../i18n.js';
import { IconBook, IconBot, IconDoor, IconPlus } from '../icons.jsx';
import logo from '../logo.png';
import logo2x from '../logo@2x.png';

/** Крупная кнопка-строка: значок, заголовок, пояснение, шеврон. */
function HeroButton({ className = '', icon, title, note, onClick }) {
  return (
    <button className={`btn btn-hero ${className}`} onClick={onClick}>
      <span className="hero-ic">{icon}</span>
      <span className="hero-body">
        <span className="hero-title">{title}</span>
        {note && <span className="btn-note">{note}</span>}
      </span>
      <span className="hero-arrow" aria-hidden="true">›</span>
    </button>
  );
}

export function Home({ user, stats, onCreate, onJoin, onOpenRooms, onPlayBots, joinError, initialCode, config, rooms }) {
  const { t } = useT();
  const [code, setCode] = useState(initialCode || '');
  const [showRules, setShowRules] = useState(false);

  const roomCount = rooms?.length ?? null;

  const submitJoin = (e) => {
    e.preventDefault();
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 4) return;
    haptic('medium');
    onJoin(clean);
  };

  return (
    <div className="screen">
      <div className="phase-head" style={{ paddingTop: 10 }}>
        <img
          className="brand-logo"
          src={logo}
          srcSet={`${logo} 1x, ${logo2x} 2x`}
          alt=""
          width={96}
          height={96}
        />
        <h1>{t('app.title')}</h1>
        <div className="muted center">
          {user ? t('app.hello', { name: user.name }) : t('app.tagline')}
        </div>
      </div>

      {stats?.games > 0 && (
        <div className="grid-2">
          <div className="stat-tile">
            <div className="stat-value">{stats.games}</div>
            <div className="stat-label">{t('home.games')}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-value">{stats.winRate}%</div>
            <div className="stat-label">{t('home.winrate')}</div>
          </div>
        </div>
      )}

      <div className="hero-stack">
        <HeroButton
          className="btn-primary"
          icon={<IconPlus size={22} />}
          title={t('home.create')}
          note={t('home.createNote')}
          onClick={() => { haptic('medium'); onCreate(); }}
        />

        <HeroButton
          className="btn-bots"
          icon={<IconBot size={22} />}
          title={t('home.bots')}
          note={t('home.botsNote')}
          onClick={() => { haptic('medium'); onPlayBots(); }}
        />

        <HeroButton
          className="btn-rooms"
          icon={<IconDoor size={22} />}
          title={t('home.openRoomsBtn')}
          note={roomCount === null
            ? '…'
            : roomCount > 0
              ? t('home.roomsWaiting', roomCount)
              : t('home.roomsEmpty')}
          onClick={() => { haptic('medium'); onOpenRooms(); }}
        />
      </div>

      <div className="card">
        <div className="label center" style={{ marginBottom: 10 }}>{t('home.orCode')}</div>
        <form onSubmit={submitJoin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="input input-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
            placeholder="—————"
            maxLength={5}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={code.length < 4}>
            {t('common.enter')}
          </button>
        </form>
        {joinError && <div className="banner" style={{ marginTop: 12 }}>{joinError}</div>}
      </div>

      <div className="row">
        <button className="btn btn-ghost" onClick={() => { haptic('light'); setShowRules((v) => !v); }}>
          <IconBook size={18} />
          {showRules ? t('common.hideRules') : t('common.rules')}
        </button>
        <ChannelButton url={config?.channelUrl} />
      </div>

      {showRules && <RulesCard />}

      <div className="spacer" />
      <div className="dim center">{t('app.voiceHint')}</div>
    </div>
  );
}
