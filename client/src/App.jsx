import { useEffect, useState } from 'react';
import { useGameSocket } from './socket.js';
import { initialRoomCode, initTelegram, backButton } from './tg.js';
import { LangProvider, useT } from './i18n.js';
import { LangSwitch } from './components.jsx';
import { IdBadge, IdCard } from './idcard.jsx';
import { IconLock } from './icons.jsx';
import { Home } from './screens/Home.jsx';
import { Rooms } from './screens/Rooms.jsx';
import { Lobby } from './screens/Lobby.jsx';
import { Game } from './screens/Game.jsx';
import { GameOver } from './screens/GameOver.jsx';
import welcome from './welcome.jpg';

const AUTO_CODE = typeof window !== 'undefined' ? initialRoomCode() : '';

// Заставка держится не меньше этого, чтобы не мелькнуть на быстрой связи
const SPLASH_MIN_MS = 1800;
const SPLASH_FADE_MS = 450;

/**
 * Заставка «Welcome to the Mafia».
 *
 * Игрок нажал «Играть» в боте — и первым делом видит её, а не пустой
 * экран с крутилкой. Уходит, когда прошло SPLASH_MIN_MS и есть связь.
 * Спящий сервер на Render просыпается до минуты — всё это время заставка
 * остаётся на месте, а под ней появляется «Подключаюсь…».
 * Тап убирает её сразу, если уже есть куда переходить.
 */
function Splash({ ready, offline, onDone }) {
  const { t } = useT();
  const [minPassed, setMinPassed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setMinPassed(true), SPLASH_MIN_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (ready && minPassed) setLeaving(true);
  }, [ready, minPassed]);

  useEffect(() => {
    if (!leaving) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = setTimeout(onDone, reduced ? 0 : SPLASH_FADE_MS);
    return () => clearTimeout(id);
    // onDone каждый раз новый, а уйти заставка должна один раз
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return (
    <div
      className={`splash${leaving ? ' leaving' : ''}`}
      role="status"
      aria-live="polite"
      onClick={() => { if (ready) setLeaving(true); }}
    >
      <img className="splash-art" src={welcome} alt={t('splash.title')} width={1200} height={1200} />
      <div className={`splash-status${minPassed && !ready ? ' on' : ''}`}>
        <span className="spinner" />
        {t(offline ? 'app.reconnecting' : 'app.connecting')}
      </div>
    </div>
  );
}

function Shell() {
  const { t } = useT();
  const [config, setConfig] = useState(null);
  const [view, setView] = useState('home'); // home | rooms
  const [cardOpen, setCardOpen] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const {
    status, state, user, stats, error, joinError, rooms, clockSkew, profile, profileAck, actions, clearError,
  } = useGameSocket({ autoCode: AUTO_CODE });

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

  // Аппаратная кнопка «назад»: закрывает удостоверение, из комнаты выводит
  // наружу, со списка — на главную
  useEffect(() => {
    if (cardOpen) return backButton(true, () => setCardOpen(false));
    if (state) return backButton(true, () => actions.leave());
    if (view === 'rooms') return backButton(true, () => setView('home'));
    return backButton(false);
  }, [cardOpen, !!state, view]);

  // Ошибки показываем ненадолго и убираем сами
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 4000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  /** Сервер присылает код ошибки — фразу подбираем по текущему языку. */
  const errText = (e) => (e ? t(`err.${e.code}`, e.params) : null);

  let body;

  if (status === 'rejected') {
    body = (
      <div className="app">
        <div className="app-head"><LangSwitch /></div>
        <div className="loader">
          <div className="brand-mark small"><IconLock size={26} /></div>
          <div className="center muted" style={{ maxWidth: 300, whiteSpace: 'pre-line' }}>
            {t('app.locked')} <b>@MafiaGameGGbot</b>
          </div>
          {error && <div className="dim center" style={{ maxWidth: 300 }}>{errText(error)}</div>}
        </div>
      </div>
    );
  } else if (!user) {
    body = (
      <div className="app">
        <div className="app-head"><LangSwitch /></div>
        <div className="loader">
          <div className="spinner" />
          <div>{t(status === 'offline' ? 'app.reconnecting' : 'app.connecting')}</div>
        </div>
      </div>
    );
  } else {
    const phase = state?.phase || 'lobby';
    // Фоновая фотография только на главной: внутри партии круглый стол
    // со снимка оказывается за игровым столом и мешает читать места
    const onHome = !state && view === 'home';

    body = (
      <div className={`app phase-${phase}${onHome ? ' on-home' : ''}`}>
        <div className="app-head">
          <IdBadge user={user} profile={profile} onOpen={() => setCardOpen(true)} />
          <LangSwitch />
        </div>

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

  return (
    <>
      {body}

      {/* Вне .app: иначе на главной стеклянные стили кнопок перекрасили бы карточку */}
      {cardOpen && user && (
        <IdCard
          user={user}
          profile={profile}
          ack={profileAck}
          error={error}
          onSave={actions.saveProfile}
          onClose={() => setCardOpen(false)}
        />
      )}

      {!splashDone && (
        <Splash
          ready={!!user || status === 'rejected'}
          offline={status === 'offline'}
          onDone={() => setSplashDone(true)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
