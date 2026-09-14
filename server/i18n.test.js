/**
 * Тесты переводов.
 *
 * Сервер не присылает готовых фраз — только коды событий и ошибок. Значит,
 * стоит добавить на сервере новый код и забыть про словарь, как игрок увидит
 * вместо текста служебное слово. Эти тесты читают исходники сервера, собирают
 * все коды и проверяют, что для каждого есть фраза на обоих языках.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DICTS, LANGS, translate } from '../client/src/dict.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
const SERVER = ['game.js', 'rooms.js', 'auth.js', 'index.js', 'profile.js'].map(read).join('\n');

/** Все коды из конструкций вида code: 'xxx' и fail('xxx'). */
function errorCodes() {
  const codes = new Set();
  for (const m of SERVER.matchAll(/\bcode: '([a-z_]+)'/g)) codes.add(m[1]);
  for (const m of SERVER.matchAll(/\bfail\('([a-z_]+)'/g)) codes.add(m[1]);
  return [...codes];
}

/** Коды журнала: addLog('xxx', ...). */
function logCodes() {
  const codes = new Set();
  for (const m of SERVER.matchAll(/addLog\(\s*'([a-z_]+)'/g)) codes.add(m[1]);
  // Победа записывается через тернарник, регулярка его не поймает
  codes.add('win_mafia');
  codes.add('win_town');
  return [...codes];
}

test('словари описывают одни и те же ключи', () => {
  const ru = Object.keys(DICTS.ru).sort();
  const en = Object.keys(DICTS.en).sort();

  const missingEn = ru.filter((k) => !(k in DICTS.en));
  const extraEn = en.filter((k) => !(k in DICTS.ru));

  assert.deepEqual(missingEn, [], 'нет английского перевода');
  assert.deepEqual(extraEn, [], 'лишние ключи в английском словаре');
});

test('у каждой ошибки сервера есть перевод', () => {
  const codes = errorCodes();
  assert.ok(codes.length > 20, `нашли подозрительно мало кодов: ${codes.length}`);

  for (const code of codes) {
    for (const lang of LANGS) {
      assert.ok(DICTS[lang][`err.${code}`], `нет перевода err.${code} для «${lang}»`);
    }
  }
});

test('у каждого события журнала есть перевод', () => {
  for (const code of logCodes()) {
    for (const lang of LANGS) {
      assert.ok(DICTS[lang][`log.${code}`], `нет перевода log.${code} для «${lang}»`);
    }
  }
});

test('роли и фазы переведены полностью', () => {
  const roles = ['mafia', 'sheriff', 'doctor', 'civilian', 'host'];
  const phases = ['roles', 'night', 'day', 'discussion', 'voting', 'revote', 'verdict', 'ended'];

  for (const lang of LANGS) {
    for (const r of roles) {
      assert.ok(DICTS[lang][`role.${r}`], `нет role.${r} для «${lang}»`);
      assert.ok(DICTS[lang][`role.${r}.desc`], `нет описания role.${r}.desc для «${lang}»`);
    }
    for (const r of roles.filter((x) => x !== 'host')) {
      assert.ok(DICTS[lang][`roleLower.${r}`], `нет roleLower.${r} для «${lang}»`);
    }
    for (const p of phases) {
      assert.ok(DICTS[lang][`phase.${p}`], `нет phase.${p} для «${lang}»`);
    }
  }
});

test('подстановки работают на обоих языках', () => {
  for (const lang of LANGS) {
    const killed = translate(lang, 'log.killed', { name: 'Аня', role: 'doctor' });
    assert.match(killed, /Аня/);
    assert.ok(!killed.includes('doctor') || lang === 'en', 'роль осталась непереведённой');
    assert.ok(!killed.includes('{'), `осталась незаполненная подстановка: ${killed}`);

    const anon = translate(lang, 'log.killed', { name: 'Аня', role: null });
    assert.ok(!anon.includes('('), 'роль показана, хотя её решили не открывать');

    const err = translate(lang, 'err.min_players', { min: 5, now: 3 });
    assert.match(err, /5/);
    assert.match(err, /3/);
    assert.ok(!err.includes('{'), `осталась незаполненная подстановка: ${err}`);
  }
});

test('числительные склоняются по-русски и по-английски', () => {
  assert.equal(translate('ru', 'common.players', 1), '1 игрок');
  assert.equal(translate('ru', 'common.players', 2), '2 игрока');
  assert.equal(translate('ru', 'common.players', 5), '5 игроков');
  assert.equal(translate('ru', 'common.players', 11), '11 игроков');
  assert.equal(translate('ru', 'common.players', 21), '21 игрок');

  assert.equal(translate('en', 'common.players', 1), '1 player');
  assert.equal(translate('en', 'common.players', 5), '5 players');
});

test('неизвестный ключ не роняет приложение', () => {
  assert.equal(translate('ru', 'нет.такого.ключа'), 'нет.такого.ключа');
  assert.equal(translate('xx', 'common.yes'), 'Да', 'неизвестный язык должен падать на русский');
});

test('в словарях не осталось русского текста на английской стороне', () => {
  const cyrillic = /[А-Яа-яЁё]/;
  const suspicious = [];

  for (const [key, value] of Object.entries(DICTS.en)) {
    if (typeof value === 'string' && cyrillic.test(value)) suspicious.push(key);
  }

  assert.deepEqual(suspicious, [], 'английский словарь содержит русские фразы');
});
