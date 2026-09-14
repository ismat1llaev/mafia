import { EventLog, PlayerRow } from '../components.jsx';
import { haptic } from '../tg.js';
import { useT } from '../i18n.js';
import { IconFedora, IconMasks } from '../icons.jsx';

export function GameOver({ state, actions, onLeave }) {
  const { t } = useT();
  const { winner, players, me, isHost } = state;
  const iWon = me?.role ? (winner === 'mafia') === (me.role === 'mafia') : null;

  const mafia = players.filter((p) => p.role === 'mafia');
  const town = players.filter((p) => p.role && p.role !== 'mafia');

  return (
    <div className="screen">
      <div className={`win-banner ${winner}`}>
        <div className="win-ic">
          {winner === 'mafia' ? <IconFedora size={30} /> : <IconMasks size={28} />}
        </div>
        <div className="win-title">
          {t(winner === 'mafia' ? 'over.mafiaWin' : 'over.townWin')}
        </div>
        <div className="win-sub">
          {t(winner === 'mafia' ? 'over.mafiaWinSub' : 'over.townWinSub')}
        </div>
        {iWon !== null && (
          <div className={`win-verdict${iWon ? ' won' : ''}`}>
            {t(iWon ? 'over.youWon' : 'over.youLost')}
          </div>
        )}
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>{t('over.mafiaTeam', { n: mafia.length })}</div>
        <div className="players">
          {mafia.map((p) => <PlayerRow key={p.id} player={p} meId={me?.id} />)}
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>{t('over.townTeam', { n: town.length })}</div>
        <div className="players">
          {town
            .slice()
            .sort((a, b) => (a.role === 'sheriff' ? -1 : b.role === 'sheriff' ? 1 : 0))
            .map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                meId={me?.id}
                subtitle={t(`role.${p.role}`) + (p.alive ? t('over.survived') : '')}
              />
            ))}
        </div>
      </div>

      <EventLog log={state.log} />

      <div className="spacer" />

      <div className="sticky-bottom">
        {isHost ? (
          <button className="btn btn-primary" onClick={() => { haptic('success'); actions.restart(); }}>
            {t('over.again')}
          </button>
        ) : (
          <div className="dim center">{t('over.waitHost')}</div>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>
          {t('over.toMenu')}
        </button>
      </div>
    </div>
  );
}
