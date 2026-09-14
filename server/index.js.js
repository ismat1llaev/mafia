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
import { buildBot } from './bot.js';
import { MIN_PLAYERS, MAX_PLAYERS, DEFAULT_SETTINGS } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const BOT_MODE = (process.env.BOT_MODE || 'webhook').toLowerCase();
const BOT_USERNAME = (process.env.BOT_USERNAME || '').replace(/^@/, '');
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const ALLOW_DEV_AUTH = String(process.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true';
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

const app = Fastify({ logger: false, trustProxy: true });
await app.register(fastifyWebsocket, {
  options: { maxPayload: 64 * 1024 },
});

// ─────────────────────────── HTTP ───────────────────────────

app.get('/health', async () => ({
  ok: true,
  uptime: Math.round(process.uptime()),
  ...rooms.stats(),
}));

app.get('/api/config', async () => ({
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  defaults: DEFAULT_SETTINGS,
  botUsername: BOT_USERNAME || null,
  appShortName: APP_SHORT_NAME || null,
}));

// ─────────────────────────── WebSocket ───────────────────────────

/**
 * Протокол намеренно простой: клиент шлёт {t: 'действие', ...},
 * сервер в ответ рассылает всей комнате персональные снимки состояния.
 */
app.register(async (instance) => {
  instance.get('/ws', { websocket: true }, (socket) => {
    let user = null;
    let roomCode = null;
    let alive = true;

    // fatal — клиенту не нужно переподключаться, проблема не во связи
    const fail = (message, fatal = false) => {
      send({ t: fatal ? 'fatal' : 'error', message });
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
      send({ t: 'joined', code: room.game.code, rejoined: !!rejoined });
      rooms.broadcast(room);
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
        return fail('Некорректный запрос.');
      }
      if (!msg || typeof msg.t !== 'string') return fail('Некорректный запрос.');

      // ── авторизация должна пройти первой ──
      if (msg.t === 'auth') {
        if (user) return; // уже авторизованы
        const res = verifyInitData(msg.initData, BOT_TOKEN);
        if (res.ok) {
          user = res.user;
        } else if (ALLOW_DEV_AUTH && msg.dev) {
          user = devUser(msg.dev);
        } else {
          return fail(res.error, true);
        }
        send({ t: 'auth_ok', user, stats: store.statsFor(user.id) });

        // Автовход по коду из ссылки или из start_param
        const auto = (msg.code || res.startParam || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (auto) {
          const join = rooms.joinRoom(user, auto);
          if (join.ok) enterRoom(rooms.getRoom(auto), join.rejoined);
          else send({ t: 'join_failed', message: join.error, code: auto });
        }
        return;
      }

      if (!user) return fail('Сначала авторизация.', true);

      switch (msg.t) {
        case 'pong':
          alive = true;
          return;

        case 'create': {
          if (currentRoom()) rooms.leaveRoom(user.id, roomCode);
          const { code } = rooms.createRoom(user, sanitizeSettings(msg.settings));
          enterRoom(rooms.getRoom(code), false);
          return;
        }

        case 'join': {
          const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (code.length < 4) return fail('Код должен состоять из 5 символов.');
          const res = rooms.joinRoom(user, code);
          if (!res.ok) return fail(res.error);
          enterRoom(rooms.getRoom(code), res.rejoined);
          return;
        }

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
      if (!room) return fail('Вы не в комнате.');
      const game = room.game;

      const apply = (res) => {
        if (!res?.ok) return fail(res?.error || 'Действие недоступно.');
        rooms.broadcast(room);
      };

      switch (msg.t) {
        case 'settings':
          return apply(game.updateSettings(user.id, sanitizeSettings(msg.settings)));

        case 'kick':
          return apply(game.kick(user.id, Number(msg.userId)));

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
          if (!res.ok) return fail(res.error);
          rooms.broadcast(room);
          return;
        }

        default:
          return fail('Неизвестное действие.');
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

function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  const keys = ['hostMode', 'maxPlayers', 'nightSec', 'discussionSec', 'voteSec', 'revoteSec', 'tieRule', 'revealRoleOnDeath'];
  for (const k of keys) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

// ─────────────────────────── бот ───────────────────────────

const { bot, configure } = buildBot({
  token: BOT_TOKEN,
  publicUrl: PUBLIC_URL,
  botUsername: BOT_USERNAME,
  appShortName: APP_SHORT_NAME,
  store,
});

if (BOT_MODE === 'webhook') {
  const { webhookCallback } = await import('grammy');
  const handler = webhookCallback(bot, 'fastify', {
    secretToken: WEBHOOK_SECRET || undefined,
  });
  app.post(`/webhook/${WEBHOOK_SECRET || 'telegram'}`, handler);
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
console.log(`[server] слушает ${HOST}:${PORT}`);
console.log(`[server] публичный адрес: ${PUBLIC_URL}`);

await configure();

if (BOT_MODE === 'webhook') {
  const url = `${PUBLIC_URL}/webhook/${WEBHOOK_SECRET || 'telegram'}`;
  try {
    await bot.api.setWebhook(url, {
      secret_token: WEBHOOK_SECRET || undefined,
      allowed_updates: ['message', 'callback_query', 'inline_query'],
      drop_pending_updates: true,
    });
    console.log(`[bot] вебхук установлен: ${url}`);
  } catch (err) {
    console.error('[bot] не удалось установить вебхук:', err.message);
  }
} else {
  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
  bot.start({ drop_pending_updates: true, onStart: () => console.log('[bot] запущен в режиме polling') });
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
    if (BOT_MODE !== 'webhook') await bot.stop().catch(() => {});
    await app.close().catch(() => {});
    process.exit(0);
  });
}

process.on('unhandledRejection', (err) => {
  console.error('[server] необработанная ошибка:', err);
});
