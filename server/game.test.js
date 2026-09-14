/**
 * Тесты игрового движка.
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, PHASE, ROLE, MIN_PLAYERS, MAX_PLAYERS,
  roleComposition, mafiaCountFor, sanitizeSettings, DEFAULT_SETTINGS,
} from './game.js';

/** Детерминированный генератор, чтобы тесты не «мигали». */
function seeded(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeGame(n, settings = {}, seed = 42) {
  // По умолчанию снимаем ограничение мест, иначе лишние игроки молча не войдут
  const game = new Game({
    code: 'TEST1',
    hostId: 1,
    settings: { maxPlayers: MAX_PLAYERS, ...settings },
    rng: seeded(seed),
  });
  for (let i = 1; i <= n; i++) {
    game.addPlayer({ id: i, name: `Игрок ${i}`, username: null, photo: null });
  }
  return game;
}

// ─────────────────────────── состав ролей ───────────────────────────

test('состав ролей соответствует правилам', () => {
  assert.equal(mafiaCountFor(5), 1);
  assert.equal(mafiaCountFor(6), 2);
  assert.equal(mafiaCountFor(8), 2, 'на 8 игроков должно быть 2 мафии — как в правилах');
  assert.equal(mafiaCountFor(9), 3);
  assert.equal(mafiaCountFor(12), 4);

  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const c = roleComposition(n);
    assert.equal(c.mafia + c.sheriff + c.doctor + c.civilian, n, `сумма ролей для ${n} игроков`);
    assert.ok(c.civilian >= 1, `для ${n} игроков должен остаться хотя бы один мирный`);
    assert.ok(c.mafia < n - c.mafia, `для ${n} игроков мафия не должна стартовать с победой`);
  }
});

test('по умолчанию в игре доктор, а комиссар — по желанию', () => {
  assert.deepEqual(roleComposition(8), { mafia: 2, sheriff: 0, doctor: 1, civilian: 5 });
  assert.deepEqual(roleComposition(8, { useSheriff: true }), { mafia: 2, sheriff: 1, doctor: 1, civilian: 4 });
  assert.deepEqual(roleComposition(8, { useDoctor: false, useSheriff: true }), { mafia: 2, sheriff: 1, doctor: 0, civilian: 5 });
  assert.deepEqual(roleComposition(8, { useDoctor: false, useSheriff: false }), { mafia: 2, sheriff: 0, doctor: 0, civilian: 6 });
});

test('особые роли не съедают весь город', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const c = roleComposition(n, { useSheriff: true, useDoctor: true });
    assert.equal(c.mafia + c.sheriff + c.doctor + c.civilian, n, `сумма ролей для ${n}`);
    assert.ok(c.civilian >= 1, `для ${n} игроков не осталось мирных`);
    assert.ok(c.mafia < n - c.mafia, `для ${n} игроков мафия стартует с победой`);
  }
});

test('роли раздаются ровно по составу', () => {
  const game = makeGame(8, { useSheriff: true, useDoctor: true });
  game.start(1);
  const roles = game.players.map((p) => p.role);
  assert.equal(roles.filter((r) => r === ROLE.MAFIA).length, 2);
  assert.equal(roles.filter((r) => r === ROLE.SHERIFF).length, 1);
  assert.equal(roles.filter((r) => r === ROLE.DOCTOR).length, 1);
  assert.equal(roles.filter((r) => r === ROLE.CIVILIAN).length, 4);
});

test('выключенные роли не появляются в раздаче', () => {
  const game = makeGame(8, { useSheriff: false, useDoctor: false });
  game.start(1);
  const roles = game.players.map((p) => p.role);
  assert.equal(roles.filter((r) => r === ROLE.SHERIFF).length, 0);
  assert.equal(roles.filter((r) => r === ROLE.DOCTOR).length, 0);
});

// ─────────────────────────── доктор ───────────────────────────

/** Ставит игру в ночь и возвращает ключевых участников. */
function nightWithDoctor(seed = 42) {
  const game = makeGame(8, { useDoctor: true, useSheriff: true }, seed);
  game.start(1);
  game.advance(); // roles -> night
  return {
    game,
    doctor: game.players.find((p) => p.role === ROLE.DOCTOR),
    mafia: game.players.filter((p) => p.role === ROLE.MAFIA),
    civilians: game.players.filter((p) => p.role === ROLE.CIVILIAN),
  };
}

test('доктор спасает того, за кем пришла мафия', () => {
  const { game, doctor, mafia, civilians } = nightWithDoctor();
  const target = civilians[0];

  for (const m of mafia) game.submitNightAction(m.id, target.id);
  game.submitNightAction(doctor.id, target.id);
  game.advance();

  assert.equal(game.player(target.id).alive, true, 'доктор не спас');
  assert.equal(game.lastNightVictim, null);
  assert.equal(game.savedByDoctor, target.id);
});

test('лечение мимо цели никого не спасает', () => {
  const { game, doctor, mafia, civilians } = nightWithDoctor();
  const target = civilians[0];
  const other = civilians[1];

  for (const m of mafia) game.submitNightAction(m.id, target.id);
  game.submitNightAction(doctor.id, other.id);
  game.advance();

  assert.equal(game.player(target.id).alive, false);
  assert.equal(game.savedByDoctor, null);
});

test('спасение не видно городу по объявлению', () => {
  const { game, doctor, mafia, civilians } = nightWithDoctor();
  const target = civilians[0];

  for (const m of mafia) game.submitNightAction(m.id, target.id);
  game.submitNightAction(doctor.id, target.id);
  game.advance();

  // Формулировка та же, что и когда мафия просто не стреляла
  const last = game.log[game.log.length - 1];
  assert.equal(last.code, 'nobody_died', 'в журнале должна быть нейтральная запись');
  assert.equal(JSON.stringify(last.params ?? null).includes('doctor'), false,
    'журнал выдаёт наличие доктора');

  const civView = game.viewFor(civilians[1].id);
  assert.equal(civView.savedByDoctor, null, 'мирный не должен знать про спасение');
  assert.equal(game.viewFor(doctor.id).savedByDoctor, target.id, 'доктор должен знать');
});

test('нельзя лечить одного и того же две ночи подряд', () => {
  const { game, doctor, civilians } = nightWithDoctor();
  const target = civilians[0];

  assert.equal(game.submitNightAction(doctor.id, target.id).ok, true);
  game.advance(); // night -> day
  game.advance(); // day -> discussion
  game.advance(); // discussion -> voting
  game.advance(); // voting -> verdict
  game.advance(); // verdict -> night

  assert.equal(game.phase, PHASE.NIGHT);
  const again = game.submitNightAction(doctor.id, target.id);
  assert.equal(again.ok, false);
  assert.equal(again.code, 'no_heal_twice');

  // а другого — можно
  assert.equal(game.submitNightAction(doctor.id, civilians[1].id).ok, true);
  // и через ночь прежнего снова можно
  assert.equal(game.viewFor(doctor.id).lastHealed, target.id);
});

test('доктор может лечить себя', () => {
  const { game, doctor, mafia } = nightWithDoctor();
  for (const m of mafia) game.submitNightAction(m.id, doctor.id);
  assert.equal(game.submitNightAction(doctor.id, doctor.id).ok, true);
  game.advance();
  assert.equal(game.player(doctor.id).alive, true);
});

test('ночь не заканчивается, пока доктор не сходил', () => {
  const { game, doctor, mafia } = nightWithDoctor();
  const targets = game.alive.filter((p) => p.role !== ROLE.MAFIA);
  for (const m of mafia) game.submitNightAction(m.id, targets[0].id);
  const sheriff = game.alive.find((p) => p.role === ROLE.SHERIFF);
  game.submitNightAction(sheriff.id, targets[0].id);

  assert.equal(game.everyoneDone(), false, 'ждём хода доктора');
  game.submitNightAction(doctor.id, targets[1].id);
  assert.equal(game.everyoneDone(), true);
});

test('мёртвый доктор больше не лечит', () => {
  const { game, doctor, mafia, civilians } = nightWithDoctor();
  for (const m of mafia) game.submitNightAction(m.id, doctor.id);
  game.advance();
  assert.equal(game.player(doctor.id).alive, false);

  const res = game.submitNightAction(doctor.id, civilians[0].id);
  assert.equal(res.ok, false);
});

// ─────────────────────────── лобби ───────────────────────────

test('нельзя начать игру вчетвером', () => {
  const game = makeGame(4);
  const res = game.start(1);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'min_players');
  assert.deepEqual(res.params, { min: 5, now: 4 });
});

test('начать игру может только создатель комнаты', () => {
  const game = makeGame(6);
  const res = game.start(3);
  assert.equal(res.ok, false);
});

test('комната не пускает сверх лимита', () => {
  const game = makeGame(6, { maxPlayers: 6 });
  const res = game.addPlayer({ id: 99, name: 'Лишний' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'room_full');
});

test('в идущую игру зайти нельзя, а вернуться — можно', () => {
  const game = makeGame(6);
  game.start(1);
  assert.equal(game.addPlayer({ id: 42, name: 'Опоздавший' }).ok, false);

  game.setConnected(3, false);
  const back = game.addPlayer({ id: 3, name: 'Игрок 3' });
  assert.equal(back.ok, true);
  assert.equal(back.rejoined, true);
  assert.equal(game.player(3).connected, true);
});

// ─────────────────────────── настройки ───────────────────────────

test('фильтр настроек пропускает все существующие настройки', () => {
  // Каждый ключ из DEFAULT_SETTINGS обязан доходить до игры. Раньше список
  // разрешённых был записан руками, и переключатели ролей молча не работали.
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const passed = sanitizeSettings({ [key]: DEFAULT_SETTINGS[key] });
    assert.ok(key in passed, `настройка ${key} теряется по дороге к серверу`);
  }
});

test('фильтр настроек отбрасывает чужие поля', () => {
  const out = sanitizeSettings({ useDoctor: false, hostId: 999, __proto__: { evil: 1 }, nope: 'x' });
  assert.deepEqual(out, { useDoctor: false });
});

test('переключатели ролей доходят до игры и меняют раздачу', () => {
  const game = makeGame(8);

  assert.equal(game.updateSettings(1, sanitizeSettings({ useSheriff: true })).ok, true);
  assert.equal(game.settings.useSheriff, true, 'комиссар не включился');

  assert.equal(game.updateSettings(1, sanitizeSettings({ useDoctor: false })).ok, true);
  assert.equal(game.settings.useDoctor, false, 'доктор не выключился');

  game.start(1);
  const roles = game.players.map((p) => p.role);
  assert.equal(roles.filter((r) => r === ROLE.SHERIFF).length, 1);
  assert.equal(roles.filter((r) => r === ROLE.DOCTOR).length, 0);
});

test('настройки меняет только создатель комнаты', () => {
  const game = makeGame(8);
  assert.equal(game.updateSettings(3, { useSheriff: true }).ok, false);
  assert.equal(game.settings.useSheriff, DEFAULT_SETTINGS.useSheriff);
});

test('комнату можно закрыть от посторонних', () => {
  const game = makeGame(6);
  assert.equal(game.settings.isPublic, true, 'по умолчанию комната открыта');

  assert.equal(game.updateSettings(1, sanitizeSettings({ isPublic: false })).ok, true);
  assert.equal(game.settings.isPublic, false);

  // Настройка доезжает до игроков — иначе в интерфейсе переключатель «залипнет»
  assert.equal(game.viewFor(2).settings.isPublic, false);
});

// ─────────────────────── обрыв связи в лобби ───────────────────────

test('короткий обрыв связи не выбрасывает из лобби', () => {
  const game = makeGame(6);
  const t0 = 1_000_000;
  const GRACE = 3 * 60 * 1000;

  game.setConnected(3, false, t0);
  assert.equal(game.player(3).connected, false);

  // Экран погас на полминуты — место должно остаться за игроком
  assert.deepEqual(game.dropStale(t0 + 30_000, GRACE), []);
  assert.ok(game.player(3), 'игрок пропал из лобби после короткого обрыва');
  assert.equal(game.players.length, 6);

  // Вернулся — снова в строю
  game.setConnected(3, true, t0 + 40_000);
  assert.equal(game.player(3).connected, true);
  assert.equal(game.player(3).disconnectedAt, null);
  assert.deepEqual(game.dropStale(t0 + 10 * 60 * 1000, GRACE), []);
});

test('кто не вернулся за отведённое время — освобождает место', () => {
  const game = makeGame(6);
  const t0 = 1_000_000;
  const GRACE = 3 * 60 * 1000;

  game.setConnected(4, false, t0);
  const dropped = game.dropStale(t0 + GRACE + 1000, GRACE);

  assert.deepEqual(dropped, [4]);
  assert.equal(game.player(4), null);
  assert.equal(game.players.length, 5);
});

test('в идущей игре место сохраняется, сколько бы ни длился обрыв', () => {
  const game = makeGame(6);
  game.start(1);
  game.setConnected(3, false, 1000);

  assert.deepEqual(game.dropStale(1000 + 60 * 60 * 1000, 60_000), []);
  assert.ok(game.player(3), 'из идущей партии выбрасывать нельзя');
  assert.equal(game.player(3).alive, true);
});

test('возвращение в комнату восстанавливает игрока', () => {
  const game = makeGame(6);
  game.setConnected(2, false, 1000);

  const back = game.addPlayer({ id: 2, name: 'Игрок 2' });
  assert.equal(back.ok, true);
  assert.equal(back.rejoined, true);
  assert.equal(game.player(2).connected, true);
  assert.equal(game.player(2).disconnectedAt, null);
  assert.equal(game.players.length, 6, 'дубликат игрока не создался');
});

test('если ушёл создатель комнаты, права переходят другому', () => {
  const game = makeGame(6);
  const GRACE = 60_000;
  game.setConnected(1, false, 1000);
  game.dropStale(1000 + GRACE + 1, GRACE);

  assert.equal(game.player(1), null);
  assert.equal(game.hostId, 2, 'комната осталась без ведущего');
  assert.equal(game.viewFor(2).isHost, true);
});

// ─────────────────────────── ночь ───────────────────────────

test('мафия не может стрелять по своим, а комиссар — проверять себя', () => {
  const game = makeGame(8, { useSheriff: true });
  game.start(1);
  game.advance(); // roles -> night

  const mafia = game.players.filter((p) => p.role === ROLE.MAFIA);
  const sheriff = game.players.find((p) => p.role === ROLE.SHERIFF);

  const badShot = game.submitNightAction(mafia[0].id, mafia[1].id);
  assert.equal(badShot.ok, false);

  const selfCheck = game.submitNightAction(sheriff.id, sheriff.id);
  assert.equal(selfCheck.ok, false);
});

test('комиссар узнаёт роль проверенного игрока', () => {
  const game = makeGame(8, { useSheriff: true });
  game.start(1);
  game.advance();

  const sheriff = game.players.find((p) => p.role === ROLE.SHERIFF);
  const mafioso = game.players.find((p) => p.role === ROLE.MAFIA);
  const civilian = game.players.find((p) => p.role === ROLE.CIVILIAN);

  game.submitNightAction(sheriff.id, mafioso.id);
  game.advance(); // ночь -> утро
  assert.equal(game.sheriffResults[mafioso.id], 'mafia');

  // следующая ночь
  game.advance(); // день -> обсуждение
  game.advance(); // обсуждение -> голосование
  game.advance(); // голосование -> вердикт (никто не голосовал)
  game.advance(); // вердикт -> ночь
  assert.equal(game.phase, PHASE.NIGHT);

  game.submitNightAction(sheriff.id, civilian.id);
  game.advance();
  assert.equal(game.sheriffResults[civilian.id], 'not_mafia');
});

test('жертву выбирает большинство мафии', () => {
  const game = makeGame(9); // 3 мафии
  game.start(1);
  game.advance();

  const mafia = game.players.filter((p) => p.role === ROLE.MAFIA);
  const targets = game.players.filter((p) => p.role !== ROLE.MAFIA);

  game.submitNightAction(mafia[0].id, targets[0].id);
  game.submitNightAction(mafia[1].id, targets[0].id);
  game.submitNightAction(mafia[2].id, targets[1].id);
  game.advance();

  assert.equal(game.player(targets[0].id).alive, false);
  assert.equal(game.player(targets[1].id).alive, true);
});

test('если мафия не сходила, ночью никто не гибнет', () => {
  const game = makeGame(8);
  game.start(1);
  game.advance();
  game.advance();
  assert.equal(game.alive.length, 8);
  assert.equal(game.lastNightVictim, null);
});

// ─────────────────────────── голосование ───────────────────────────

test('при равенстве голосов назначается переголосовка', () => {
  const game = makeGame(8, { tieRule: 'revote' });
  game.start(1);
  game.advance(); // night
  game.advance(); // day
  game.advance(); // discussion
  game.advance(); // voting

  const alive = game.alive;
  // двое получают по 2 голоса
  game.submitVote(alive[0].id, alive[2].id);
  game.submitVote(alive[1].id, alive[2].id);
  game.submitVote(alive[3].id, alive[4].id);
  game.submitVote(alive[5].id, alive[4].id);

  game.advance();
  assert.equal(game.phase, PHASE.REVOTE);
  assert.deepEqual(new Set(game.revoteCandidates), new Set([alive[2].id, alive[4].id]));

  // кандидаты не голосуют
  assert.equal(game.submitVote(alive[2].id, alive[4].id).ok, false);
  // и цель обязана быть из кандидатов
  assert.equal(game.submitVote(alive[0].id, alive[1].id).ok, false);

  game.submitVote(alive[0].id, alive[2].id);
  game.advance();
  assert.equal(game.player(alive[2].id).alive, false);
});

test('повторная ничья в переголосовке никого не казнит', () => {
  const game = makeGame(8, { tieRule: 'revote' });
  game.start(1);
  game.advance(); game.advance(); game.advance(); game.advance();

  const alive = game.alive;
  game.submitVote(alive[0].id, alive[2].id);
  game.submitVote(alive[1].id, alive[3].id);
  game.advance();
  assert.equal(game.phase, PHASE.REVOTE);

  game.submitVote(alive[4].id, alive[2].id);
  game.submitVote(alive[5].id, alive[3].id);
  game.advance();

  assert.equal(game.phase, PHASE.VERDICT);
  assert.equal(game.lastExecuted, null);
  assert.equal(game.alive.length, alive.length);
});

test('правило «никто не выбывает» работает без второго тура', () => {
  const game = makeGame(8, { tieRule: 'nobody' });
  game.start(1);
  game.advance(); game.advance(); game.advance(); game.advance();

  const alive = game.alive;
  game.submitVote(alive[0].id, alive[2].id);
  game.submitVote(alive[1].id, alive[3].id);
  game.advance();

  assert.equal(game.phase, PHASE.VERDICT);
  assert.equal(game.lastExecuted, null);
});

test('воздержавшийся отличается от непроголосовавшего', () => {
  const game = makeGame(8);
  game.start(1);
  game.advance(); game.advance(); game.advance(); game.advance();

  const [a, b] = game.alive;
  assert.equal(game.viewFor(a.id).myVote, undefined, 'до хода голоса нет');

  game.submitVote(a.id, null);
  const view = game.viewFor(a.id);
  assert.equal(view.myVote, null, 'воздержание должно сохраняться как null');
  assert.equal(view.votedCount, 1);
  assert.equal(game.viewFor(b.id).myVote, undefined, 'чужое воздержание не приписывается');

  // воздержавшийся не добавляет голосов никому
  assert.ok(view.players.every((p) => p.voteCount === 0));
});

test('нельзя голосовать за себя и за мёртвых', () => {
  const game = makeGame(8);
  game.start(1);
  game.advance(); game.advance(); game.advance(); game.advance();

  const alive = game.alive;
  assert.equal(game.submitVote(alive[0].id, alive[0].id).ok, false);

  const dead = game.players.find((p) => !p.alive);
  if (dead) assert.equal(game.submitVote(alive[0].id, dead.id).ok, false);
});

// ─────────────────────────── победа ───────────────────────────

test('город побеждает, когда мафии не осталось', () => {
  const game = makeGame(5); // 1 мафия
  game.start(1);
  game.advance(); game.advance(); game.advance(); game.advance();

  const mafioso = game.alive.find((p) => p.role === ROLE.MAFIA);
  for (const p of game.alive) {
    if (p.id !== mafioso.id) game.submitVote(p.id, mafioso.id);
  }
  game.advance();

  assert.equal(game.phase, PHASE.ENDED);
  assert.equal(game.winner, 'civilians');
});

test('мафия побеждает при равенстве с мирными', () => {
  const game = makeGame(5);
  game.start(1);

  // Вручную приводим к положению 1 мафия против 1 мирного
  const mafioso = game.players.find((p) => p.role === ROLE.MAFIA);
  const town = game.players.filter((p) => p.role !== ROLE.MAFIA);
  town.slice(0, 2).forEach((p) => { p.alive = false; });

  assert.equal(game.aliveMafia.length, 1);
  assert.equal(game.aliveTown.length, 2);
  assert.equal(game.checkWin(), false, 'один против двоих — игра продолжается');

  town[2].alive = false;
  assert.equal(game.checkWin(), true);
  assert.equal(game.winner, 'mafia');
  assert.ok(mafioso.alive);
});

// ─────────────────────────── режим живого ведущего ───────────────────────────

test('ведущий-человек не получает роль и не голосует', () => {
  const game = makeGame(7, { hostMode: 'human' }); // 1 ведущий + 6 играющих
  assert.equal(game.playing.length, 6);

  game.start(1);
  assert.equal(game.player(1).role, null);
  assert.equal(roleComposition(6).mafia, 2);

  game.advance(); // roles -> night
  game.advance(); // ведущий пропускает ночь
  game.advance(); // day -> discussion
  game.advance(); // discussion -> voting

  const res = game.submitVote(1, game.playing[1].id);
  assert.equal(res.ok, false);
});

test('в режиме живого ведущего таймеры не идут', () => {
  const game = makeGame(7, { hostMode: 'human' });
  game.start(1);
  assert.equal(game.phaseEndsAt, null);
  assert.equal(game.tick(Date.now() + 10 * 60 * 1000), false, 'без ведущего фаза не должна меняться');
  assert.equal(game.phase, PHASE.ROLES);

  assert.equal(game.hostNext(2).ok, false, 'обычный игрок не двигает фазы');
  assert.equal(game.hostNext(1).ok, true);
  assert.equal(game.phase, PHASE.NIGHT);
});

// ─────────────────────────── видимость ───────────────────────────

test('игрок не видит чужие роли, мафия видит своих', () => {
  const game = makeGame(8);
  game.start(1);

  const mafia = game.players.filter((p) => p.role === ROLE.MAFIA);
  const civilian = game.players.find((p) => p.role === ROLE.CIVILIAN);

  const civView = game.viewFor(civilian.id);
  const visible = civView.players.filter((p) => p.role !== null);
  assert.equal(visible.length, 1, 'мирный видит только свою роль');
  assert.equal(visible[0].id, civilian.id);

  const mafiaView = game.viewFor(mafia[0].id);
  const seenMafia = mafiaView.players.filter((p) => p.role === ROLE.MAFIA);
  assert.equal(seenMafia.length, 2, 'мафия видит всех своих');
});

test('ночная цель мафии не видна городу', () => {
  const game = makeGame(8);
  game.start(1);
  game.advance();

  const mafia = game.players.filter((p) => p.role === ROLE.MAFIA);
  const civilian = game.players.find((p) => p.role === ROLE.CIVILIAN);
  game.submitNightAction(mafia[0].id, civilian.id);

  const civView = game.viewFor(civilian.id);
  assert.ok(civView.players.every((p) => p.mafiaTargeted === 0));
  assert.equal(civView.chat.mafia.length, 0);

  const mafiaView = game.viewFor(mafia[0].id);
  assert.equal(mafiaView.players.find((p) => p.id === civilian.id).mafiaTargeted, 1);
});

test('после конца партии роли открыты всем', () => {
  const game = makeGame(5);
  game.start(1);
  game.finish('mafia');
  const view = game.viewFor(game.players[4].id);
  assert.ok(view.players.every((p) => p.role !== null));
});

// ─────────────────────────── чат ───────────────────────────

test('ночью город молчит, а мафия говорит в своём канале', () => {
  const game = makeGame(8);
  game.start(1);
  game.advance();

  const mafioso = game.players.find((p) => p.role === ROLE.MAFIA);
  const civilian = game.players.find((p) => p.role === ROLE.CIVILIAN);

  const m = game.addChat(mafioso.id, 'валим третьего');
  assert.equal(m.ok, true);
  assert.equal(m.channel, 'mafia');

  const c = game.addChat(civilian.id, 'а я не сплю');
  assert.equal(c.ok, false);
});

// ─────────────────────────── симуляции ───────────────────────────

/**
 * Прогоняем полные партии со случайными решениями и проверяем,
 * что игра всегда корректно заканчивается и не зависает.
 */
function simulate(n, seed, settings = {}) {
  const rng = seeded(seed);
  const game = new Game({ code: 'SIM', hostId: 1, settings: { maxPlayers: MAX_PLAYERS, ...settings }, rng });
  for (let i = 1; i <= n; i++) {
    const added = game.addPlayer({ id: i, name: `И${i}` });
    assert.equal(added.ok, true, `не удалось добавить игрока ${i}: ${added.code}`);
  }
  assert.equal(game.players.length, n);
  const started = game.start(1);
  assert.equal(started.ok, true, started.code);

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  let guard = 0;

  while (game.phase !== PHASE.ENDED) {
    if (++guard > 500) throw new Error(`партия зависла на фазе ${game.phase}`);

    if (game.phase === PHASE.NIGHT) {
      for (const m of game.aliveMafia) {
        const targets = game.alive.filter((p) => p.role !== ROLE.MAFIA);
        if (targets.length) game.submitNightAction(m.id, pick(targets).id);
      }
      const sheriff = game.alive.find((p) => p.role === ROLE.SHERIFF);
      if (sheriff) {
        const targets = game.alive.filter((p) => p.id !== sheriff.id);
        if (targets.length) game.submitNightAction(sheriff.id, pick(targets).id);
      }
      const doctor = game.alive.find((p) => p.role === ROLE.DOCTOR);
      if (doctor) {
        const targets = game.alive.filter((p) => p.id !== game.lastDoctorHeal);
        if (targets.length) game.submitNightAction(doctor.id, pick(targets).id);
      }
    }

    if (game.phase === PHASE.VOTING || game.phase === PHASE.REVOTE) {
      const candidates = game.phase === PHASE.REVOTE
        ? game.alive.filter((p) => game.revoteCandidates.includes(p.id))
        : game.alive;
      for (const voter of game.alive) {
        if (game.phase === PHASE.REVOTE && game.revoteCandidates.includes(voter.id)) continue;
        const targets = candidates.filter((p) => p.id !== voter.id);
        if (targets.length) game.submitVote(voter.id, pick(targets).id);
      }
    }

    game.advance();

    // инвариант: живых мафиози никогда не бывает больше, чем всего живых
    assert.ok(game.aliveMafia.length <= game.alive.length);
  }

  return game;
}

test('100 случайных партий всегда завершаются корректно', () => {
  let mafiaWins = 0;
  let townWins = 0;

  for (let seed = 1; seed <= 100; seed++) {
    const n = 5 + (seed % 8); // 5..12
    const game = simulate(n, seed);

    assert.equal(game.phase, PHASE.ENDED);
    assert.ok(game.winner === 'mafia' || game.winner === 'civilians');

    if (game.winner === 'mafia') {
      mafiaWins++;
      assert.ok(game.aliveMafia.length >= game.aliveTown.length, 'победа мафии без перевеса');
      assert.ok(game.aliveMafia.length > 0);
    } else {
      townWins++;
      assert.equal(game.aliveMafia.length, 0, 'победа города при живой мафии');
      assert.ok(game.aliveTown.length > 0);
    }
  }

  assert.equal(mafiaWins + townWins, 100);
  assert.ok(mafiaWins > 0 && townWins > 0, 'обе стороны должны иногда выигрывать');
});

test('симуляции с живым ведущим тоже завершаются', () => {
  for (let seed = 200; seed < 220; seed++) {
    const game = simulate(7 + (seed % 4), seed, { hostMode: 'human' });
    assert.equal(game.phase, PHASE.ENDED);
    assert.equal(game.player(1).role, null, 'ведущий не должен получить роль');
  }
});

test('все правила ничьей доводят партию до конца', () => {
  for (const tieRule of ['revote', 'nobody', 'random']) {
    for (let seed = 300; seed < 310; seed++) {
      const game = simulate(8, seed, { tieRule });
      assert.equal(game.phase, PHASE.ENDED, `зависло при tieRule=${tieRule}`);
    }
  }
});

test('партии с любым набором ролей доходят до конца', () => {
  const combos = [
    { useDoctor: true, useSheriff: false },
    { useDoctor: true, useSheriff: true },
    { useDoctor: false, useSheriff: true },
    { useDoctor: false, useSheriff: false },
  ];

  for (const combo of combos) {
    let saves = 0;
    for (let seed = 400; seed < 425; seed++) {
      const n = 5 + (seed % 8);
      const game = simulate(n, seed, combo);
      assert.equal(game.phase, PHASE.ENDED, `зависло при ${JSON.stringify(combo)}`);
      assert.ok(game.winner === 'mafia' || game.winner === 'civilians');
      // доктор входит в город и учитывается в условии победы
      if (game.winner === 'civilians') assert.equal(game.aliveMafia.length, 0);
      else assert.ok(game.aliveMafia.length >= game.aliveTown.length);
      if (game.log.some((e) => e.kind === 'peace')) saves++;
    }
    if (combo.useDoctor) {
      assert.ok(saves > 0, 'за 25 партий доктор ни разу никого не спас — подозрительно');
    }
  }
});

test('новая партия сбрасывает состояние', () => {
  const game = simulate(8, 7);
  const res = game.restart(1);
  assert.equal(res.ok, true);
  assert.equal(game.phase, PHASE.LOBBY);
  assert.equal(game.winner, null);
  assert.equal(game.dayNumber, 0);
  assert.ok(game.players.every((p) => p.alive && p.role === null));
  assert.equal(game.start(1).ok, true);
});
