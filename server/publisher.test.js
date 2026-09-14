/**
 * Тесты расписания автопубликации.
 *
 * Часы поддельные: вместо ожидания суток прогоняем месяц за миллисекунды.
 * Главное, что проверяется, — пост не может выйти дважды.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Publisher, isDue, dayKey, daysBetween, scheduledTimeOn,
  emptyState, DEFAULT_SCHEDULE, channelNameFrom,
} from './publisher.js';
import { POSTS } from '../content/posts.js';

const SCHEDULE = { everyDays: 2, hourUtc: 8, minuteUtc: 0 };

const at = (iso) => Date.parse(iso);

/** Заглушка хранилища. */
function fakeStore() {
  return { data: {}, saves: 0, scheduleSave() { this.saves++; } };
}

/** Заглушка бота: запоминает отправленное, может изображать сбой. */
function fakeBot({ failTimes = 0 } = {}) {
  let fails = failTimes;
  const sent = [];
  const pinned = [];
  return {
    sent,
    pinned,
    api: {
      async sendMessage(chatId, text, opts) {
        if (fails > 0) {
          fails--;
          const err = new Error('Bad Request: chat not found');
          err.description = 'Bad Request: chat not found';
          throw err;
        }
        sent.push({ chatId, text, opts });
        return { message_id: sent.length };
      },
      async pinChatMessage(chatId, messageId) {
        pinned.push({ chatId, messageId });
      },
    },
  };
}

function makePublisher(opts = {}) {
  const store = fakeStore();
  const bot = fakeBot(opts.bot);
  const pub = new Publisher({
    bot,
    store,
    channelId: '@testchannel',
    playUrl: 'https://t.me/TestBot',
    schedule: SCHEDULE,
  });
  return { pub, bot, store };
}

// ─────────────────────────── имя канала ───────────────────────────

test('имя канала распознаётся в любой записи', () => {
  for (const raw of [
    'mafiaggame1',
    '@mafiaggame1',
    't.me/mafiaggame1',
    'https://t.me/mafiaggame1',
    'https://t.me/s/mafiaggame1',
    '  https://t.me/mafiaggame1  ',
  ]) {
    assert.equal(channelNameFrom(raw), 'mafiaggame1', `не разобрано: ${raw}`);
  }
});

test('ссылка-приглашение не считается именем канала', () => {
  // В приглашении вида t.me/+хеш публичного имени нет, адресатом оно быть не может
  assert.equal(channelNameFrom('https://t.me/+x72ElMltOccxNGIy'), null);
  assert.equal(channelNameFrom('t.me/+AbCdEf'), null);
});

test('мусор в имени канала отсекается', () => {
  for (const raw of ['', null, undefined, '   ', 'ab', 'имя-канала', 'https://example.com/x']) {
    assert.equal(channelNameFrom(raw), null, `should be null: ${raw}`);
  }
});

// ─────────────────────────── вспомогательные ───────────────────────────

test('день считается по UTC', () => {
  assert.equal(dayKey(at('2026-08-21T00:00:00Z')), '2026-08-21');
  assert.equal(dayKey(at('2026-08-21T23:59:59Z')), '2026-08-21');
});

test('разница в днях считается верно, включая переход через месяц', () => {
  assert.equal(daysBetween('2026-08-21', '2026-08-23'), 2);
  assert.equal(daysBetween('2026-08-31', '2026-09-01'), 1);
  assert.equal(daysBetween('2026-08-21', '2026-08-21'), 0);
});

test('время публикации берётся от текущих суток', () => {
  const t = scheduledTimeOn(at('2026-08-21T19:30:00Z'), SCHEDULE);
  assert.equal(new Date(t).toISOString(), '2026-08-21T08:00:00.000Z');
});

// ─────────────────────────── условие публикации ───────────────────────────

test('до назначенного часа не публикуем', () => {
  const state = emptyState();
  const v = isDue({ now: at('2026-08-21T07:59:00Z'), state, schedule: SCHEDULE, total: 5 });
  assert.equal(v.due, false);
  assert.match(v.reason, /время/);
});

test('в назначенный час публикуем', () => {
  const state = emptyState();
  assert.equal(isDue({ now: at('2026-08-21T08:00:00Z'), state, schedule: SCHEDULE, total: 5 }).due, true);
});

test('дважды за день не публикуем никогда', () => {
  const state = { ...emptyState(), lastDay: '2026-08-21', index: 1 };
  for (const time of ['08:00', '12:00', '23:59']) {
    const v = isDue({ now: at(`2026-08-21T${time}:00Z`), state, schedule: SCHEDULE, total: 5 });
    assert.equal(v.due, false, `опубликовали второй раз в ${time}`);
  }
});

test('интервал в два дня соблюдается', () => {
  const state = { ...emptyState(), lastDay: '2026-08-21', index: 1 };
  assert.equal(isDue({ now: at('2026-08-22T08:00:00Z'), state, schedule: SCHEDULE, total: 5 }).due, false);
  assert.equal(isDue({ now: at('2026-08-23T08:00:00Z'), state, schedule: SCHEDULE, total: 5 }).due, true);
});

test('пауза останавливает публикацию', () => {
  const state = { ...emptyState(), paused: true };
  assert.equal(isDue({ now: at('2026-08-21T08:00:00Z'), state, schedule: SCHEDULE, total: 5 }).due, false);
});

test('пустая очередь ничего не публикует', () => {
  const state = { ...emptyState(), index: 5 };
  assert.equal(isDue({ now: at('2026-08-21T08:00:00Z'), state, schedule: SCHEDULE, total: 5 }).due, false);
});

test('пропущенный день навёрстывается, а не теряется', () => {
  // Сервер лежал двое суток — первый же тик после подъёма должен опубликовать
  const state = { ...emptyState(), lastDay: '2026-08-21', index: 1 };
  assert.equal(isDue({ now: at('2026-08-25T15:00:00Z'), state, schedule: SCHEDULE, total: 5 }).due, true);
});

// ─────────────────────────── публикация ───────────────────────────

test('первый пост уходит в канал с кнопкой и закрепляется', async () => {
  const { pub, bot } = makePublisher();
  const res = await pub.tick(at('2026-08-21T08:00:00Z'));

  assert.equal(res.ok, true);
  assert.equal(bot.sent.length, 1);
  assert.equal(bot.sent[0].chatId, '@testchannel');
  assert.match(bot.sent[0].text, /Мафия теперь в Telegram/);
  assert.equal(bot.sent[0].opts.parse_mode, 'HTML');

  const button = bot.sent[0].opts.reply_markup.inline_keyboard[0][0];
  assert.equal(button.url, 'https://t.me/TestBot');

  assert.equal(bot.pinned.length, 1, 'анонс должен закрепляться');
});

test('перезапуск в тот же день не даёт дубля', async () => {
  const { pub, bot, store } = makePublisher();
  await pub.tick(at('2026-08-21T08:00:00Z'));
  assert.equal(bot.sent.length, 1);

  // Сервер перезапустился: состояние осталось в хранилище
  const revived = new Publisher({
    bot, store, channelId: '@testchannel',
    playUrl: 'https://t.me/TestBot', schedule: SCHEDULE,
  });

  for (const time of ['08:01', '09:00', '20:00']) {
    await revived.tick(at(`2026-08-21T${time}:00Z`));
  }
  assert.equal(bot.sent.length, 1, 'после перезапуска пост ушёл повторно');
});

test('за месяц выходит ровно по посту раз в два дня, без повторов', async () => {
  const { pub, bot } = makePublisher();

  // Тикаем каждый час целый месяц
  const start = at('2026-08-21T00:00:00Z');
  for (let h = 0; h < 24 * 31; h++) {
    await pub.tick(start + h * 3600000);
  }

  const expected = Math.min(POSTS.length, Math.ceil((31 - 1) / 2) + 1);
  assert.equal(bot.sent.length, expected, `ожидали ${expected} постов, вышло ${bot.sent.length}`);

  const texts = bot.sent.map((m) => m.text);
  assert.equal(new Set(texts).size, texts.length, 'один и тот же пост вышел дважды');

  // Порядок сохраняется
  assert.match(texts[0], /Мафия теперь в Telegram/);
  assert.match(texts[1], /Как играть в мафию/);
});

test('очередь не двигается, если Telegram вернул ошибку', async () => {
  const { pub, bot } = makePublisher({ bot: { failTimes: 1 } });

  const first = await pub.tick(at('2026-08-21T08:00:00Z'));
  assert.equal(first.ok, false);
  assert.equal(bot.sent.length, 0);
  assert.equal(pub.state().index, 0, 'пост потерялся при сбое');
  assert.equal(pub.state().lastDay, null);

  // Следующая попытка проходит, и уходит тот же самый пост
  const second = await pub.tick(at('2026-08-23T08:00:00Z'));
  assert.equal(second.ok, true);
  assert.match(bot.sent[0].text, /Мафия теперь в Telegram/);
});

test('свой пост встаёт в конец очереди', async () => {
  const { pub } = makePublisher();
  const before = pub.remaining();

  const res = pub.addPost('Привет, это <b>свой</b> пост');
  assert.equal(res.ok, true);
  assert.equal(pub.remaining(), before + 1);

  assert.equal(pub.addPost('   ').ok, false, 'пустой пост не должен приниматься');
  assert.equal(pub.addPost('x'.repeat(5000)).ok, false, 'слишком длинный пост не должен приниматься');
});

test('пауза и снятие паузы работают', async () => {
  const { pub, bot } = makePublisher();
  pub.setPaused(true);
  await pub.tick(at('2026-08-21T08:00:00Z'));
  assert.equal(bot.sent.length, 0);

  pub.setPaused(false);
  await pub.tick(at('2026-08-21T08:00:00Z'));
  assert.equal(bot.sent.length, 1);
});

test('без подключённого канала публикация молчит', async () => {
  const store = fakeStore();
  const bot = fakeBot();
  const pub = new Publisher({ bot, store, channelId: '', playUrl: 'x', schedule: SCHEDULE });

  assert.equal(pub.enabled, false);
  assert.equal(await pub.tick(at('2026-08-21T08:00:00Z')), null);
  assert.equal(bot.sent.length, 0);
});

// ─────────────────────────── содержание постов ───────────────────────────

test('посты пригодны для отправки в Telegram', () => {
  assert.ok(POSTS.length >= 10, 'запас постов должен быть хотя бы на месяц');

  const ids = POSTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'повторяющиеся id постов');

  for (const post of POSTS) {
    assert.ok(post.title, `у поста ${post.id} нет названия`);
    assert.ok(post.text.trim().length > 0, `пост ${post.id} пустой`);
    assert.ok(post.text.length <= 4096, `пост ${post.id} длиннее лимита Telegram`);

    // Разметка должна быть парной, иначе Telegram отклонит сообщение целиком
    for (const tag of ['b', 'i', 'u', 's', 'code']) {
      const open = (post.text.match(new RegExp(`<${tag}>`, 'g')) || []).length;
      const close = (post.text.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(open, close, `в посте ${post.id} непарный тег <${tag}>`);
    }
  }
});

test('расписание по умолчанию — раз в два дня в полдень по Самаре', () => {
  assert.equal(DEFAULT_SCHEDULE.everyDays, 2);
  // 08:00 UTC = 12:00 при смещении +4
  assert.equal(DEFAULT_SCHEDULE.hourUtc + 4, 12);
});
