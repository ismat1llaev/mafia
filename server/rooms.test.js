/**
 * Тесты списка открытых комнат.
 *
 * Главное: в список не должно попасть ничего, куда нельзя зайти, —
 * идущие партии, закрытые и заполненные комнаты.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './rooms.js';
import { MIN_PLAYERS } from './game.js';

/** Заглушка сокета: менеджер смотрит только на readyState и send. */
const fakeSocket = () => ({ readyState: 1, send() {} });

function setup() {
  const manager = new RoomManager();
  manager.stop(); // тикать сам не нужно, зовём вручную
  return manager;
}

function makeRoom(manager, { host, members = [], settings = {} }) {
  const { code } = manager.createRoom(host, settings);
  const room = manager.getRoom(code);
  manager.attachSocket(room, host.id, fakeSocket());
  for (const m of members) {
    manager.joinRoom(m, code);
    manager.attachSocket(room, m.id, fakeSocket());
  }
  return room;
}

const user = (id) => ({ id, name: `Игрок ${id}` });

test('открытая незаполненная комната попадает в список', () => {
  const m = setup();
  makeRoom(m, { host: user(1), members: [user(2), user(3)] });

  const list = m.publicRooms();
  assert.equal(list.length, 1);
  assert.equal(list[0].players, 3);
  assert.equal(list[0].maxPlayers, 8);
  assert.equal(list[0].needed, MIN_PLAYERS - 3);
  assert.equal(list[0].hostName, 'Игрок 1');
  assert.equal(list[0].useDoctor, true);
  assert.equal(list[0].useSheriff, false);
});

test('закрытая комната в списке не показывается', () => {
  const m = setup();
  const room = makeRoom(m, { host: user(1), members: [user(2)] });
  room.game.updateSettings(1, { isPublic: false });

  assert.deepEqual(m.publicRooms(), []);
});

test('заполненная комната в списке не показывается', () => {
  const m = setup();
  const members = [2, 3, 4, 5].map(user);
  const room = makeRoom(m, { host: user(1), members, settings: { maxPlayers: 5 } });

  assert.equal(room.game.playing.length, 5);
  assert.deepEqual(m.publicRooms(), [], 'мест нет, а комната всё равно в списке');
});

test('идущая партия в списке не показывается', () => {
  const m = setup();
  const room = makeRoom(m, { host: user(1), members: [2, 3, 4, 5].map(user) });

  assert.equal(m.publicRooms().length, 1);
  assert.equal(room.game.start(1).ok, true);
  assert.deepEqual(m.publicRooms(), [], 'в начатую игру зайти нельзя');
});

test('покинутая комната в списке не показывается', () => {
  const m = setup();
  const room = makeRoom(m, { host: user(1), members: [user(2)] });
  assert.equal(m.publicRooms().length, 1);

  for (const [id, sockets] of [...room.sockets]) {
    for (const ws of [...sockets]) m.detachSocket(room, id, ws);
  }

  assert.deepEqual(m.publicRooms(), [], 'комната без живых участников не нужна');
});

test('первыми идут комнаты, которым осталось меньше всего', () => {
  const m = setup();
  makeRoom(m, { host: user(10), members: [user(11)] });
  makeRoom(m, { host: user(20), members: [21, 22, 23].map(user) });
  makeRoom(m, { host: user(30), members: [user(31), user(32)] });

  const list = m.publicRooms();
  assert.deepEqual(list.map((r) => r.players), [4, 3, 2]);
});

test('список ограничен по длине', () => {
  const m = setup();
  for (let i = 0; i < 25; i++) makeRoom(m, { host: user(100 + i) });
  assert.equal(m.publicRooms(20).length, 20);
});

test('коды комнат не повторяются', () => {
  const m = setup();
  const codes = new Set();
  for (let i = 0; i < 300; i++) codes.add(m.createRoom(user(1000 + i), {}).code);
  assert.equal(codes.size, 300, 'выданы одинаковые коды комнат');
});
