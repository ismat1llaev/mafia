/**
 * Менеджер комнат: связывает игровой движок с WebSocket-соединениями.
 *
 * Одна комната = одна партия. Игрок опознаётся по Telegram id, поэтому
 * при обрыве связи он возвращается на своё место, а не выбывает.
 */

import { Game, PHASE, MIN_PLAYERS } from './game.js';
import { runBots } from './bots.js';

// Без похожих друг на друга символов (0/O, 1/I), чтобы код легко диктовать голосом
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;

const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000; // пустая комната живёт 10 минут
const FINISHED_ROOM_TTL_MS = 30 * 60 * 1000;

// Сколько ждём возвращения игрока, который пропал из лобби.
// Блокировка экрана, звонок, переключение приложений — всё это рвёт
// соединение на секунды, и выкидывать за это из комнаты нельзя.
const LOBBY_GRACE_MS = 3 * 60 * 1000;

export class RoomManager {
  constructor({ store, onGameEnd } = {}) {
    this.rooms = new Map(); // code -> {game, sockets: Map<userId, Set<ws>>, createdAt, emptySince}
    this.userRoom = new Map(); // userId -> code
    this.store = store;
    this.onGameEnd = onGameEnd;
    this.interval = setInterval(() => this.tickAll(), 1000);
    this.interval.unref?.();
  }

  stop() {
    clearInterval(this.interval);
  }

  generateCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LEN; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // крайне маловероятно, но пусть будет запасной вариант
    return `${Date.now().toString(36).toUpperCase().slice(-5)}`;
  }

  createRoom(user, settings) {
    const code = this.generateCode();
    const game = new Game({ code, hostId: user.id, settings });
    game.addPlayer(user);
    this.rooms.set(code, {
      game,
      sockets: new Map(),
      createdAt: Date.now(),
      emptySince: null,
      ended: false,
    });
    this.userRoom.set(user.id, code);
    return { ok: true, code, game };
  }

  /**
   * Комната для игры с ботами: человек один, остальные места занимают боты,
   * партия стартует сразу. В общий список такие комнаты не попадают —
   * заходить в чужую одиночную игру незачем.
   */
  createSoloRoom(user, { players = 7, settings = {} } = {}) {
    const { code, game } = this.createRoom(user, {
      ...settings,
      isPublic: false,
      hostMode: 'bot',
    });
    game.fillWithBots(players);
    const started = game.start(user.id);
    if (!started.ok) {
      // Стол собрать не удалось — комната не нужна. Без этого клиент с
      // испорченными настройками (например, maxPlayers меньше минимума)
      // оставлял бы за собой пустые комнаты до истечения их срока.
      this.rooms.delete(code);
      this.userRoom.delete(user.id);
      return { ok: false, ...started };
    }
    return { ok: true, code, game };
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(String(code).toUpperCase().trim()) || null;
  }

  joinRoom(user, code) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, code: 'room_not_found' };

    // Если игрок числится в другой комнате — выпускаем его оттуда
    const prev = this.userRoom.get(user.id);
    if (prev && prev !== room.game.code) {
      this.leaveRoom(user.id, prev);
    }

    const res = room.game.addPlayer(user);
    if (!res.ok) return res;
    this.userRoom.set(user.id, room.game.code);
    room.emptySince = null;
    this.broadcast(room);
    return { ok: true, code: room.game.code, game: room.game, rejoined: res.rejoined };
  }

  leaveRoom(userId, code = this.userRoom.get(userId)) {
    const room = this.getRoom(code);
    if (!room) return;
    room.game.removePlayer(userId);
    room.sockets.delete(userId);
    this.userRoom.delete(userId);
    if (room.game.players.length === 0) {
      room.emptySince = Date.now();
    }
    this.broadcast(room);
  }

  attachSocket(room, userId, ws) {
    if (!room.sockets.has(userId)) room.sockets.set(userId, new Set());
    room.sockets.get(userId).add(ws);
    room.game.setConnected(userId, true);
    room.emptySince = null;
  }

  detachSocket(room, userId, ws) {
    const set = room.sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      room.sockets.delete(userId);
      // Место в комнате сохраняем: на телефоне связь рвётся от любой
      // блокировки экрана, и игрок должен вернуться туда же, а не в меню.
      // Окончательно убираем только из лобби и только через LOBBY_GRACE_MS.
      room.game.setConnected(userId, false);
      if (room.sockets.size === 0) room.emptySince = Date.now();
      this.broadcast(room);
    }
  }

  send(ws, payload) {
    if (ws.readyState !== 1) return; // 1 === OPEN
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* соединение уже разорвано */
    }
  }

  /** Разослать всем участникам комнаты их персональный вид состояния. */
  broadcast(room) {
    const now = Date.now();
    for (const [userId, sockets] of room.sockets) {
      const view = room.game.viewFor(userId, now);
      for (const ws of sockets) this.send(ws, { t: 'state', state: view });
    }
  }

  sendTo(room, userId, payload) {
    const sockets = room.sockets.get(userId);
    if (!sockets) return;
    for (const ws of sockets) this.send(ws, payload);
  }

  /** Раз в секунду: двигаем таймеры фаз и подчищаем мёртвые комнаты. */
  tickAll() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      let changed = false;

      // Боты ходят до тика: сходивший бот может закрыть фазу досрочно,
      // и тогда партия двинется дальше в этом же такте, а не через секунду.
      if (runBots(room.game, now)) changed = true;

      // Одного тика может не хватить: фаза может закончиться мгновенно
      // (например, все проголосовали ровно в момент истечения таймера).
      for (let guard = 0; guard < 5; guard++) {
        if (!room.game.tick(now)) break;
        changed = true;
      }

      if (room.game.phase === PHASE.ENDED && !room.ended) {
        room.ended = true;
        changed = true;
        try {
          this.store?.recordGame(room.game);
          this.onGameEnd?.(room.game);
        } catch (err) {
          console.error('[rooms] ошибка при записи итогов:', err.message);
        }
      }
      if (room.game.phase !== PHASE.ENDED) room.ended = false;

      // Кто не вернулся за отведённое время — освобождает место в лобби
      const dropped = room.game.dropStale(now, LOBBY_GRACE_MS);
      for (const id of dropped) {
        if (this.userRoom.get(id) === code) this.userRoom.delete(id);
      }
      if (dropped.length) changed = true;

      if (changed) this.broadcast(room);

      // Уборка
      const idleFor = room.emptySince ? now - room.emptySince : 0;
      const ttl = room.game.phase === PHASE.ENDED ? FINISHED_ROOM_TTL_MS : EMPTY_ROOM_TTL_MS;
      if (room.sockets.size === 0 && room.emptySince && idleFor > ttl) {
        for (const p of room.game.players) this.userRoom.delete(p.id);
        this.rooms.delete(code);
      }
    }
  }

  /**
   * Комнаты, куда можно зайти прямо сейчас.
   *
   * Показываем только те, что ещё в лобби, помечены открытыми и не заполнены.
   * Первыми идут почти собранные — им не хватает буквально пары человек,
   * и присоединившийся начнёт играть быстрее всего.
   */
  publicRooms(limit = 20) {
    const list = [];

    for (const room of this.rooms.values()) {
      const game = room.game;
      if (game.phase !== PHASE.LOBBY) continue;
      if (!game.settings.isPublic) continue;
      if (room.sockets.size === 0) continue; // покинутая комната никому не нужна

      const players = game.playing.length;
      const maxPlayers = game.settings.maxPlayers;
      if (players >= maxPlayers) continue;

      const host = game.player(game.hostId);
      list.push({
        code: game.code,
        players,
        maxPlayers,
        minPlayers: MIN_PLAYERS,
        needed: Math.max(0, MIN_PLAYERS - players),
        hostName: host?.name || null,
        hostMode: game.settings.hostMode,
        bots: game.bots.length,
        useDoctor: !!game.settings.useDoctor,
        useSheriff: !!game.settings.useSheriff,
        createdAt: room.createdAt,
      });
    }

    list.sort((a, b) => b.players - a.players || b.createdAt - a.createdAt);
    return list.slice(0, limit);
  }

  stats() {
    return {
      rooms: this.rooms.size,
      players: [...this.rooms.values()].reduce((acc, r) => acc + r.sockets.size, 0),
    };
  }
}
