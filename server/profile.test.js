/**
 * Тесты профиля игрока.
 *
 * Главное: за столом стоят имя и фото из профиля, мусор и чужие файлы
 * под видом фото не принимаются, а устаревшая копия профиля со второго
 * устройства не затирает свежую правку.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Profiles, cleanName, decodePhoto, sanitizeProfile, NAME_MAX, PHOTO_MAX_BYTES } from './profile.js';
import { Game } from './game.js';

/** Похожее на JPEG: сервер смотрит только на сигнатуру FF D8 FF. */
const jpeg = (fill = 1, size = 64) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(size, fill),
  Buffer.from([0xff, 0xd9]),
]);

const dataUrl = (bytes) => `data:image/jpeg;base64,${bytes.toString('base64')}`;

const tgUser = (id) => ({ id, name: `Telegram ${id}`, username: null, photo: 'https://t.me/i/userpic.jpg' });

test('имя чистится от невидимых символов и обрезается', () => {
  const zeroWidth = String.fromCharCode(0x200b);
  const rtlOverride = String.fromCharCode(0x202e);

  assert.equal(cleanName(`  Вито${zeroWidth}   ${rtlOverride}Корлеоне  `), 'Вито Корлеоне');
  assert.equal(cleanName('А'.repeat(40)).length, NAME_MAX);
  assert.equal(cleanName(null), '');

  // Эмодзи не разрезается пополам на границе длины
  const long = `${'Я'.repeat(NAME_MAX - 1)}🎩🎩`;
  assert.equal(Array.from(cleanName(long)).length, NAME_MAX);
  assert.ok(cleanName(long).endsWith('🎩'));
});

test('фото принимается только JPEG и не больше предела', () => {
  assert.deepEqual(decodePhoto(null), { ok: true, bytes: null });
  assert.equal(decodePhoto(dataUrl(jpeg())).ok, true);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(decodePhoto(`data:image/jpeg;base64,${png.toString('base64')}`).code, 'photo_bad',
    'PNG под видом JPEG не проходит');
  assert.equal(decodePhoto(`data:text/html;base64,${jpeg().toString('base64')}`).code, 'photo_bad');
  assert.equal(decodePhoto({ evil: true }).code, 'photo_bad');
  assert.equal(decodePhoto(dataUrl(jpeg(1, PHOTO_MAX_BYTES))).code, 'photo_too_big');
});

test('возраст и пол вне допустимого сбрасываются', () => {
  for (const age of [0, 100, 'abc', 2.5, '', null, -3]) {
    assert.equal(sanitizeProfile({ age }).profile.age, null, `возраст ${age}`);
  }
  assert.equal(sanitizeProfile({ age: '27' }).profile.age, 27);
  assert.equal(sanitizeProfile({ gender: 'female' }).profile.gender, 'female');
  assert.equal(sanitizeProfile({ gender: 'robot' }).profile.gender, null);
  assert.equal(sanitizeProfile('строка').code, 'profile_bad');
});

test('за столом имя и фото из профиля, без них — из Telegram', () => {
  const profiles = new Profiles();
  const user = tgUser(1);
  assert.deepEqual(profiles.identity(user), user, 'без профиля всё как в Telegram');

  profiles.save(1, { firstName: 'Вито', lastName: 'Корлеоне', updatedAt: 100 });
  let me = profiles.identity(user);
  assert.equal(me.name, 'Вито Корлеоне');
  assert.equal(me.photo, user.photo, 'своё фото не загружено — остаётся фото из Telegram');

  const saved = profiles.save(1, { firstName: 'Вито', photo: dataUrl(jpeg(7)), updatedAt: 200 });
  me = profiles.identity(user);
  assert.equal(me.name, 'Вито');
  assert.equal(me.photo, `/api/photo/${saved.profile.photoHash}.jpg`);
  assert.deepEqual(profiles.photo(saved.profile.photoHash), jpeg(7));

  profiles.save(1, { firstName: '   ', updatedAt: 300 });
  assert.equal(profiles.identity(user).name, 'Telegram 1', 'пустое имя не оставляет игрока безымянным');
});

test('при входе устаревшая копия не затирает свежую, явное сохранение — затирает', () => {
  const profiles = new Profiles();
  profiles.save(1, { firstName: 'Свежий', updatedAt: 200 });

  const stale = profiles.save(1, { firstName: 'Старый', updatedAt: 100 });
  assert.equal(stale.changed, false);
  assert.equal(profiles.get(1).firstName, 'Свежий');

  const forced = profiles.save(1, { firstName: 'Новый', updatedAt: 150 }, { force: true });
  assert.equal(forced.changed, true);
  assert.equal(profiles.get(1).firstName, 'Новый');
  assert.equal(profiles.get(1).updatedAt, 201, 'отметка новее прежней, иначе правку перебьёт второе устройство');
});

test('владелец получает свой профиль вместе со снимком', () => {
  const profiles = new Profiles();
  const photo = dataUrl(jpeg(3));
  profiles.save(5, { firstName: 'Майкл', age: 31, gender: 'male', photo, updatedAt: 10 });

  assert.deepEqual(profiles.ownerView(5), {
    firstName: 'Майкл', lastName: '', age: 31, gender: 'male', photo, updatedAt: 10,
  });
  assert.equal(profiles.ownerView(6), null);
});

test('сменённое фото ещё доступно какое-то время, потом убирается', () => {
  const profiles = new Profiles();
  const now = 1_000_000;
  const first = profiles.save(1, { photo: dataUrl(jpeg(1)) }, { now }).profile.photoHash;
  profiles.save(1, { photo: dataUrl(jpeg(2)) }, { force: true, now });

  assert.ok(profiles.photo(first), 'в идущей партии старое фото ещё на экране у других');

  profiles.evict(now + 7 * 60 * 60 * 1000);
  assert.equal(profiles.photo(first), null);
});

test('одинаковое фото у двух игроков не пропадает, когда один его сменил', () => {
  const profiles = new Profiles();
  const shared = profiles.save(1, { photo: dataUrl(jpeg(9)) }).profile.photoHash;
  profiles.save(2, { photo: dataUrl(jpeg(9)) });
  profiles.save(1, { photo: null }, { force: true });

  profiles.evict(Date.now() + 7 * 60 * 60 * 1000);
  assert.ok(profiles.photo(shared), 'второй игрок всё ещё с этим фото');
});

test('профилей в памяти не больше предела', () => {
  const profiles = new Profiles({ max: 3 });
  for (let id = 1; id <= 5; id++) profiles.save(id, { firstName: `Игрок ${id}` });
  assert.equal(profiles.byUser.size, 3);
  assert.equal(profiles.get(1), null, 'вытесняются самые давние');
  assert.equal(profiles.get(5).firstName, 'Игрок 5');
});

test('в лобби имя меняется сразу, посреди партии — только после неё', () => {
  const game = new Game({ code: 'TEST1', hostId: 1, settings: { maxPlayers: 12 } });
  for (let i = 1; i <= 5; i++) game.addPlayer({ id: i, name: `Игрок ${i}`, photo: null });

  assert.equal(game.setIdentity(2, { name: 'Дон Корлеоне', photo: '/api/photo/a.jpg' }).deferred, false);
  assert.equal(game.player(2).name, 'Дон Корлеоне');
  assert.equal(game.viewFor(3).players.find((p) => p.id === 2).photo, '/api/photo/a.jpg');

  assert.equal(game.start(1).ok, true);
  assert.equal(game.setIdentity(2, { name: 'Комиссар', photo: null }).deferred, true);
  assert.equal(game.player(2).name, 'Дон Корлеоне', 'посреди партии имя не меняется');

  // Возвращение после обрыва связи тоже не переименовывает
  game.addPlayer({ id: 2, name: 'Комиссар', photo: null });
  assert.equal(game.player(2).name, 'Дон Корлеоне');
  assert.equal(game.player(2).photo, '/api/photo/a.jpg');

  game.finish('mafia');
  assert.equal(game.restart(1).ok, true);
  assert.equal(game.player(2).name, 'Комиссар', 'новое имя встало на место в лобби');
  assert.equal(game.player(2).photo, null);
});

test('ботам имя из профиля не назначается', () => {
  const game = new Game({ code: 'TEST1', hostId: 1 });
  game.addPlayer({ id: 1, name: 'Хозяин' });
  const { bot } = game.addBot(1);
  assert.equal(game.setIdentity(bot.id, { name: 'Самозванец' }).ok, false);
  assert.equal(game.player(bot.id).name, bot.name);
});
