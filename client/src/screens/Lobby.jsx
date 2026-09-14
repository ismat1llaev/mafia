import { useState } from 'react';
import { ChannelButton, PlayerRow, RulesCard, Segmented, Stepper } from '../components.jsx';
import { copyText, haptic, shareLink } from '../tg.js';
import { useT } from '../i18n.js';
import { IconBook, IconBot, IconClose, IconCopy, IconGear, IconInvite, IconMinus, IconPlus } from '../icons.jsx';

export function Lobby({ state, config, actions, onLeave }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const { code, isHost, settings, players, canStart, minPlayers } = state;
  const playingCount = settings.hostMode === 'human'
    ? players.filter((p) => p.id !== state.hostId).length
    : players.length;
  const botCount = players.filter((p) => p.isBot).length;

  /** «2 мафии · доктор · 5 мирных» — чтобы состав был виден до начала партии. */
  const compositionText = (c) => {
    if (!c) return null;
    const parts = [t('comp.mafia', c.mafia)];
    if (c.sheriff) parts.push(t('comp.sheriff'));
    if (c.doctor) parts.push(t('comp.doctor'));
    parts.push(t('comp.civil', c.civilian));
    return parts.join(' · ');
  };

  const secLabel = (v) => {
    if (v >= 60 && v % 60 === 0) return t('common.min', v / 60);
    if (v > 60) return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
    return t('common.sec', v);
  };

  const inviteUrl = config?.botUsername && config?.appShortName
    ? `https://t.me/${config.botUsername}/${config.appShortName}?startapp=${code}`
    : config?.botUsername
      ? `https://t.me/${config.botUsername}?start=room_${code}`
      : `${window.location.origin}/?code=${code}`;

  const copy = async () => {
    await copyText(code);
    haptic('success');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const patch = (p) => actions.settings(p);
  const yesNo = [{ value: 'yes', label: t('common.yes') }, { value: 'no', label: t('common.no') }];
  const onOff = [{ value: 'yes', label: t('set.on') }, { value: 'no', label: t('set.off') }];

  return (
    <div className="screen">
      <div className="lobby-head">
        <div className="lobby-code">
          <div className="label">{t('lobby.code')}</div>
          <div className="room-code">{code}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={copy}>
          <IconCopy size={15} />
          {copied ? t('lobby.copied') : t('lobby.copy')}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onLeave}>{t('common.leave')}</button>
      </div>

      <button
        className="btn"
        onClick={() => {
          haptic('light');
          shareLink(inviteUrl, t('lobby.inviteText', { code }));
        }}
      >
        <IconInvite size={18} />
        {t('lobby.invite')}
      </button>

      <div>
        <div className="topbar" style={{ marginBottom: 10 }}>
          <h2>{t('lobby.players')}</h2>
          <span className="pill">
            {t('common.players', playingCount)} {t('lobby.of', { max: settings.maxPlayers })}
          </span>
        </div>

        {state.composition && (
          <div className="dim" style={{ marginBottom: 10 }}>
            {t('lobby.composition', {
              players: t('common.playersShort', Math.max(playingCount, minPlayers)),
              roles: compositionText(state.composition),
            })}
          </div>
        )}

        <div className="players">
          {players.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              meId={state.me?.id}
              subtitle={
                !p.connected ? t('lobby.offline')
                : p.isSpectatingHost ? t('lobby.hostNoRole')
                : p.isHost ? t('lobby.creator')
                : t('common.ready')
              }
              right={
                isHost && p.id !== state.hostId ? (
                  <button
                    className="btn btn-ghost btn-icon"
                    aria-label={t('lobby.kick')}
                    onClick={(e) => { e.stopPropagation(); haptic('warning'); actions.kick(p.id); }}
                  >
                    <IconClose size={14} />
                  </button>
                ) : null
              }
            />
          ))}
          {Array.from({ length: Math.max(0, minPlayers - playingCount) }).map((_, i) => (
            <div key={`empty-${i}`} className="player empty">
              <div className="avatar">?</div>
              <div className="player-main">
                <div className="player-name dim">{t('lobby.waitingPlayer')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isHost && (
        <div className="card bots-card">
          <div className="topbar" style={{ marginBottom: 8 }}>
            <div className="setting-label"><IconBot size={17} />{t('bots.title')}</div>
            <span className="pill">
              {botCount > 0 ? t('bots.count', botCount) : t('bots.none')}
            </span>
          </div>
          <div className="dim" style={{ marginBottom: 12 }}>{t('bots.hint')}</div>
          <div className="row">
            <button
              className="btn btn-sm"
              style={{ width: '100%' }}
              disabled={playingCount >= settings.maxPlayers}
              onClick={() => { haptic('light'); actions.addBot(); }}
            >
              <IconPlus size={15} />
              {t('bots.add')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%' }}
              disabled={botCount === 0}
              onClick={() => { haptic('light'); actions.removeBot(); }}
            >
              <IconMinus size={15} />
              {t('bots.remove')}
            </button>
          </div>
        </div>
      )}

      {isHost && (
        <>
          <button className="btn btn-ghost" onClick={() => setShowSettings((v) => !v)}>
            <IconGear size={18} />
            {showSettings ? t('lobby.hideSettings') : t('lobby.settings')}
          </button>

          {showSettings && (
            <div className="card">
              <div className="setting">
                <div>
                  <div className="setting-label">{t('set.host')}</div>
                  <div className="dim">
                    {settings.hostMode === 'bot' ? t('set.hostBot') : t('set.hostHuman')}
                  </div>
                </div>
                <Segmented
                  value={settings.hostMode}
                  onChange={(v) => patch({ hostMode: v })}
                  options={[{ value: 'bot', label: t('set.bot') }, { value: 'human', label: t('set.me') }]}
                />
              </div>

              <div className="setting">
                <div>
                  <div className="setting-label">{t('set.public')}</div>
                  <div className="dim">
                    {settings.isPublic ? t('set.publicOn') : t('set.publicOff')}
                  </div>
                </div>
                <Segmented
                  value={settings.isPublic ? 'yes' : 'no'}
                  onChange={(v) => patch({ isPublic: v === 'yes' })}
                  options={yesNo}
                />
              </div>

              <div className="setting">
                <div>
                  <div className="setting-label">{t('set.doctor')}</div>
                  <div className="dim">{t('set.doctorHint')}</div>
                </div>
                <Segmented
                  value={settings.useDoctor ? 'yes' : 'no'}
                  onChange={(v) => patch({ useDoctor: v === 'yes' })}
                  options={onOff}
                />
              </div>

              <div className="setting">
                <div>
                  <div className="setting-label">{t('set.sheriff')}</div>
                  <div className="dim">{t('set.sheriffHint')}</div>
                </div>
                <Segmented
                  value={settings.useSheriff ? 'yes' : 'no'}
                  onChange={(v) => patch({ useSheriff: v === 'yes' })}
                  options={onOff}
                />
              </div>

              <div className="setting">
                <div className="setting-label">{t('set.maxPlayers')}</div>
                <Stepper
                  value={settings.maxPlayers}
                  min={minPlayers}
                  max={state.maxPlayersHard}
                  onChange={(v) => patch({ maxPlayers: v })}
                />
              </div>

              <div className="setting">
                <div>
                  <div className="setting-label">{t('set.tie')}</div>
                  <div className="dim">
                    {settings.tieRule === 'revote' && t('set.tieRevote')}
                    {settings.tieRule === 'nobody' && t('set.tieNobody')}
                    {settings.tieRule === 'random' && t('set.tieRandom')}
                  </div>
                </div>
                <Segmented
                  value={settings.tieRule}
                  onChange={(v) => patch({ tieRule: v })}
                  options={[
                    { value: 'revote', label: t('set.tieRevoteShort') },
                    { value: 'nobody', label: t('set.tieNobodyShort') },
                    { value: 'random', label: t('set.tieRandomShort') },
                  ]}
                />
              </div>

              {settings.hostMode === 'bot' && (
                <>
                  <div className="setting">
                    <div className="setting-label">{t('set.night')}</div>
                    <Stepper value={settings.nightSec} min={15} max={180} step={15} format={secLabel} onChange={(v) => patch({ nightSec: v })} />
                  </div>
                  <div className="setting">
                    <div className="setting-label">{t('set.discussion')}</div>
                    <Stepper value={settings.discussionSec} min={30} max={600} step={30} format={secLabel} onChange={(v) => patch({ discussionSec: v })} />
                  </div>
                  <div className="setting">
                    <div className="setting-label">{t('set.voting')}</div>
                    <Stepper value={settings.voteSec} min={15} max={180} step={15} format={secLabel} onChange={(v) => patch({ voteSec: v })} />
                  </div>
                </>
              )}

              <div className="setting">
                <div>
                  <div className="setting-label">{t('set.reveal')}</div>
                  <div className="dim">{t('set.revealHint')}</div>
                </div>
                <Segmented
                  value={settings.revealRoleOnDeath ? 'yes' : 'no'}
                  onChange={(v) => patch({ revealRoleOnDeath: v === 'yes' })}
                  options={yesNo}
                />
              </div>
            </div>
          )}
        </>
      )}

      <div className="row">
        <button className="btn btn-ghost" onClick={() => { haptic('light'); setShowRules((v) => !v); }}>
          <IconBook size={18} />
          {showRules ? t('common.hideRules') : t('common.rules')}
        </button>
        <ChannelButton url={config?.channelUrl} />
      </div>

      {showRules && <RulesCard />}

      <div className="spacer" />

      {/* В закреплённой полосе только само действие: всё остальное остаётся
          в потоке, иначе полоса накрывает список игроков. */}
      <div className="sticky-bottom">
        {isHost ? (
          <>
            <button
              className="btn btn-primary"
              disabled={!canStart.ok}
              onClick={() => { haptic('success'); actions.start(); }}
            >
              {t('lobby.start')}
            </button>
            {!canStart.ok && (
              <div className="dim center">{t(`err.${canStart.code}`, canStart.params)}</div>
            )}
          </>
        ) : (
          <div className="dim center">{t('lobby.waitHost')}</div>
        )}
      </div>
    </div>
  );
}
