/**
 * Точка входа: HTTP + WebSocket сервер и подключение бота.
 *
 * Один процесс раздаёт и мини-апп (собранная статика), и игровой сокет,
 * и принимает вебхук Telegram. Так проще всего деплоить: один сервис.
 */

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';

import { RoomManager } from './rooms.js';
import { Store } from './store.js';
import { verifyInitData, devUser } from './auth.js';
import { Profiles } from './profile.js';
import { webhookCallback } from 'grammy';
import { buildBot, buildChannelBot, registerChannelCommands, RULES_TEXT } from './bot.js';
import { Publisher, channelNameFrom } from './publisher.js';
import { MIN_PLAYERS, MAX_PLAYERS, DEFAULT_SETTINGS, sanitizeSettings } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Версия видна в /health и /api/config — по ней сразу понятно,
// какой код реально работает на сервере, без гаданий по логам.
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const BOT_MODE = (process.env.BOT_MODE || 'webhook').toLowerCase();
const BOT_USERNAME = (process.env.BOT_USERNAME || '').replace(/^@/, '');
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const ALLOW_DEV_AUTH = String(process.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true';

// Сколько игроков за столом в игре с ботами: сам человек и боты в придачу.
// Семь — состав с двумя мафиями, доктором и комиссаром: партия уже
// не вырождается в угадайку, но и не тянется слишком долго.
const SOLO_PLAYERS = Math.min(
  MAX_PLAYERS,
  Math.max(MIN_PLAYERS, Number(process.env.SOLO_PLAYERS) || 7),
);

// Ссылка на канал для кнопки «Подписаться» в игре.
const CHANNEL_URL = (() => {
  const raw = (process.env.CHANNEL_URL || process.env.CHANNEL_USERNAME || '').trim();
  if (!raw) return null;
  const name = channelNameFrom(raw);
  if (name) return `https://t.me/${name}`;
  // Приглашение в приватный канал оставляем как есть — как ссылка оно рабочее
  return /^https?:\/\//i.test(raw) ? raw : null;
})();

// Куда публиковать. Telegram принимает либо «@имя» публичного канала,
// либо числовой id вида -1001234567890 (единственный вариант для приватного:
// ссылка-приглашение в качестве адресата не годится).
const CHANNEL_ID = (() => {
  const raw = (process.env.CHANNEL_ID || '').trim();
  if (/^-?\d+$/.test(raw)) return raw;

  const name = channelNameFrom(raw) || channelNameFrom(process.env.CHANNEL_URL);
  if (name) return `@${name}`;

  if (raw) {
    console.warn(`[канал] не удалось понять CHANNEL_ID: «${raw}»`);
    console.warn('[канал] укажите @имя публичного канала или числовой id вида -1001234567890');
  }
  return '';
})();

// Токен отдельного бота для канала. Если не задан, каналом занимается
// игровой бот — так проще, но посты выходят от его имени.
const CHANNEL_BOT_TOKEN = (process.env.CHANNEL_BOT_TOKEN || '').trim();

const POST_EVERY_DAYS = Math.max(1, Number(process.env.POST_EVERY_DAYS || 2));
const POST_HOUR_UTC = Math.min(23, Math.max(0, Number(process.env.POST_HOUR_UTC ?? 8)));
const DB_PATH = path.resolve(ROOT, process.env.DB_PATH || './data/stats.json');

// Railway/Render отдают домен в своих переменных — подхватим автоматически
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`
).replace(/\/+$/, '');

if (!BOT_TOKEN) {
  console.error('\n❌ Не задан BOT_TOKEN. Скопируйте .env.example в .env и вставьте токен от @BotFather.\n');
  process.exit(1);
}

const store = new Store(DB_PATH);
const rooms = new RoomManager({ store });
const profiles = new Profiles();

const app = Fastify({ logger: false, trustProxy: true });
await app.register(fastifyWebsocket, {
  // Фото профиля приезжает через сокет: до ~140 КБ в base64
  options: { maxPayload: 256 * 1024 },
});

// ─────────────────────────── HTTP ───────────────────────────

app.get('/health', async () => ({
  ok: true,
  version: VERSION,
  uptime: Math.round(process.uptime()),
  ...rooms.stats(),
}));

app.get('/api/config', async () => ({
  version: VERSION,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  defaults: DEFAULT_SETTINGS,
  botUsername: BOT_USERNAME || null,
  appShortName: APP_SHORT_NAME || null,
  channelUrl: CHANNEL_URL,
}));

// Фото из удостоверений. В адресе хеш содержимого, поэтому ответ можно
// кешировать навсегда: новое фото — это новый адрес.
app.get('/api/photo/:file', async (req, reply) => {
  const file = String(req.params.file || '');
  const bytes = /^[0-9a-f]{24}[.]jpg$/.test(file) ? profiles.photo(file.slice(0, 24)) : null;
  if (!bytes) return reply.code(404).send({ error: 'not found' });
  return reply
    .header('Cache-Control', 'public, max-age=31536000, immutable')
    // Картинку прислал игрок: запрещаем браузеру угадывать тип и что-либо исполнять
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .type('image/jpeg')
    .send(bytes);
});

// ─────────────────────────── WebSocket ───────────────────────────

/**
 * Протокол намеренно простой: клиент шлёт {t: 'действие', ...},
 * сервер в ответ рассылает всей комнате персональные снимки состояния.
 */
app.register(async (instance) => {
  instance.get('/ws', { websocket: true }, (socket) => {
    let user = null; // как игрок записан в Telegram
    let roomCode = null;
    let alive = true;
    let lastProfileAt = 0;

    // Как игрок выглядит за столом: имя и фото из его удостоверения
    const me = () => profiles.identity(user);

    // fatal — клиенту не нужно переподключаться, проблема не во связи
    const fail = (code, params = null, fatal = false) => {
      send({ t: fatal ? 'fatal' : 'error', code, params });
      if (fatal) setTimeout(() => socket.close(), 50);
    };

    const send = (payload) => {
      if (socket.readyState !== 1) return;
      try {
        socket.send(JSON.stringify(payload));
      } catch { /* соединение закрылось */ }
    };

    const currentRoom = () => (roomCode ? rooms.getRoom(roomCode) : null);

    const enterRoom = (room, rejoined) => {
      roomCode = room.game.code;
      rooms.attachSocket(room, user.id, socket);
      if (!user.isDev) store.touch(user.id, me().name);
      send({ t: 'joined', code: room.game.code, rejoined: !!rejoined });
      rooms.broadcast(room);
      // Не ждём отправки: если Telegram ответит с задержкой, игра не должна тормозить
      ensureRulesPinned(me()).catch(() => {});
    };

    // Пинги, чтобы мобильный Telegram не рвал соединение молча
    const ping = setInterval(() => {
      if (!alive) {
        clearInterval(ping);
        socket.terminate?.();
        return;
      }
      alive = false;
      try { socket.ping?.(); } catch { /* нет ping в этой реализации */ }
      send({ t: 'ping', at: Date.now() });
    }, 25000);
    ping.unref?.();

    socket.on('pong', () => { alive = true; });

    socket.on('message', (raw) => {
      alive = true;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return fail('bad_request');
      }
      if (!msg || typeof msg.t !== 'string') return fail('bad_request');

      // ── авторизация должна пройти первой ──
      if (msg.t === 'auth') {
        if (user) return; // уже авторизованы
        const res = verifyInitData(msg.initData, BOT_TOKEN);
        if (res.ok) {
          user = res.user;
        } else if (ALLOW_DEV_AUTH && msg.dev) {
          user = devUser(msg.dev);
          console.warn(`[auth] вход в режиме отладки: ${user.name} (${user.id})`);
        } else {
          return fail(res.code, null, true);
        }
        // Профиль с устройства: сервер мог перезапуститься и забыть его.
        // Негодный профиль вход не ломает — игрок просто зайдёт без него.
        if (msg.profile) profiles.save(user.id, msg.profile);
        send({
          t: 'auth_ok',
          user: me(),
          stats: store.statsFor(user.id),
          profile: profiles.ownerView(user.id),
        });

        // Автовход по коду из ссылки или из start_param
        const auto = (msg.code || res.startParam || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (auto) {
          const join = rooms.joinRoom(me(), auto);
          if (join.ok) enterRoom(rooms.getRoom(auto), join.rejoined);
          else send({ t: 'join_failed', reason: join.code, room: auto });
        }
        return;
      }

      if (!user) return fail('auth_required', null, true);

      switch (msg.t) {
        case 'pong':
          alive = true;
          return;

        case 'create': {
          if (currentRoom()) rooms.leaveRoom(user.id, roomCode);
          const { code } = rooms.createRoom(me(), sanitizeSettings(msg.settings));
          enterRoom(rooms.getRoom(code), false);
          return;
        }

        // Игра с ботами: комната, стол и старт — одной кнопкой
        case 'play_bots': {
          if (currentRoom()) rooms.leaveRoom(user.id, roomCode);
          const wanted = Number(msg.players);
          const res = rooms.createSoloRoom(me(), {
            players: Number.isFinite(wanted) ? wanted : SOLO_PLAYERS,
            settings: sanitizeSettings(msg.settings),
          });
          if (!res.ok) return fail(res.code, res.params);
          enterRoom(rooms.getRoom(res.code), false);
          return;
        }

        case 'join': {
          const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (code.length < 4) return fail('bad_code');
          const res = rooms.joinRoom(me(), code);
          if (!res.ok) return fail(res.code, res.params);
          enterRoom(rooms.getRoom(code), res.rejoined);
          return;
        }

        // Удостоверение: имя, фамилия, возраст, пол и фото
        case 'profile': {
          const now = Date.now();
          if (now - lastProfileAt < 1000) return fail('profile_too_often');
          lastProfileAt = now;

          const res = profiles.save(user.id, msg.profile, { force: true, now });
          if (!res.ok) return fail(res.code, res.params);

          const identity = me();
          const room = currentRoom();
          let deferred = false;
          if (room) {
            deferred = !!room.game.setIdentity(user.id, identity).deferred;
            rooms.broadcast(room);
          }
          if (!user.isDev) store.touch(user.id, identity.name);
          send({ t: 'profile_ok', user: identity, profile: profiles.ownerView(user.id), deferred });
          return;
        }

        case 'rooms':
          send({ t: 'rooms', list: rooms.publicRooms() });
          return;

        case 'leave': {
          const room = currentRoom();
          if (room) {
            rooms.detachSocket(room, user.id, socket);
            rooms.leaveRoom(user.id, roomCode);
          }
          roomCode = null;
          send({ t: 'left' });
          return;
        }

        default:
          break;
      }

      // ── дальше всё требует комнаты ──
      const room = currentRoom();
      if (!room) return fail('not_in_room');
      const game = room.game;

      const apply = (res) => {
        if (!res?.ok) return fail(res?.code || 'action_unavailable', res?.params);
        rooms.broadcast(room);
      };

      switch (msg.t) {
        case 'settings':
          return apply(game.updateSettings(user.id, sanitizeSettings(msg.settings)));

        case 'kick':
          return apply(game.kick(user.id, Number(msg.userId)));

        case 'add_bot':
          return apply(game.addBot(user.id));

        case 'remove_bot':
          return apply(game.removeBot(user.id, msg.userId ?? null));

        case 'start':
          return apply(game.start(user.id));

        case 'restart':
          return apply(game.restart(user.id));

        case 'host_next':
          return apply(game.hostNext(user.id));

        case 'night_action':
          return apply(game.submitNightAction(user.id, Number(msg.target)));

        case 'vote':
          return apply(game.submitVote(user.id, msg.target === null ? null : Number(msg.target)));

        case 'ready':
          return apply(game.setReady(user.id, msg.value !== false));

        case 'chat': {
          const res = game.addChat(user.id, msg.text);
          if (!res.ok) return fail(res.code, res.params);
          rooms.broadcast(room);
          return;
        }

        default:
          return fail('unknown_action');
      }
    });

    socket.on('close', () => {
      clearInterval(ping);
      const room = currentRoom();
      if (room && user) rooms.detachSocket(room, user.id, socket);
    });

    socket.on('error', () => {
      clearInterval(ping);
    });
  });
});

/**
 * При первом входе в комнату присылаем игроку правила в личку и закрепляем их.
 * Дальше они всегда под рукой — не нужно искать, кто что умеет, посреди партии.
 * Шлём один раз на игрока: отметка живёт в статистике.
 */
async function ensureRulesPinned(user) {
  if (!user || user.isDev) return; // отладочного игрока в Telegram не существует
  const record = store.user(user.id);
  if (record.rulesPinned) return;

  try {
    const msg = await bot.api.sendMessage(user.id, RULES_TEXT, {
      parse_mode: 'Markdown',
      disable_notification: true,
    });
    // Закрепление может не сработать на старых клиентах — сообщение всё равно доставлено
    await bot.api
      .pinChatMessage(user.id, msg.message_id, { disable_notification: true })
      .catch(() => {});
    record.rulesPinned = true;
    record.name = user.name;
    store.scheduleSave();
  } catch {
    // Игрок ещё не нажимал Start у бота — писать ему нельзя.
    // Отметку не ставим: попробуем при следующем входе.
  }
}

// ─────────────────────────── бот ───────────────────────────

// Владелец — тот, кто указан в OWNER_ID, либо администратор канала.
// Второе избавляет от необходимости узнавать свой числовой id вручную.
const OWNER_ID = Number(process.env.OWNER_ID || 0);

async function isOwner(userId) {
  if (OWNER_ID && Number(userId) === OWNER_ID) return true;
  if (!CHANNEL_ID) return false;
  try {
    const member = await publisherBot.api.getChatMember(CHANNEL_ID, userId);
    return member.status === 'creator' || member.status === 'administrator';
  } catch {
    return false;
  }
}

const { bot, configure } = buildBot({
  token: BOT_TOKEN,
  publicUrl: PUBLIC_URL,
  botUsername: BOT_USERNAME,
  appShortName: APP_SHORT_NAME,
  channelUrl: CHANNEL_URL,
  store,
  isOwner,
});

// ─────────────────────────── автопубликация в канал ───────────────────────────

const PLAY_URL = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}` : PUBLIC_URL;

// Канал ведёт отдельный бот, если для него задан токен. Иначе — игровой.
const channelBot = CHANNEL_BOT_TOKEN && CHANNEL_BOT_TOKEN !== BOT_TOKEN
  ? buildChannelBot({ token: CHANNEL_BOT_TOKEN, channelUrl: CHANNEL_URL, playUrl: PLAY_URL })
  : null;

const publisherBot = channelBot ? channelBot.bot : bot;

const publisher = new Publisher({
  bot: publisherBot,
  store,
  channelId: CHANNEL_ID,
  playUrl: PLAY_URL,
  schedule: { everyDays: POST_EVERY_DAYS, hourUtc: POST_HOUR_UTC, minuteUtc: 0 },
});

registerChannelCommands({ bot: publisherBot, publisher, channelId: CHANNEL_ID });

if (publisher.enabled) {
  // Проверяем раз в минуту: точность до минуты для постов более чем достаточна
  const postTimer = setInterval(() => {
    publisher.tick().catch((err) => console.error('[канал] сбой публикации:', err?.message || err));
  }, 60_000);
  postTimer.unref?.();
}

const WEBHOOK_PATH = `/webhook/${WEBHOOK_SECRET || 'telegram'}`;
const CHANNEL_WEBHOOK_PATH = `${WEBHOOK_PATH}/channel`;

if (BOT_MODE === 'webhook') {
  const options = { secretToken: WEBHOOK_SECRET || undefined };
  app.post(WEBHOOK_PATH, webhookCallback(bot, 'fastify', options));
  // У второго бота свой адрес — иначе Telegram не разберёт, кому что слать
  if (channelBot) {
    app.post(CHANNEL_WEBHOOK_PATH, webhookCallback(channelBot.bot, 'fastify', options));
  }
}

// ─────────────────────────── статика мини-аппа ───────────────────────────

const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  // index обязателен: без него запрос на «/» упирается в каталог,
  // и @fastify/static отвечает 403 вместо страницы приложения
  await app.register(fastifyStatic, { root: distDir, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/webhook') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.type('text/html').sendFile('index.html');
  });
} else {
  console.warn('[server] папка dist не найдена — запустите `npm run build`');
  app.get('/', async (_req, reply) => reply
    .type('text/html')
    .send('<h1>Мини-апп не собран</h1><p>Выполните <code>npm run build</code>.</p>'));
}

// ─────────────────────────── запуск ───────────────────────────

await app.listen({ port: PORT, host: HOST });
console.log(`[server] версия ${VERSION}`);
if (!store.persistent) {
  console.warn(`[store] статистика лежит в ${DB_PATH} — внутри папки приложения.`);
  console.warn('[store] она обнулится при следующем деплое. Подключите том и задайте DB_PATH внутрь него.');
}
console.log(`[server] слушает ${HOST}:${PORT}`);
console.log(`[server] публичный адрес: ${PUBLIC_URL}`);

if (ALLOW_DEV_AUTH) {
  console.warn('[server] ⚠ ВКЛЮЧЁН РЕЖИМ ОТЛАДКИ (ALLOW_DEV_AUTH=true).');
  console.warn('[server] ⚠ Войти можно без Telegram, зная ключ. Выключите его после тестов!');
}

await configure();
if (channelBot) await channelBot.configure();

if (publisher.enabled) {
  console.log(`[канал] посты публикует ${channelBot ? 'отдельный бот канала' : 'игровой бот'}`);
  console.log(`[канал] автопубликация в ${CHANNEL_ID}: раз в ${POST_EVERY_DAYS} дн. в ${POST_HOUR_UTC}:00 UTC`);
  console.log(`[канал] постов в очереди: ${publisher.remaining()}, следующий выход: ${publisher.nextRunDescription()}`);
} else {
  console.log('[канал] автопубликация выключена — не задана переменная CHANNEL_ID');
}

if (BOT_MODE === 'webhook') {
  const install = async (target, path, label) => {
    const url = `${PUBLIC_URL}${path}`;
    try {
      await target.api.setWebhook(url, {
        secret_token: WEBHOOK_SECRET || undefined,
        allowed_updates: ['message', 'callback_query', 'inline_query'],
        drop_pending_updates: true,
      });
      console.log(`[${label}] вебхук установлен: ${url}`);
    } catch (err) {
      console.error(`[${label}] не удалось установить вебхук:`, err.message);
    }
  };

  await install(bot, WEBHOOK_PATH, 'bot');
  if (channelBot) await install(channelBot.bot, CHANNEL_WEBHOOK_PATH, 'канал-бот');
} else {
  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
  bot.start({ drop_pending_updates: true, onStart: () => console.log('[bot] запущен в режиме polling') });
  if (channelBot) {
    await channelBot.bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    channelBot.bot.start({ drop_pending_updates: true, onStart: () => console.log('[канал-бот] запущен в режиме polling') });
  }
}

// ─────────────────────────── корректное завершение ───────────────────────────

let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] получен ${sig}, завершаюсь…`);
    store.flush();
    rooms.stop();
    if (BOT_MODE !== 'webhook') {
      await bot.stop().catch(() => {});
      if (channelBot) await channelBot.bot.stop().catch(() => {});
    }
    await app.close().catch(() => {});
    process.exit(0);
  });
}

process.on('unhandledRejection', (err) => {
  console.error('[server] необработанная ошибка:', err);
});
