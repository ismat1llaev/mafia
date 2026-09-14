import { useEffect, useRef, useState } from 'react';
import { Chat, EventLog } from '../components.jsx';
import { Seats, ViewSwitch, loadView, saveView } from '../table.jsx';
import { PHASE_ICON, roleOf } from '../roles.js';
import { haptic } from '../tg.js';
import { useT } from '../i18n.js';
import {
  IconCheck,
  IconCrosshair,
  IconFedora,
  IconGrave,
  IconPulse,
  IconShieldPlus,
  IconSunrise,
} from '../icons.jsx';

/**
 * Игровой экран.
 *
 * Все фазы показывают один и тот же круг мест — меняется только то, что на
 * местах отмечено и кого можно выбрать. Это описано в `seatPlan`: одна
 * функция на всю игру вместо отдельного списка игроков в каждой фазе.
 * Ниже стола идёт то, что к столу не сводится: чат, журнал, кнопки.
 */
export function Game({ state, actions, onLeave, skew }) {
  const { t } = useT();
  const { phase, me, players, isHost, settings } = state;

  const seats = players.filter((p) => !p.isSpectatingHost);
  const alive = seats.filter((p) => p.alive);
  const iAmSpectator = me?.isSpectatingHost || !me?.alive;
  const humanHosted = settings.hostMode === 'human';

  const [view, setView] = useState(loadView);
  const changeView = (next) => { saveView(next); setView(next); };

  // Лёгкая вибрация на смене фазы, чтобы не пропустить ход
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current !== phase) {
      haptic(phase === 'night' ? 'medium' : 'light');
      prevPhase.current = phase;
    }
  }, [phase]);

  const subtitle = () => {
    switch (phase) {
      case 'roles': return t('game.rememberRole');
      case 'night':
        if (me?.isSpectatingHost) return t('game.wakeMafia');
        if (!me?.alive) return t('game.cityAsleep');
        if (me.role === 'mafia') return t('game.pickVictim');
        if (me.role === 'sheriff') return t('game.pickCheck');
        if (me.role === 'doctor') return t('game.pickHeal');
        return t('game.youSleep');
      case 'day': return t('game.cityWakes');
      case 'discussion': return humanHosted ? t('game.discussFree') : t('game.discussTimed');
      case 'voting': return t('game.votedOf', { done: state.votedCount, total: state.voterTotal });
      case 'revote': return t('game.revoteSub');
      case 'verdict': return t('game.verdictSub');
      default: return null;
    }
  };

  const head = {
    Icon: PHASE_ICON[phase] || null,
    title: t(`phase.${phase}`),
    subtitle: subtitle(),
    endsAt: state.phaseEndsAt,
    startedAt: state.phaseStartedAt,
    skew,
  };

  return (
    <div className="screen">
      <div className="topbar">
        <span className="pill">
          {phase === 'night'
            ? t('game.nightN', { n: state.dayNumber })
            : t('game.dayN', { n: state.dayNumber })}
        </span>
        <span className="pill">
          <IconPulse size={15} />
          {t('common.alive', alive.length)}
        </span>
        <span className="spacer" />
        <ViewSwitch view={view} onChange={changeView} />
        <button className="btn btn-ghost btn-sm" onClick={onLeave}>{t('common.leave')}</button>
      </div>

      {phase === 'roles' && <RoleCard state={state} />}
      {(phase === 'day' || phase === 'verdict') && <Announce state={state} />}
      {phase === 'revote' && <div className="banner info">{t('game.revoteNote')}</div>}

      <Seats
        view={view}
        players={seats}
        meId={me?.id}
        head={head}
        {...seatPlan(state, actions, t)}
      />

      {phase === 'roles' && <RolesExtras state={state} />}
      {phase === 'night' && <NightExtras state={state} actions={actions} />}
      {phase === 'discussion' && <DiscussionExtras state={state} actions={actions} alive={alive} />}
      {(phase === 'voting' || phase === 'revote') && <VotingExtras state={state} actions={actions} />}

      {humanHosted && isHost && phase !== 'ended' && (
        <div className="sticky-bottom">
          <button className="btn btn-primary" onClick={() => { haptic('medium'); actions.hostNext(); }}>
            {t(`next.${phase}`) === `next.${phase}` ? t('next.default') : t(`next.${phase}`)}
          </button>
        </div>
      )}

      {iAmSpectator && phase !== 'roles' && (
        <div className="banner info">
          {me?.isSpectatingHost ? t('game.hostView') : t('game.spectator')}
        </div>
      )}
    </div>
  );
}

/**
 * Что показывать на местах в текущей фазе.
 *
 * Возвращает то, что понимает `Seats`: выбранное место, обработчик выбора,
 * правило «кого вообще можно выбрать» и оформление каждого места.
 */
function seatPlan(state, actions, t) {
  const { phase, me } = state;
  const spectator = !!me?.isSpectatingHost;
  const nothing = {};

  // Подельника отличаем от выбранной жертвы значком: кольцо у обоих красное
  const mafiaMate = (p) => ({
    tone: 'mafia',
    mark: p.id === me?.id ? null : <IconFedora size={12} />,
    note: p.id === me?.id ? undefined : t('roleLower.mafia'),
  });

  if (phase === 'roles') {
    if (spectator) {
      return { info: (p) => (p.role ? { tone: roleTone(p.role), note: t(`role.${p.role}`) } : nothing) };
    }
    if (me?.role === 'mafia') {
      return { info: (p) => (p.role === 'mafia' ? mafiaMate(p) : nothing) };
    }
    return {};
  }

  if (phase === 'night') {
    if (spectator) {
      return {
        info: (p) => ({
          tone: state.doctorTarget === p.id ? 'doctor' : undefined,
          mark: p.mafiaTargeted > 0
            ? <><IconCrosshair size={11} />{p.mafiaTargeted}</>
            : state.doctorTarget === p.id ? <IconShieldPlus size={12} /> : null,
          note: state.doctorTarget === p.id ? t('game.beingHealed') : undefined,
        }),
      };
    }

    if (!me?.alive) return {};

    if (me.role === 'mafia') {
      return {
        selectedId: state.myNightTarget,
        onSelect: (id) => actions.nightAction(id),
        canSelect: (p) => p.alive && p.role !== 'mafia',
        info: (p) => (p.role === 'mafia' ? mafiaMate(p) : {
          mark: p.mafiaTargeted > 0 ? <><IconCrosshair size={11} />{p.mafiaTargeted}</> : null,
          note: state.myNightTarget === p.id ? t('game.yourTarget') : undefined,
        }),
      };
    }

    if (me.role === 'sheriff') {
      return {
        selectedId: state.myNightTarget,
        onSelect: (id) => actions.nightAction(id),
        canSelect: (p) => p.alive && p.id !== me.id && !state.myNightTarget,
        info: (p) => (p.sheriffResult ? {
          tone: p.sheriffResult === 'mafia' ? 'mafia' : 'good',
          mark: p.sheriffResult === 'mafia' ? '🔴' : '🟢',
          note: t(p.sheriffResult === 'mafia' ? 'game.checkedMafia' : 'game.checkedClean'),
        } : nothing),
      };
    }

    if (me.role === 'doctor') {
      return {
        selectedId: state.myNightTarget,
        onSelect: (id) => actions.nightAction(id),
        canSelect: (p) => p.alive && p.id !== state.lastHealed,
        info: (p) => {
          if (p.id === state.lastHealed) return { note: t('game.healedYesterday') };
          if (state.myNightTarget === p.id) return { tone: 'doctor', mark: <IconShieldPlus size={12} />, note: t('game.healing') };
          return nothing;
        },
      };
    }

    return {};
  }

  if (phase === 'day' || phase === 'verdict') {
    const victimId = phase === 'day' ? state.lastNightVictim : state.lastExecuted;
    return {
      info: (p) => {
        if (p.id === victimId) return { tone: 'mafia', mark: <IconGrave size={12} /> };
        if (phase === 'day' && state.savedByDoctor === p.id) return { tone: 'doctor', mark: <IconShieldPlus size={12} /> };
        return nothing;
      },
    };
  }

  if (phase === 'discussion') {
    return {
      info: (p) => (p.ready ? { tone: 'good', mark: <IconCheck size={12} />, note: t('common.ready') } : nothing),
    };
  }

  if (phase === 'voting' || phase === 'revote') {
    const isCandidate = phase === 'revote' && state.revoteCandidates?.includes(me?.id);
    const canVote = me?.alive && !spectator && !isCandidate;
    const votable = (p) => (phase === 'revote'
      ? state.revoteCandidates?.includes(p.id)
      : p.alive && p.id !== me?.id);

    return {
      selectedId: state.myVote,
      onSelect: (id) => actions.vote(id),
      canSelect: (p) => canVote && votable(p),
      info: (p) => ({
        mark: p.voteCount > 0 ? String(p.voteCount) : null,
        note: state.myVote === p.id ? t('game.yourVote') : undefined,
      }),
    };
  }

  return {};
}

function roleTone(role) {
  return role === 'civilian' ? 'civil' : role;
}

function RoleCard({ state }) {
  const { t } = useT();
  const info = roleOf(state.me?.isSpectatingHost ? 'host' : state.me?.role);
  return (
    <div className={`role-card ${info.className}`}>
      <div className="role-emoji"><info.Icon size={32} /></div>
      <div className="role-name">{t(`role.${info.key}`)}</div>
      <div className="role-desc">{t(`role.${info.key}.desc`)}</div>
    </div>
  );
}

function RolesExtras({ state }) {
  const { t } = useT();
  const { me, players } = state;
  if (me?.role !== 'mafia') return null;
  const partners = players.filter((p) => p.role === 'mafia' && p.id !== me.id);
  if (partners.length > 0) return <div className="banner">{t('game.partnersMarked')}</div>;
  return <div className="banner">{t('game.aloneMafia')}</div>;
}

function NightExtras({ state, actions }) {
  const { t } = useT();
  const { me } = state;

  if (me?.isSpectatingHost) return <EventLog log={state.log} />;

  if (!me?.alive) return <div className="card center muted">{t('game.watching')}</div>;

  if (me.role === 'mafia') {
    return (
      <>
        <div className="dim center">{t('game.mafiaTie')}</div>
        <Chat
          messages={state.chat.mafia}
          variant="mafia"
          placeholder={t('game.mafiaChat')}
          onSend={actions.chat}
        />
      </>
    );
  }

  if (me.role === 'sheriff') {
    const checked = state.players.filter((p) => p.sheriffResult);
    return (
      <>
        {state.myNightTarget && <div className="banner info">{t('game.checkSent')}</div>}
        {checked.length > 0 && (
          <div className="card">
            <div className="muted" style={{ marginBottom: 8 }}>{t('game.yourChecks')}</div>
            {checked.map((p) => (
              <div key={p.id} className="chat-msg" style={{ padding: '3px 0' }}>
                {p.sheriffResult === 'mafia' ? '🔴' : '🟢'} <b>{p.name}</b>
                {' — '}{p.sheriffResult === 'mafia' ? t('game.isMafia') : t('game.notMafia')}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  if (me.role === 'doctor') {
    return (
      <>
        <div className="dim center">{t('game.healRule')}</div>
        {state.myNightTarget && <div className="banner info">{t('game.healOn')}</div>}
      </>
    );
  }

  return <div className="card center muted">{t('game.youSleepNote')}</div>;
}

function Announce({ state }) {
  const { t } = useT();
  const { players, phase } = state;
  const victimId = phase === 'day' ? state.lastNightVictim : state.lastExecuted;
  const victim = players.find((p) => p.id === victimId);

  const saved = phase === 'day' && state.savedByDoctor
    ? players.find((p) => p.id === state.savedByDoctor)
    : null;

  return (
    <>
      {saved && (
        <div className="banner info">
          {saved.id === state.me?.id
            ? t('game.savedYou')
            : t('game.savedName', { name: saved.name })}
        </div>
      )}
      <div className="card center">
        {victim ? (
          <>
            <div className="announce-ic mafia"><IconGrave size={28} /></div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{victim.name}</div>
            <div className="muted">
              {phase === 'day' ? t('game.killedTonight') : t('game.executedByCity')}
            </div>
            {victim.role && state.settings.revealRoleOnDeath && (
              <div className={`badge ${roleOf(victim.role).badge}`} style={{ marginTop: 10, display: 'inline-block' }}>
                {t(`role.${victim.role}`)}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="announce-ic good"><IconSunrise size={28} /></div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {phase === 'day' ? t('game.allSurvived') : t('game.nobodyExecuted')}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function DiscussionExtras({ state, actions, alive }) {
  const { t } = useT();
  const { me, players } = state;
  const readyCount = alive.filter((p) => p.ready).length;
  const iAmReady = players.find((p) => p.id === me?.id)?.ready;
  const canBeReady = me?.alive && !me?.isSpectatingHost && state.settings.hostMode === 'bot';

  return (
    <>
      <Chat
        messages={state.chat.day}
        placeholder={me?.alive ? t('game.yourTheory') : t('game.deadSilent')}
        disabled={!me?.alive}
        onSend={actions.chat}
      />

      {canBeReady && (
        <button
          className={iAmReady ? 'btn btn-ghost' : 'btn'}
          onClick={() => { haptic('light'); actions.ready(!iAmReady); }}
        >
          {t(iAmReady ? 'game.youReady' : 'game.readyToVote', { done: readyCount, total: alive.length })}
        </button>
      )}

      <EventLog log={state.log} />
    </>
  );
}

function VotingExtras({ state, actions }) {
  const { t } = useT();
  const { me, phase, revoteCandidates, myVote } = state;
  const isCandidate = phase === 'revote' && revoteCandidates?.includes(me?.id);
  const canVote = me?.alive && !me?.isSpectatingHost && !isCandidate;

  return (
    <>
      {canVote && (
        <button
          className={myVote === null ? 'btn' : 'btn btn-ghost'}
          onClick={() => { haptic('light'); actions.vote(null); }}
        >
          {myVote === null ? t('game.abstained') : t('game.abstain')}
        </button>
      )}

      {isCandidate && <div className="banner">{t('game.candidateNote')}</div>}
    </>
  );
}
