import { haptic } from '../tg.js';
import { useT } from '../i18n.js';
import { IconDoor, IconGlass, IconShieldPlus } from '../icons.jsx';

/** Одна открытая комната в списке. */
function RoomCard({ room, onJoin }) {
  const { t } = useT();
  return (
    <button className="player selectable" onClick={() => { haptic('medium'); onJoin(room.code); }}>
      <div className="avatar room-count">
        {room.players}/{room.maxPlayers}
      </div>
      <div className="player-main">
        <div className="player-name">
          {t('home.room', { code: room.code })}
          {room.useDoctor && (
            <span className="badge badge-doctor badge-icon" title={t('role.doctor')}>
              <IconShieldPlus size={13} />
            </span>
          )}
          {room.useSheriff && (
            <span className="badge badge-sheriff badge-icon" title={t('role.sheriff')}>
              <IconGlass size={13} />
            </span>
          )}
        </div>
        <div className="player-sub">
          {room.needed > 0 ? t('home.needMore', room.needed) : t('home.canStart')}
          {room.hostName ? ` · ${room.hostName}` : ''}
        </div>
      </div>
      <span className="badge badge-civil">{t('common.enter')}</span>
    </button>
  );
}

/**
 * Экран со списком свободных комнат.
 *
 * Открывается кнопкой с главной, чтобы там не висел пустой блок,
 * когда играть пока некому.
 */
export function Rooms({ rooms, onJoin, onCreate, onBack }) {
  const { t } = useT();
  const list = rooms || [];

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => { haptic('light'); onBack(); }}>
          ← {t('common.back')}
        </button>
        {list.length > 0 && <span className="pill">{t('common.rooms', list.length)}</span>}
      </div>

      <div className="phase-head" style={{ paddingTop: 4 }}>
        <div className="brand-mark small"><IconDoor size={26} /></div>
        <div className="phase-title">{t('rooms.title')}</div>
        <div className="muted center">{t('rooms.hint')}</div>
      </div>

      {list.length > 0 ? (
        <div className="players">
          {list.map((r) => <RoomCard key={r.code} room={r} onJoin={onJoin} />)}
        </div>
      ) : (
        <div className="card center muted">
          {t('home.noRooms')}<br />
          <span className="dim">{t('home.noRoomsHint')}</span>
        </div>
      )}

      <div className="spacer" />

      <div className="sticky-bottom">
        <button className="btn btn-primary" onClick={() => { haptic('medium'); onCreate(); }}>
          {t('rooms.createOwn')}
        </button>
      </div>
    </div>
  );
}
