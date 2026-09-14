/**
 * Тесты проверки подписи Telegram initData.
 *
 * Главное, что здесь проверяется: подпись сходится, когда Telegram присылает
 * поле `signature` (Bot API 7.10+). Из строки проверки исключается только
 * `hash` — если убрать ещё и `signature`, вход перестанет подтверждаться.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyInitData } from './auth.js';

const TOKEN = '123456789:AAHtestTokenForUnitTestsOnly_000000000';

const USER = {
  id: 777001,
  first_name: 'Тест',
  last_name: 'Тестов',
  username: 'testuser',
  language_code: 'ru',
};

/** Собирает initData ровно так, как это делает Telegram. */
function makeInitData(fields = {}, token = TOKEN) {
  const params = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(USER),
    ...fields,
  };

  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const sp = new URLSearchParams(params);
  sp.set('hash', hash);
  return sp.toString();
}

test('подпись сходится без поля signature', () => {
  const res = verifyInitData(makeInitData(), TOKEN);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.user.id, USER.id);
  assert.equal(res.user.name, 'Тест Тестов');
  assert.equal(res.user.username, 'testuser');
});

test('подпись сходится, когда Telegram присылает signature', () => {
  // Именно на этом ломался вход: signature участвует в строке проверки
  const initData = makeInitData({ signature: 'Zm9vYmFyc2lnbmF0dXJlZXhhbXBsZQ' });
  const res = verifyInitData(initData, TOKEN);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.user.id, USER.id);
});

test('подделанные данные не проходят', () => {
  const initData = makeInitData({ signature: 'abc' });
  const tampered = initData.replace(/user=[^&]+/, () => {
    const evil = { ...USER, id: 999999 };
    return `user=${encodeURIComponent(JSON.stringify(evil))}`;
  });
  const res = verifyInitData(tampered, TOKEN);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'auth_bad_hash');
});

test('чужой токен не подходит', () => {
  const res = verifyInitData(makeInitData(), '987654321:BBanotherTokenEntirely_00000000000000');
  assert.equal(res.ok, false);
});

test('устаревшие данные отклоняются', () => {
  const old = String(Math.floor(Date.now() / 1000) - 60 * 60 * 25);
  const res = verifyInitData(makeInitData({ auth_date: old }), TOKEN);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'auth_expired');
});

test('пустые и битые данные не роняют сервер', () => {
  for (const bad of ['', null, undefined, 'простотекст', 'hash=', 'a=b&c=d']) {
    const res = verifyInitData(bad, TOKEN);
    assert.equal(res.ok, false);
    assert.ok(typeof res.code === 'string' && res.code.length > 0);
  }
});

test('без токена на сервере вход не подтверждается', () => {
  const res = verifyInitData(makeInitData(), '');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'auth_no_token');
});

test('start_param прокидывается для входа по ссылке', () => {
  const res = verifyInitData(makeInitData({ start_param: 'AB3XZ' }), TOKEN);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.startParam, 'AB3XZ');
});

test('имя берётся из username, если имени нет', () => {
  const user = { id: 5, username: 'nomane' };
  const res = verifyInitData(makeInitData({ user: JSON.stringify(user) }), TOKEN);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.user.name, 'nomane');
});
