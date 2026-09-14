import { useEffect, useState } from 'react';
import { useGameSocket } from './socket.js';
import { initialRoomCode, initTelegram, backButton } from './tg.js';
import { LangProvider, useT } from './i18n.js';
import { LangSwitch } from './components.jsx';
import { IconLock } from './icons.jsx';
import { Home } from './screens/Home.jsx';
import { Rooms } from './screens/Rooms.jsx';
import { Lobby } from './screens/Lobby.jsx';
import { Game } from './screens/Game.jsx';
import { GameOver } from './screens/GameOver.jsx';

const AUTO_CODE = typeof window !== 'undefined' ? initialRoomCode() : '';

function Shell() {
  const { t } = useT();
  const [config, setConfig] = useState(null);
  const [view, setView] = useState('home'); // home | rooms
  const { status, state, user, stats, error, joinError, rooms, clockSkew, actions, clearError } =
    useGameSocket({ autoCode: AUTO_CODE });

  useEffect(() => {
    initTelegram();
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  // Пока человек не в комнате, держим список открытых комнат свежим:
  // на главной по нему показывается счётчик, на экране списка — сами комнаты.
  const inRoom = !!state;
  useEffect(() => {
    if (inRoom || !user) return undefined;
    actions.listRooms();
    const id = setInterval(() => actions.listRooms(), 5000);
    return () => clearInterval(id);
  }, [inRoom, !!user]);

  // Зашли в комнату — экран списка больше не нужен
  useEffect(() => {
    if (inRoom) setView('home');
  }, [inRoom]);

  // Аппаратная кнопка «назад»: из комнаты выводит наружу, со списка — на главную
  useEffect(() => {
    if (state) return backButton(true, () => actions.leave());
    if (view === 'rooms') return backButton(true, () => setView('home'));
    return backButton(false);
  }, [!!state, view]);

  // Ошибки показываем ненадолго и убираем сами
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 4000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  /** Сервер присылает код ошибки — фразу подбираем по текущему языку. */
  const errText = (e) => (e ? t(`err.${e.code}`, e.params) : null);

  if (status === 'rejected') {
    return (
      <div className="app">
        <LangSwitch />
        <div className="loader">
          <div className="brand-mark small"><IconLock size={26} /></div>
          <div className="center muted" style={{ maxWidth: 300, whiteSpace: 'pre-line' }}>
            {t('app.locked')} <b>@MafiaGameGGbot</b>
          </div>
          {error && <div className="dim center" style={{ maxWidth: 300 }}>{errText(error)}</div>}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <LangSwitch />
        <div className="loader">
          <div className="spinner" />
          <div>{t(status === 'offline' ? 'app.reconnecting' : 'app.connecting')}</div>
        </div>
      </div>
    );
  }

  const phase = state?.phase || 'lobby';

  return (
    <div className={`app phase-${phase}`}>
      <LangSwitch />

      {status === 'offline' && (
        <div className="banner" style={{ marginBottom: 12 }}>{t('app.offline')}</div>
      )}

      {error && <div className="banner" style={{ marginBottom: 12 }}>{errText(error)}</div>}

      {!state && view === 'home' && (
        <Home
          user={user}
          stats={stats}
          config={config}
          initialCode={AUTO_CODE}
          joinError={errText(joinError)}
          rooms={rooms}
          onOpenRooms={() => setView('rooms')}
          onCreate={() => actions.create()}
          onPlayBots={() => actions.playBots()}
          onJoin={(code) => actions.join(code)}
        />
      )}

      {!state && view === 'rooms' && (
        <Rooms
          rooms={rooms}
          onJoin={(code) => actions.join(code)}
          onCreate={() => actions.create()}
          onBack={() => setView('home')}
        />
      )}

      {state && phase === 'lobby' && (
        <Lobby state={state} config={config} actions={actions} onLeave={() => actions.leave()} />
      )}

      {state && phase === 'ended' && (
        <GameOver state={state} actions={actions} onLeave={() => actions.leave()} />
      )}

      {state && phase !== 'lobby' && phase !== 'ended' && (
        <Game state={state} actions={actions} skew={clockSkew} onLeave={() => actions.leave()} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
