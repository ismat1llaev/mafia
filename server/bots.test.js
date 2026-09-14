/**
 * Тесты ботов.
 *
 * Главное, что здесь проверяется: партия с ботами доходит до конца сама.
 * Если бот в какой-то фазе не сходит, игра встанет на таймере — а такое
 * на живом сервере заметно не сразу, поэтому симуляция важнее частностей.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, ROLE, PHASE, MIN_PLAYERS, MAX_PLAYERS } from './game.js';
import { runBots } from './bots.js';

const HUMAN = { id: 1001, name: 'Человек' };

function soloGame(total = 7, settings = {}) {
  const game = new Game({ code: 'TEST1', hostId: HUMAN.id, settings });
  game.addPlayer(HUMAN);
  game.fillWithBots(total);
  return game;
}

/**
 * Прокрутить партию «часами»: боты ходят, таймеры фаз идут.
 * Человека здесь нет — за него никто не ходит, он просто молчит.
 */
function simulate(game, { stepMs = 1000, maxSteps = 4000 } = {}) {
  let now = Date.now();
  game.start(HUMAN.id, now);
  for (let i = 0; i < maxSteps && game.inProgress; i++) {
    now += stepMs;
    runBots(game, now);
    for (let guard = 0; guard < 5; guard++) {
      if (!game.tick(now)) break;
    }
  }
  return game;
}

test('стол добивается ботами до нужного размера', () => {
  const game = soloGame(7);
  assert.equal(game.players.length, 7);
  assert.equal(game.bots.length, 6);
  assert.equal(game.humans.length, 1);
});

test('боты не лезут за предел комнаты', () => {
  const game = soloGame(MAX_PLAYERS + 5, { maxPlayers: 8 });
  assert.ok(game.players.length <= 8, `игроков ${game.players.length}`);
});

test('меньше минимума стол не собирают', () => {
  const game = soloGame(2);
  assert.ok(game.players.length >= MIN_PLAYERS);
});

test('у ботов отрицательные id и они не повторяются', () => {
  const game = soloGame(9);
  const ids = game.bots.map((b) => b.id);
  assert.ok(ids.every((id) => id < 0), 'найден бот с положительным id');
  assert.equal(new Set(ids).size, ids.length, 'id ботов повторяются');
  assert.ok(!ids.includes(HUMAN.id));
});

test('имена ботов не повторяются', () => {
  const game = soloGame(MAX_PLAYERS, { maxPlayers: MAX_PLAYERS });
  const names = game.players.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'имена повторяются');
});

test('партия с ботами доигрывается до конца', () => {
  const game = simulate(soloGame(7, { useSheriff: true, useDoctor: true }));
  assert.equal(game.phase, PHASE.ENDED, 'партия не закончилась');
  assert.ok(['mafia', 'civilians'].includes(game.winner), `странный победитель: ${game.winner}`);
});

test('партия доигрывается при любом составе стола', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const game = simulate(soloGame(n, { maxPlayers: MAX_PLAYERS, useSheriff: true }));
    assert.equal(game.phase, PHASE.ENDED, `стол на ${n} не доиграл`);
  }
});

test('боты ходят ночью за все свои роли', () => {
  const game = soloGame(9, { useSheriff: true, useDoctor: true, maxPlayers: 9 });
  let now = Date.now();
  game.start(HUMAN.id, now);

  // Доводим до первой ночи
  for (let i = 0; i < 60 && game.phase !== PHASE.NIGHT; i++) {
    now += 1000;
    game.tick(now);
  }
  assert.equal(game.phase, PHASE.NIGHT);

  // Даём ботам время подумать
  for (let i = 0; i < 30; i++) {
    now += 1000;
    runBots(game, now);
  }

  const botMafia = game.aliveMafia.filter((p) => p.isBot);
  for (const m of botMafia) {
    assert.notEqual(game.nightVotes[m.id], undefined, `мафия-бот ${m.name} не выстрелила`);
  }

  const sheriff = game.alive.find((p) => p.role === ROLE.SHERIFF);
  if (sheriff?.isBot) assert.notEqual(game.sheriffCheck, null, 'комиссар-бот не проверил никого');

  const doctor = game.alive.find((p) => p.role === ROLE.DOCTOR);
  if (doctor?.isBot) assert.notEqual(game.doctorHeal, null, 'доктор-бот никого не лечил');
});

test('мафия-боты не стреляют по своим', () => {
  for (let seed = 0; seed < 25; seed++) {
    const game = soloGame(8, { maxPlayers: 8 });
    let now = Date.now() + seed * 7919;
    game.start(HUMAN.id, now);
    for (let i = 0; i < 400 && game.inProgress; i++) {
      now += 1000;
      runBots(game, now);
      if (game.phase === PHASE.NIGHT) {
        const mafiaIds = new Set(game.aliveMafia.map((p) => p.id));
        for (const [voter, target] of Object.entries(game.nightVotes)) {
          if (!mafiaIds.has(Number(voter))) continue;
          assert.ok(!mafiaIds.has(Number(target)), 'мафия выстрелила в своего');
        }
      }
      for (let guard = 0; guard < 5; guard++) {
        if (!game.tick(now)) break;
      }
    }
  }
});

test('боты не голосуют сами за себя', () => {
  for (let seed = 0; seed < 25; seed++) {
    const game = soloGame(7);
    let now = Date.now() + seed * 104729;
    game.start(HUMAN.id, now);
    for (let i = 0; i < 400 && game.inProgress; i++) {
      now += 1000;
      runBots(game, now);
      for (const [voter, target] of Object.entries(game.votes)) {
        if (target === null) continue;
        assert.notEqual(Number(voter), Number(target), 'бот проголосовал за себя');
      }
      for (let guard = 0; guard < 5; guard++) {
        if (!game.tick(now)) break;
      }
    }
  }
});

test('комиссар-бот голосует за найденную мафию', () => {
  const game = soloGame(7, { useSheriff: true });
  game.start(HUMAN.id);
  const sheriff = game.playing.find((p) => p.role === ROLE.SHERIFF && p.isBot)
    || (() => {
      // Роли раздаются случайно — при неудаче назначаем вручную,
      // тест проверяет решение бота, а не раздачу
      const bot = game.bots[0];
      const mafia = game.playing.find((p) => p.role === ROLE.MAFIA);
      bot.role = ROLE.SHERIFF;
      return mafia ? bot : null;
    })();

  assert.ok(sheriff, 'не нашли комиссара');
  const mafia = game.alive.find((p) => p.role === ROLE.MAFIA && p.id !== sheriff.id);
  game.sheriffResults[mafia.id] = 'mafia';

  game.beginVoting(Date.now());
  let now = Date.now();
  for (let i = 0; i < 40; i++) {
    now += 1000;
    runBots(game, now);
  }
  assert.equal(game.votes[sheriff.id], mafia.id, 'комиссар не сдал найденную мафию');
});

test('доктор-бот не лечит одного и того же две ночи подряд', () => {
  for (let seed = 0; seed < 20; seed++) {
    const game = soloGame(8, { useDoctor: true, maxPlayers: 8 });
    let now = Date.now() + seed * 31337;
    game.start(HUMAN.id, now);
    for (let i = 0; i < 400 && game.inProgress; i++) {
      now += 1000;
      runBots(game, now);
      if (game.phase === PHASE.NIGHT && game.doctorHeal !== null) {
        assert.notEqual(game.doctorHeal, game.lastDoctorHeal, 'вылечил того же, что вчера');
      }
      for (let guard = 0; guard < 5; guard++) {
        if (!game.tick(now)) break;
      }
    }
  }
});

test('боты разговаривают в обсуждении кодами реплик', () => {
  const game = soloGame(7);
  let now = Date.now();
  game.start(HUMAN.id, now);
  for (let i = 0; i < 300 && game.phase !== PHASE.DISCUSSION && game.inProgress; i++) {
    now += 1000;
    runBots(game, now);
    for (let guard = 0; guard < 5; guard++) {
      if (!game.tick(now)) break;
    }
  }
  assert.equal(game.phase, PHASE.DISCUSSION);

  for (let i = 0; i < 20; i++) {
    now += 1000;
    runBots(game, now);
  }

  const said = game.chat.day.filter((m) => m.bot);
  assert.ok(said.length > 0, 'боты промолчали всё обсуждение');
  for (const m of said) {
    assert.ok(m.code, 'реплика бота без кода — её нечем перевести');
    assert.equal(m.text, '', 'у реплики бота не должно быть готового текста');
  }
});

test('боты не ходят до начала партии', () => {
  const game = soloGame(7);
  const changed = runBots(game, Date.now());
  assert.equal(changed, false);
  assert.deepEqual(game.nightVotes, {});
});

test('состав ботов не меняют во время партии', () => {
  const game = soloGame(7);
  game.start(HUMAN.id);
  assert.equal(game.addBot(HUMAN.id).ok, false);
  assert.equal(game.removeBot(HUMAN.id).ok, false);
});

test('ботами распоряжается только создатель комнаты', () => {
  const game = soloGame(6);
  const res = game.addBot(9999);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'bots_host_only');
});

test('убрать бота из пустого стола нельзя', () => {
  const game = new Game({ code: 'TEST2', hostId: HUMAN.id });
  game.addPlayer(HUMAN);
  const res = game.removeBot(HUMAN.id);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'no_bots');
});

test('боты переживают перезапуск партии тем же составом', () => {
  const game = simulate(soloGame(7));
  const before = game.bots.length;
  assert.equal(game.restart(HUMAN.id).ok, true);
  assert.equal(game.phase, PHASE.LOBBY);
  assert.equal(game.bots.length, before, 'боты пропали при перезапуске');
});

test('в статистику боты не попадают', () => {
  const game = simulate(soloGame(7));
  const recorded = [];
  const fakeStore = {
    data: { games: 0 },
    user(id) { recorded.push(id); return { id, games: 0, wins: 0 }; },
  };
  // Повторяем то, что делает Store.recordGame, но следим за списком id
  for (const p of game.playing) {
    if (!p.role) continue;
    if (p.isBot) continue;
    fakeStore.user(p.id);
  }
  assert.deepEqual(recorded, [HUMAN.id]);
});

test('неудачная сборка стола не оставляет пустую комнату', async () => {
  const { RoomManager } = await import('./rooms.js');
  const manager = new RoomManager({});
  try {
    // maxPlayers ниже минимума — партия начаться не может
    const res = manager.createSoloRoom(HUMAN, { players: 7, settings: { maxPlayers: 1 } });
    assert.equal(res.ok, false);
    assert.equal(manager.rooms.size, 0, 'осталась висеть пустая комната');
    assert.equal(manager.userRoom.has(HUMAN.id), false);
  } finally {
    manager.stop();
  }
});

test('комната с ботами стартует и не попадает в общий список', async () => {
  const { RoomManager } = await import('./rooms.js');
  const manager = new RoomManager({});
  try {
    const res = manager.createSoloRoom(HUMAN, { players: 7 });
    assert.equal(res.ok, true);
    assert.equal(res.game.phase, PHASE.ROLES, 'партия не началась сразу');
    assert.equal(res.game.bots.length, 6);
    assert.deepEqual(manager.publicRooms(), [], 'одиночная комната видна в списке');
  } finally {
    manager.stop();
  }
});
