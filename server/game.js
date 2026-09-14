/**
 * Игровой движок «Мафия».
 *
 * Полностью детерминированный и не зависящий от сети: движок ничего не знает
 * ни про WebSocket, ни про Telegram. Наружу он отдаёт только состояние, а время
 * получает через параметр `now`, поэтому его удобно тестировать симуляциями.
 *
 * Роли первой версии: мафия, комиссар, мирный житель.
 */

export const ROLE = {
  CIVILIAN: 'civilian',
  MAFIA: 'mafia',
  SHERIFF: 'sheriff',
  DOCTOR: 'doctor',
};

export const PHASE = {
  LOBBY: 'lobby',
  ROLES: 'roles',
  NIGHT: 'night',
  DAY: 'day',
  DISCUSSION: 'discussion',
  VOTING: 'voting',
  REVOTE: 'revote',
  VERDICT: 'verdict',
  ENDED: 'ended',
};

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;

/**
 * Имена ботов. Держим их здесь, а не в bots.js: список мест за столом —
 * дело движка, а bots.js занимается только тем, что бот решит на своём ходу.
 * Обратный порядок зависимостей развёл бы модули по кругу.
 */
export const BOT_NAMES = [
  'Артём', 'Вика', 'Данил', 'Женя', 'Захар', 'Ирина', 'Кирилл', 'Лена',
  'Марк', 'Настя', 'Олег', 'Полина', 'Рома', 'Соня', 'Тимур', 'Юля',
];

/** У людей Telegram id всегда положительный, поэтому боты живут в минусе. */
export function isBotId(id) {
  return Number(id) < 0;
}

export const DEFAULT_SETTINGS = {
  hostMode: 'bot', // 'bot' — ведёт бот, 'human' — ведёт создатель комнаты
  useDoctor: true, // доктор в игре по умолчанию
  useSheriff: false, // комиссар — по желанию комнаты
  isPublic: true, // комната видна в списке открытых на главной
  maxPlayers: 8,
  nightSec: 45,
  discussionSec: 180,
  voteSec: 60,
  revoteSec: 30,
  tieRule: 'revote', // 'revote' | 'nobody' | 'random'
  revealRoleOnDeath: true,
};

// Длительность коротких «объявляющих» фаз, их не настраивают
const ROLES_SEC = 10;
const DAY_SEC = 8;
const VERDICT_SEC = 8;

/** Сколько мафии на N игроков. 5→1, 6→2, 8→2, 9→3, 12→4. */
export function mafiaCountFor(n) {
  return Math.max(1, Math.floor(n / 3));
}

/**
 * Состав ролей для N играющих (ведущий-человек сюда не входит).
 *
 * Особые роли включаются настройками комнаты. Если на них не хватает людей,
 * лишние отключаются — мирных должен остаться хотя бы один, иначе играть не во что.
 */
export function roleComposition(n, settings = {}) {
  const mafia = mafiaCountFor(n);
  let sheriff = (settings.useSheriff ?? DEFAULT_SETTINGS.useSheriff) ? 1 : 0;
  let doctor = (settings.useDoctor ?? DEFAULT_SETTINGS.useDoctor) ? 1 : 0;

  // Урезаем особые роли, пока мирным есть место
  while (n - mafia - sheriff - doctor < 1) {
    if (sheriff) sheriff = 0;
    else if (doctor) doctor = 0;
    else break;
  }

  return { mafia, sheriff, doctor, civilian: n - mafia - sheriff - doctor };
}

/**
 * Оставляет из присланного клиентом только настоящие настройки.
 *
 * Список ключей берётся из DEFAULT_SETTINGS, а не пишется руками: иначе новая
 * настройка появляется в интерфейсе, но молча отбрасывается сервером —
 * ровно так однажды перестали работать переключатели доктора и комиссара.
 */
export function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ключи объекта голосов → подсчёт по целям. */
function tally(votes) {
  const counts = new Map();
  for (const target of Object.values(votes)) {
    if (!target) continue;
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  return counts;
}

/** Возвращает список целей с максимальным числом голосов. */
function leaders(counts) {
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  if (max === 0) return [];
  return [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);
}

export class Game {
  /**
   * @param {object} opts
   * @param {string} opts.code       код комнаты
   * @param {number} opts.hostId     Telegram id создателя
   * @param {object} [opts.settings]
   * @param {() => number} [opts.rng]
   */
  constructor({ code, hostId, settings = {}, rng = Math.random } = {}) {
    this.code = code;
    this.hostId = hostId;
    this.rng = rng;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.phase = PHASE.LOBBY;
    this.dayNumber = 0;
    this.players = []; // {id, name, username, photo, role, alive, connected, deathReason, deathDay}
    this.phaseEndsAt = null;
    this.phaseStartedAt = null;
    this.nightVotes = {}; // мафия: playerId -> targetId
    this.sheriffCheck = null; // targetId, выбранный комиссаром за эту ночь
    this.sheriffResults = {}; // targetId -> 'mafia' | 'not_mafia'
    this.doctorHeal = null; // кого доктор лечит этой ночью
    this.lastDoctorHeal = null; // кого лечил прошлой ночью — подряд нельзя
    this.savedByDoctor = null; // кого спасли этой ночью (знает только доктор)
    this.votes = {}; // дневное голосование: voterId -> targetId
    this.lastDayVotes = {}; // голосование прошлого дня — по нему боты понимают, кто их «топил»
    this.revoteCandidates = null;
    this.ready = new Set(); // кто нажал «готов» в обсуждении
    this.log = []; // публичный журнал: {day, phase, text, kind}
    this.chat = { day: [], mafia: [] };
    this.winner = null;
    this.lastNightVictim = null;
    this.lastExecuted = null;
    this.version = 0;
    this.finishedAt = null;
  }

  // ─────────────────────────── вспомогательное ───────────────────────────

  get isHumanHosted() {
    return this.settings.hostMode === 'human';
  }

  /** Игроки, которые получают роли (ведущий-человек исключается). */
  get playing() {
    return this.isHumanHosted ? this.players.filter((p) => p.id !== this.hostId) : this.players;
  }

  get alive() {
    return this.playing.filter((p) => p.alive);
  }

  get aliveMafia() {
    return this.alive.filter((p) => p.role === ROLE.MAFIA);
  }

  get aliveTown() {
    return this.alive.filter((p) => p.role !== ROLE.MAFIA);
  }

  player(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  get inProgress() {
    return this.phase !== PHASE.LOBBY && this.phase !== PHASE.ENDED;
  }

  bump() {
    this.version++;
  }

  /**
   * Событие журнала хранится кодом и данными, а не готовой фразой:
   * текст собирает приложение, поэтому один и тот же журнал читается
   * и по-русски, и по-английски.
   */
  addLog(code, params = null, kind = 'info') {
    this.log.push({ day: this.dayNumber, phase: this.phase, code, params, kind, at: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  // ─────────────────────────── лобби ───────────────────────────

  /**
   * Имя и фото игрока за столом — те, что он указал в профиле.
   *
   * Посреди партии они не меняются: иначе можно переименоваться прямо
   * во время голосования и запутать город. Новые имя и фото ждут конца
   * партии и встают на место, когда комната возвращается в лобби.
   */
  setIdentity(id, { name, photo } = {}) {
    const p = this.player(id);
    if (!p || p.isBot) return { ok: false, code: 'not_in_room' };

    const next = { name: name || p.name, photo: photo || null };
    const same = next.name === p.name && next.photo === p.photo;

    if (this.inProgress) {
      p.pendingIdentity = same ? null : next;
      return { ok: true, deferred: !same };
    }

    p.pendingIdentity = null;
    if (!same) {
      p.name = next.name;
      p.photo = next.photo;
      this.bump();
    }
    return { ok: true, deferred: false };
  }

  addPlayer(user) {
    const existing = this.player(user.id);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.username = user.username ?? existing.username;
      this.setIdentity(user.id, user);
      this.bump();
      return { ok: true, rejoined: true };
    }
    if (this.inProgress) {
      return { ok: false, code: 'game_running' };
    }
    if (this.phase === PHASE.ENDED) {
      return { ok: false, code: 'game_over' };
    }
    const cap = this.settings.maxPlayers + (this.isHumanHosted ? 1 : 0);
    if (this.players.length >= cap) {
      return { ok: false, code: 'room_full' };
    }
    this.players.push({
      id: user.id,
      name: user.name,
      username: user.username || null,
      photo: user.photo || null,
      isBot: !!user.isBot,
      role: null,
      alive: true,
      connected: true,
      disconnectedAt: null,
      deathReason: null,
      deathDay: null,
    });
    this.bump();
    return { ok: true, rejoined: false };
  }

  // ─────────────────────────── боты ───────────────────────────

  get bots() {
    return this.players.filter((p) => p.isBot);
  }

  get humans() {
    return this.players.filter((p) => !p.isBot);
  }

  /** Свободные id и имя для нового бота: имена не повторяются в пределах комнаты. */
  nextBotIdentity() {
    const usedNames = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !usedNames.has(n))
      || `${BOT_NAMES[this.players.length % BOT_NAMES.length]} ${this.players.length}`;

    const taken = new Set(this.players.map((p) => p.id));
    let id = -1;
    while (taken.has(id)) id--;

    return { id, name, isBot: true };
  }

  /**
   * Посадить за стол ещё одного бота.
   *
   * Бот занимает обычное место и считается наравне с людьми: он попадает
   * в раздачу ролей, голосует и может быть убит. Отличается только тем,
   * что ходит за него сервер.
   */
  addBot(byId, identity) {
    if (byId !== null && byId !== this.hostId) return { ok: false, code: 'bots_host_only' };
    if (this.inProgress) return { ok: false, code: 'bots_in_game' };
    const cap = this.settings.maxPlayers + (this.isHumanHosted ? 1 : 0);
    if (this.players.length >= cap) return { ok: false, code: 'room_full' };

    const bot = identity || this.nextBotIdentity();
    this.players.push({
      id: bot.id,
      name: bot.name,
      username: null,
      photo: null,
      isBot: true,
      role: null,
      alive: true,
      connected: true,
      disconnectedAt: null,
      deathReason: null,
      deathDay: null,
    });
    this.bump();
    return { ok: true, bot };
  }

  /** Убрать бота. Без указания id уходит тот, кого посадили последним. */
  removeBot(byId, botId = null) {
    if (byId !== null && byId !== this.hostId) return { ok: false, code: 'bots_host_only' };
    if (this.inProgress) return { ok: false, code: 'bots_in_game' };

    const idx = botId === null
      ? this.players.map((p) => p.isBot).lastIndexOf(true)
      : this.players.findIndex((p) => p.isBot && p.id === Number(botId));
    if (idx === -1) return { ok: false, code: 'no_bots' };

    this.players.splice(idx, 1);
    this.bump();
    return { ok: true };
  }

  /**
   * Дозаполнить стол ботами до нужного числа игроков.
   * Используется кнопкой «играть с ботами»: человек нажал — и партия готова.
   */
  fillWithBots(total) {
    const cap = Math.min(MAX_PLAYERS, this.settings.maxPlayers);
    const want = Math.min(cap, Math.max(MIN_PLAYERS, Number(total) || MIN_PLAYERS));
    let added = 0;
    while (this.playing.length < want) {
      const res = this.addBot(null);
      if (!res.ok) break;
      added++;
    }
    return { ok: true, added };
  }

  /** Полный выход из комнаты. В идущей игре — только пометка «отключился». */
  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    if (this.inProgress) {
      this.players[idx].connected = false;
    } else {
      this.players.splice(idx, 1);
      // Если ушёл создатель — передаём комнату следующему
      if (id === this.hostId && this.players.length) {
        this.hostId = this.players[0].id;
      }
    }
    this.bump();
  }

  setConnected(id, connected, now = Date.now()) {
    const p = this.player(id);
    if (!p) return;
    p.connected = connected;
    // Момент обрыва нужен, чтобы дать игроку время вернуться:
    // на телефоне связь рвётся от каждой блокировки экрана.
    p.disconnectedAt = connected ? null : now;
    this.bump();
  }

  /**
   * Убирает из лобби тех, кто отвалился надолго и не вернулся.
   * В идущей игре не трогаем никого: место игрока сохраняется до конца партии.
   */
  dropStale(now = Date.now(), graceMs = 0) {
    if (this.phase !== PHASE.LOBBY) return [];
    const stale = this.players.filter(
      (p) => !p.connected && p.disconnectedAt && now - p.disconnectedAt > graceMs,
    );
    for (const p of stale) this.removePlayer(p.id);
    return stale.map((p) => p.id);
  }

  kick(byId, targetId) {
    if (byId !== this.hostId) return { ok: false, code: 'kick_host_only' };
    if (this.inProgress) return { ok: false, code: 'kick_in_game' };
    if (targetId === this.hostId) return { ok: false, code: 'kick_self' };
    this.players = this.players.filter((p) => p.id !== targetId);
    this.bump();
    return { ok: true };
  }

  updateSettings(byId, patch) {
    if (byId !== this.hostId) return { ok: false, code: 'settings_host_only' };
    if (this.inProgress) return { ok: false, code: 'settings_in_game' };

    const next = { ...this.settings };
    const num = (v, min, max, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    };

    if (patch.hostMode === 'bot' || patch.hostMode === 'human') next.hostMode = patch.hostMode;
    if (patch.useDoctor !== undefined) next.useDoctor = !!patch.useDoctor;
    if (patch.useSheriff !== undefined) next.useSheriff = !!patch.useSheriff;
    if (patch.isPublic !== undefined) next.isPublic = !!patch.isPublic;
    if (patch.tieRule && ['revote', 'nobody', 'random'].includes(patch.tieRule)) next.tieRule = patch.tieRule;
    if (patch.maxPlayers !== undefined) next.maxPlayers = num(patch.maxPlayers, MIN_PLAYERS, MAX_PLAYERS, next.maxPlayers);
    if (patch.nightSec !== undefined) next.nightSec = num(patch.nightSec, 15, 180, next.nightSec);
    if (patch.discussionSec !== undefined) next.discussionSec = num(patch.discussionSec, 30, 600, next.discussionSec);
    if (patch.voteSec !== undefined) next.voteSec = num(patch.voteSec, 15, 180, next.voteSec);
    if (patch.revoteSec !== undefined) next.revoteSec = num(patch.revoteSec, 10, 120, next.revoteSec);
    if (patch.revealRoleOnDeath !== undefined) next.revealRoleOnDeath = !!patch.revealRoleOnDeath;

    this.settings = next;
    this.bump();
    return { ok: true };
  }

  // ─────────────────────────── старт партии ───────────────────────────

  canStart() {
    const n = this.playing.length;
    if (n < MIN_PLAYERS) {
      return { ok: false, code: 'min_players', params: { min: MIN_PLAYERS, now: n } };
    }
    if (n > MAX_PLAYERS) {
      return { ok: false, code: 'max_players', params: { max: MAX_PLAYERS } };
    }
    return { ok: true };
  }

  start(byId, now = Date.now()) {
    if (byId !== this.hostId) return { ok: false, code: 'start_host_only' };
    if (this.phase !== PHASE.LOBBY) return { ok: false, code: 'already_started' };
    const check = this.canStart();
    if (!check.ok) return check;

    this.dealRoles();
    this.dayNumber = 0;
    this.addLog('game_started', null, 'start');
    this.setPhase(PHASE.ROLES, now);
    return { ok: true };
  }

  dealRoles() {
    const list = this.playing;
    const comp = roleComposition(list.length, this.settings);
    const pool = [
      ...Array(comp.mafia).fill(ROLE.MAFIA),
      ...Array(comp.sheriff).fill(ROLE.SHERIFF),
      ...Array(comp.doctor).fill(ROLE.DOCTOR),
      ...Array(comp.civilian).fill(ROLE.CIVILIAN),
    ];
    const shuffled = shuffle(pool, this.rng);
    list.forEach((p, i) => {
      p.role = shuffled[i];
      p.alive = true;
      p.deathReason = null;
      p.deathDay = null;
    });
    // Ведущий-человек роли не получает
    if (this.isHumanHosted) {
      const host = this.player(this.hostId);
      if (host) {
        host.role = null;
        host.alive = true;
      }
    }
  }

  // ─────────────────────────── фазы ───────────────────────────

  phaseDuration(phase) {
    if (this.isHumanHosted) return null; // живой ведущий сам переключает фазы
    switch (phase) {
      case PHASE.ROLES: return ROLES_SEC;
      case PHASE.NIGHT: return this.settings.nightSec;
      case PHASE.DAY: return DAY_SEC;
      case PHASE.DISCUSSION: return this.settings.discussionSec;
      case PHASE.VOTING: return this.settings.voteSec;
      case PHASE.REVOTE: return this.settings.revoteSec;
      case PHASE.VERDICT: return VERDICT_SEC;
      default: return null;
    }
  }

  setPhase(phase, now = Date.now()) {
    this.phase = phase;
    this.phaseStartedAt = now;
    const dur = this.phaseDuration(phase);
    this.phaseEndsAt = dur ? now + dur * 1000 : null;
    this.ready = new Set();
    this.bump();
  }

  /**
   * Главный такт. Вызывается сервером раз в секунду.
   * Переводит фазу, если вышло время (в режиме бота) или если все уже сходили.
   */
  tick(now = Date.now()) {
    if (!this.inProgress) return false;
    if (this.isHumanHosted) return false; // ждём ведущего

    const timeUp = this.phaseEndsAt !== null && now >= this.phaseEndsAt;
    if (timeUp || this.everyoneDone()) {
      this.advance(now);
      return true;
    }
    return false;
  }

  /** Все ли участники фазы уже сделали свой ход — можно не ждать таймер. */
  everyoneDone() {
    if (this.phase === PHASE.NIGHT) {
      const mafiaDone = this.aliveMafia.every((p) => this.nightVotes[p.id] !== undefined);
      const sheriffAlive = this.alive.find((p) => p.role === ROLE.SHERIFF);
      const sheriffDone = !sheriffAlive || this.sheriffCheck !== null;
      const doctorAlive = this.alive.find((p) => p.role === ROLE.DOCTOR);
      const doctorDone = !doctorAlive || this.doctorHeal !== null;
      return mafiaDone && sheriffDone && doctorDone;
    }
    if (this.phase === PHASE.DISCUSSION) {
      return this.alive.length > 0 && this.alive.every((p) => this.ready.has(p.id));
    }
    if (this.phase === PHASE.VOTING || this.phase === PHASE.REVOTE) {
      const voters = this.phase === PHASE.REVOTE
        ? this.alive.filter((p) => !this.revoteCandidates?.includes(p.id))
        : this.alive;
      return voters.length > 0 && voters.every((p) => this.votes[p.id] !== undefined);
    }
    return false;
  }

  /** Явный переход к следующей фазе (таймер или кнопка ведущего). */
  advance(now = Date.now()) {
    switch (this.phase) {
      case PHASE.ROLES:
        this.beginNight(now);
        break;
      case PHASE.NIGHT:
        this.resolveNight(now);
        break;
      case PHASE.DAY:
        this.setPhase(PHASE.DISCUSSION, now);
        break;
      case PHASE.DISCUSSION:
        this.beginVoting(now);
        break;
      case PHASE.VOTING:
        this.resolveVoting(now);
        break;
      case PHASE.REVOTE:
        this.resolveVoting(now, true);
        break;
      case PHASE.VERDICT:
        this.beginNight(now);
        break;
      default:
        break;
    }
  }

  hostNext(byId, now = Date.now()) {
    if (byId !== this.hostId) return { ok: false, code: 'phase_host_only' };
    if (!this.isHumanHosted) return { ok: false, code: 'phase_bot_hosted' };
    if (!this.inProgress) return { ok: false, code: 'not_running' };
    this.advance(now);
    return { ok: true };
  }

  beginNight(now) {
    this.dayNumber++;
    this.nightVotes = {};
    this.sheriffCheck = null;
    this.doctorHeal = null;
    this.savedByDoctor = null;
    this.votes = {};
    this.revoteCandidates = null;
    this.chat.mafia = [];
    this.addLog('night_falls', { day: this.dayNumber }, 'night');
    this.setPhase(PHASE.NIGHT, now);
  }

  resolveNight(now) {
    // Мафия голосует; побеждает большинство, при равенстве — случайный из лидеров
    const counts = tally(this.nightVotes);
    const top = leaders(counts);
    let victim = null;
    if (top.length === 1) victim = top[0];
    else if (top.length > 1) victim = top[Math.floor(this.rng() * top.length)];

    // Комиссар получает результат проверки
    if (this.sheriffCheck) {
      const target = this.player(this.sheriffCheck);
      if (target) {
        this.sheriffResults[target.id] = target.role === ROLE.MAFIA ? 'mafia' : 'not_mafia';
      }
    }

    // Доктор успевает раньше мафии
    this.savedByDoctor = null;
    if (victim && this.doctorHeal && victim === this.doctorHeal) {
      this.savedByDoctor = victim;
      victim = null;
    }
    this.lastDoctorHeal = this.doctorHeal;

    this.lastNightVictim = null;
    if (victim) {
      const p = this.player(victim);
      if (p && p.alive) {
        p.alive = false;
        p.deathReason = 'night';
        p.deathDay = this.dayNumber;
        this.lastNightVictim = p.id;
        this.addLog('killed', { name: p.name, role: this.settings.revealRoleOnDeath ? p.role : null }, 'kill');
      }
    } else {
      // Формулировка нарочно одинаковая и когда мафия промахнулась, и когда
      // сработал доктор: город не должен по объявлению вычислять, есть ли доктор.
      this.addLog('nobody_died', null, 'peace');
    }

    this.setPhase(PHASE.DAY, now);
    this.checkWin(now);
  }

  beginVoting(now) {
    // Итоги прошлого дня забираем до сброса — ботам они нужны как память
    if (Object.keys(this.votes).length) this.lastDayVotes = { ...this.votes };
    this.votes = {};
    this.revoteCandidates = null;
    this.addLog('voting_started', null, 'vote');
    this.setPhase(PHASE.VOTING, now);
  }

  resolveVoting(now, isRevote = false) {
    const counts = tally(this.votes);
    const top = leaders(counts);

    if (top.length === 0) {
      this.addLog('nobody_voted', null, 'peace');
      this.lastExecuted = null;
      this.setPhase(PHASE.VERDICT, now);
      return;
    }

    if (top.length > 1) {
      if (this.settings.tieRule === 'revote' && !isRevote) {
        this.revoteCandidates = top;
        this.votes = {};
        const names = top.map((id) => this.player(id)?.name).filter(Boolean).join(', ');
        this.addLog('tie_revote', { names }, 'vote');
        this.setPhase(PHASE.REVOTE, now);
        return;
      }
      if (this.settings.tieRule === 'random') {
        const pick = top[Math.floor(this.rng() * top.length)];
        this.executePlayer(pick, now);
        return;
      }
      // 'nobody', либо повторная ничья при переголосовке
      this.addLog('tie_nobody', null, 'peace');
      this.lastExecuted = null;
      this.setPhase(PHASE.VERDICT, now);
      return;
    }

    this.executePlayer(top[0], now);
  }

  executePlayer(id, now) {
    const p = this.player(id);
    if (p && p.alive) {
      p.alive = false;
      p.deathReason = 'vote';
      p.deathDay = this.dayNumber;
      this.lastExecuted = p.id;
      this.addLog(
        'executed',
        { name: p.name, role: this.settings.revealRoleOnDeath ? p.role : null },
        'exile',
      );
    } else {
      this.lastExecuted = null;
    }
    this.setPhase(PHASE.VERDICT, now);
    this.checkWin(now);
  }

  checkWin(now = Date.now()) {
    const mafia = this.aliveMafia.length;
    const town = this.aliveTown.length;
    if (mafia === 0) {
      this.finish('civilians', now);
      return true;
    }
    if (mafia >= town) {
      this.finish('mafia', now);
      return true;
    }
    return false;
  }

  finish(winner, now = Date.now()) {
    this.winner = winner;
    this.finishedAt = now;
    this.addLog(winner === 'mafia' ? 'win_mafia' : 'win_town', null, 'end');
    this.phase = PHASE.ENDED;
    this.phaseEndsAt = null;
    this.bump();
  }

  /** Сброс к лобби для новой партии тем же составом. */
  restart(byId) {
    if (byId !== this.hostId) return { ok: false, code: 'restart_host_only' };
    if (this.inProgress) return { ok: false, code: 'still_running' };
    this.phase = PHASE.LOBBY;
    this.dayNumber = 0;
    this.winner = null;
    this.finishedAt = null;
    this.phaseEndsAt = null;
    this.nightVotes = {};
    this.votes = {};
    this.sheriffCheck = null;
    this.sheriffResults = {};
    this.doctorHeal = null;
    this.lastDoctorHeal = null;
    this.savedByDoctor = null;
    this.revoteCandidates = null;
    this.lastNightVictim = null;
    this.lastExecuted = null;
    this.log = [];
    this.chat = { day: [], mafia: [] };
    this.ready = new Set();
    for (const p of this.players) {
      // Имя и фото, сменённые посреди партии, вступают в силу теперь
      if (p.pendingIdentity) {
        p.name = p.pendingIdentity.name;
        p.photo = p.pendingIdentity.photo;
        p.pendingIdentity = null;
      }
      p.role = null;
      p.alive = true;
      p.deathReason = null;
      p.deathDay = null;
    }
    // Отключившихся не тащим в новую партию
    this.players = this.players.filter((p) => p.connected || p.id === this.hostId);
    this.bump();
    return { ok: true };
  }

  // ─────────────────────────── ходы игроков ───────────────────────────

  submitNightAction(playerId, targetId) {
    if (this.phase !== PHASE.NIGHT) return { ok: false, code: 'not_night' };
    const me = this.player(playerId);
    if (!me || !me.alive) return { ok: false, code: 'dead_no_action' };

    const target = this.player(targetId);
    if (!target || !target.alive) return { ok: false, code: 'target_unavailable' };

    if (me.role === ROLE.MAFIA) {
      if (target.role === ROLE.MAFIA) return { ok: false, code: 'no_friendly_fire' };
      this.nightVotes[playerId] = targetId;
      this.bump();
      return { ok: true };
    }

    if (me.role === ROLE.SHERIFF) {
      if (targetId === playerId) return { ok: false, code: 'no_self_check' };
      if (this.sheriffCheck) return { ok: false, code: 'check_done' };
      this.sheriffCheck = targetId;
      this.bump();
      return { ok: true };
    }

    if (me.role === ROLE.DOCTOR) {
      if (targetId === this.lastDoctorHeal) {
        return { ok: false, code: 'no_heal_twice' };
      }
      this.doctorHeal = targetId;
      this.bump();
      return { ok: true };
    }

    return { ok: false, code: 'no_night_action' };
  }

  submitVote(playerId, targetId) {
    if (this.phase !== PHASE.VOTING && this.phase !== PHASE.REVOTE) {
      return { ok: false, code: 'not_voting' };
    }
    const me = this.player(playerId);
    if (!me || !me.alive || (this.isHumanHosted && me.id === this.hostId)) {
      return { ok: false, code: 'not_a_voter' };
    }
    if (this.phase === PHASE.REVOTE && this.revoteCandidates?.includes(playerId)) {
      return { ok: false, code: 'candidate_no_vote' };
    }
    if (targetId === null) {
      // воздержаться
      this.votes[playerId] = null;
      this.bump();
      return { ok: true };
    }
    const target = this.player(targetId);
    if (!target || !target.alive) return { ok: false, code: 'target_unavailable' };
    if (targetId === playerId) return { ok: false, code: 'no_self_vote' };
    if (this.phase === PHASE.REVOTE && !this.revoteCandidates?.includes(targetId)) {
      return { ok: false, code: 'revote_candidates_only' };
    }
    this.votes[playerId] = targetId;
    this.bump();
    return { ok: true };
  }

  setReady(playerId, value = true) {
    if (this.phase !== PHASE.DISCUSSION) return { ok: false, code: 'discussion_only' };
    const me = this.player(playerId);
    if (!me || !me.alive) return { ok: false, code: 'not_participating' };
    if (value) this.ready.add(playerId);
    else this.ready.delete(playerId);
    this.bump();
    return { ok: true };
  }

  /**
   * Сообщение в чат.
   *
   * Люди пишут текстом. Боты вместо текста присылают код реплики — фразу
   * по нему соберёт приложение, поэтому в русской и английской версии игры
   * бот говорит на языке игрока, а не на одном заданном.
   */
  addChat(playerId, text, line = null) {
    const me = this.player(playerId);
    if (!me) return { ok: false, code: 'not_in_room' };

    const clean = line?.code ? '' : String(text || '').slice(0, 300).trim();
    if (!clean && !line?.code) return { ok: false, code: 'empty_message' };

    const isMafiaChannel = this.phase === PHASE.NIGHT && me.role === ROLE.MAFIA && me.alive;
    const channel = isMafiaChannel ? 'mafia' : 'day';

    if (channel === 'day') {
      if (!me.alive && this.inProgress) return { ok: false, code: 'dead_silent' };
      if (this.phase === PHASE.NIGHT) return { ok: false, code: 'night_silence' };
    }

    const msg = {
      id: `${Date.now()}-${Math.floor(this.rng() * 1e6)}`,
      from: me.id,
      name: me.name,
      text: clean,
      bot: !!me.isBot,
      code: line?.code || null,
      params: line?.params || null,
      at: Date.now(),
    };
    this.chat[channel].push(msg);
    if (this.chat[channel].length > 100) this.chat[channel].shift();
    this.bump();
    return { ok: true, channel, msg };
  }

  // ─────────────────────────── персональный вид ───────────────────────────

  /**
   * Состояние глазами конкретного игрока: чужие роли скрыты,
   * ночные ходы видны только тем, кому положено.
   */
  viewFor(playerId, now = Date.now()) {
    const me = this.player(playerId);
    const isHost = playerId === this.hostId;
    const revealAll = this.phase === PHASE.ENDED || (this.isHumanHosted && isHost);
    const iAmMafia = me?.role === ROLE.MAFIA;

    const players = this.players.map((p) => {
      const isMe = p.id === playerId;
      let role = null;
      if (revealAll || isMe) role = p.role;
      else if (iAmMafia && p.role === ROLE.MAFIA && me.alive) role = ROLE.MAFIA;
      else if (!p.alive && this.settings.revealRoleOnDeath) role = p.role;

      return {
        id: p.id,
        name: p.name,
        username: p.username,
        photo: p.photo,
        alive: p.alive,
        connected: p.connected,
        isBot: !!p.isBot,
        isHost: p.id === this.hostId,
        isSpectatingHost: this.isHumanHosted && p.id === this.hostId,
        role,
        deathReason: p.deathReason,
        deathDay: p.deathDay,
        // сколько голосов набрал днём — видно всем во время голосования
        voteCount: (this.phase === PHASE.VOTING || this.phase === PHASE.REVOTE)
          ? Object.values(this.votes).filter((t) => t === p.id).length
          : 0,
        // кого выбрала мафия — видно только мафии
        mafiaTargeted: (iAmMafia && this.phase === PHASE.NIGHT)
          ? Object.values(this.nightVotes).filter((t) => t === p.id).length
          : 0,
        sheriffResult: me?.role === ROLE.SHERIFF ? (this.sheriffResults[p.id] ?? null) : null,
        ready: this.ready.has(p.id),
      };
    });

    return {
      code: this.code,
      version: this.version,
      phase: this.phase,
      dayNumber: this.dayNumber,
      settings: this.settings,
      hostId: this.hostId,
      isHost,
      me: me
        ? {
            id: me.id,
            name: me.name,
            role: me.role,
            alive: me.alive,
            isSpectatingHost: this.isHumanHosted && isHost,
          }
        : null,
      players,
      serverTime: now,
      phaseEndsAt: this.phaseEndsAt,
      phaseStartedAt: this.phaseStartedAt,
      myNightTarget: me?.role === ROLE.MAFIA ? (this.nightVotes[playerId] ?? null)
        : me?.role === ROLE.SHERIFF ? this.sheriffCheck
        : me?.role === ROLE.DOCTOR ? this.doctorHeal
        : null,
      // Доктору: кого нельзя лечить сегодня и сработало ли спасение.
      // Живому ведущему это тоже видно — он ведёт партию и знает всё.
      lastHealed: (me?.role === ROLE.DOCTOR || revealAll) ? this.lastDoctorHeal : null,
      savedByDoctor: (me?.role === ROLE.DOCTOR || revealAll) ? this.savedByDoctor : null,
      doctorTarget: (me?.role === ROLE.DOCTOR || revealAll) ? this.doctorHeal : null,
      composition: this.phase === PHASE.LOBBY
        ? roleComposition(Math.max(MIN_PLAYERS, this.playing.length), this.settings)
        : null,
      // Важно: воздержавшийся хранится как null, поэтому `??` тут использовать нельзя —
      // он бы превратил осознанный отказ в «ещё не голосовал».
      myVote: Object.prototype.hasOwnProperty.call(this.votes, playerId) ? this.votes[playerId] : undefined,
      revoteCandidates: this.revoteCandidates,
      votedCount: Object.keys(this.votes).length,
      voterTotal: this.phase === PHASE.REVOTE
        ? this.alive.filter((p) => !this.revoteCandidates?.includes(p.id)).length
        : this.alive.length,
      log: this.log,
      chat: {
        day: this.chat.day,
        mafia: iAmMafia || revealAll ? this.chat.mafia : [],
      },
      lastNightVictim: this.lastNightVictim,
      lastExecuted: this.lastExecuted,
      winner: this.winner,
      counts: {
        alive: this.alive.length,
        mafia: this.phase === PHASE.ENDED ? this.aliveMafia.length : null,
        total: this.playing.length,
        bots: this.bots.length,
        humans: this.humans.length,
      },
      minPlayers: MIN_PLAYERS,
      maxPlayersHard: MAX_PLAYERS,
      canStart: this.canStart(),
    };
  }
}
