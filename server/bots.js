/**
 * Боты-игроки.
 *
 * Бот — обычный игрок в списке `game.players`, только с пометкой `isBot` и
 * отрицательным id (у настоящих Telegram-аккаунтов id всегда положительный,
 * так что пересечься они не могут).
 *
 * Движок про ботов ничего не знает: он одинаково принимает ходы и от человека,
 * и от бота через те же `submitNightAction` / `submitVote` / `setReady`. Здесь
 * лежит только то, «что бот решит и когда». Решения детерминированы от id бота,
 * фазы и номера дня — поэтому одна и та же ситуация не даёт разных ответов
 * между тиками, и партию можно воспроизвести в тестах.
 */

import { ROLE, PHASE } from './game.js';

/** Реплики ботов в обсуждении. Текст собирает приложение по коду — игра двуязычная. */
const SAY_CODES = [
  'quiet', 'suspect', 'defend', 'agree', 'unsure', 'watch', 'pressure', 'nothing',
];

export const BOT_SAY_CODES = SAY_CODES;

/** Диапазоны задержек, чтобы боты не отвечали мгновенно и все разом. */
const DELAY = {
  night: [2500, 9000],
  vote: [3000, 11000],
  say: [4000, 14000],
  ready: [12000, 26000],
};

/**
 * Детерминированное число 0..1 из набора целых.
 * Нужно, чтобы «случайный» выбор бота не менялся от тика к тику.
 */
function frac(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= Math.imul(Number(n) | 0, 374761393);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
  }
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Фазу в число — чтобы её можно было подмешать в хеш. */
function phaseSeed(phase) {
  let s = 0;
  for (let i = 0; i < phase.length; i++) s = (s * 31 + phase.charCodeAt(i)) | 0;
  return s;
}

/** Выбор одного элемента детерминированно. */
function pick(list, seed) {
  if (!list.length) return null;
  return list[Math.floor(frac(seed) * list.length) % list.length];
}

/**
 * Сколько миллисекунд бот «думает» в этой фазе.
 * Задержка своя у каждого бота, поэтому ходят они вразнобой, как живые.
 */
function thinkFor(bot, game, kind) {
  const [min, max] = DELAY[kind];
  const r = frac(bot.id, phaseSeed(game.phase), game.dayNumber, kind.length);
  return min + r * (max - min);
}

/** Прошло ли достаточно времени с начала фазы. */
function timeCame(bot, game, now, kind) {
  if (!game.phaseStartedAt) return true;
  const waited = now - game.phaseStartedAt;
  // Под конец фазы бот перестаёт тянуть: иначе он просто не успеет сходить
  // и партия зависнет на таймере, хотя ход у него был.
  if (game.phaseEndsAt && game.phaseEndsAt - now < 3000) return true;
  return waited >= thinkFor(bot, game, kind);
}

/** Память бота в пределах одной фазы одного дня. */
function memo(bot, game) {
  const key = `${game.phase}:${game.dayNumber}`;
  if (!bot.botMemo || bot.botMemo.key !== key) {
    bot.botMemo = { key, said: 0, ready: false };
  }
  return bot.botMemo;
}

// ─────────────────────────── решения ───────────────────────────

/**
 * Кого мафия убивает ночью.
 *
 * Сначала смотрим, на ком уже сошлись напарники — так выстрел не «размажется»
 * по нескольким целям. Дальше в приоритете тот, кто вчера активно голосовал:
 * такого игрока слушают, и он опаснее молчуна.
 */
function mafiaTarget(game, bot) {
  const targets = game.alive.filter((p) => p.role !== ROLE.MAFIA);
  if (!targets.length) return null;

  // Уже выбранная напарником цель
  const partnerChoice = Object.entries(game.nightVotes)
    .filter(([voter]) => Number(voter) !== bot.id)
    .map(([, target]) => Number(target))
    .find((t) => targets.some((p) => p.id === t));
  if (partnerChoice !== undefined) return partnerChoice;

  // Тех, кто вчера голосовал за мафию, убираем первыми
  const mafiaIds = new Set(game.aliveMafia.map((p) => p.id));
  const scored = targets.map((p) => {
    const votedAtUs = game.lastDayVotes?.[p.id];
    const danger = votedAtUs !== undefined && mafiaIds.has(Number(votedAtUs)) ? 2 : 0;
    return { p, score: danger + frac(bot.id, p.id, game.dayNumber) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].p.id;
}

/** Кого проверяет комиссар: любого непроверенного, себя — никогда. */
function sheriffTarget(game, bot) {
  const fresh = game.alive.filter(
    (p) => p.id !== bot.id && game.sheriffResults[p.id] === undefined,
  );
  const pool = fresh.length ? fresh : game.alive.filter((p) => p.id !== bot.id);
  if (!pool.length) return null;
  return pick(pool, frac(bot.id, game.dayNumber, 7) * 1e6)?.id ?? null;
}

/**
 * Кого лечит доктор.
 *
 * Того же, что прошлой ночью, движок запретит — такие цели даже не рассматриваем.
 * Себя доктор лечит примерно в четверти случаев.
 */
function doctorTarget(game, bot) {
  const pool = game.alive.filter((p) => p.id !== game.lastDoctorHeal);
  if (!pool.length) return null;

  const self = pool.find((p) => p.id === bot.id);
  if (self && frac(bot.id, game.dayNumber, 3) < 0.25) return self.id;

  const others = pool.filter((p) => p.id !== bot.id);
  const list = others.length ? others : pool;
  return pick(list, frac(bot.id, game.dayNumber, 11) * 1e6)?.id ?? null;
}

/** Текущий лидер голосования — за кем уже собралась толпа. */
function voteLeader(game, exclude = []) {
  const counts = new Map();
  for (const target of Object.values(game.votes)) {
    if (target === null || target === undefined) continue;
    if (exclude.includes(Number(target))) continue;
    counts.set(Number(target), (counts.get(Number(target)) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) { best = id; bestN = n; }
  }
  return best;
}

/**
 * За кого бот голосует днём.
 *
 * Комиссар ведёт по своим проверкам. Мафия своих не сдаёт и охотно
 * присоединяется к толпе — так подозрение уходит от неё самой. Мирные
 * тоже склонны поддержать лидера голосования: в живой игре так и бывает.
 */
function voteTarget(game, bot) {
  const isRevote = game.phase === PHASE.REVOTE;
  const candidates = isRevote
    ? game.alive.filter((p) => game.revoteCandidates?.includes(p.id))
    : game.alive.filter((p) => p.id !== bot.id);

  if (!candidates.length) return undefined;

  const iAmMafia = bot.role === ROLE.MAFIA;
  const mafiaIds = new Set(game.aliveMafia.map((p) => p.id));

  let pool = candidates;
  if (iAmMafia) {
    const town = candidates.filter((p) => !mafiaIds.has(p.id));
    // В переголосовке из своих может не быть выбора — тогда голосуем как есть
    if (town.length) pool = town;
  } else if (bot.role === ROLE.SHERIFF) {
    const known = candidates.filter((p) => game.sheriffResults[p.id] === 'mafia');
    if (known.length) return known[0].id;
    const cleared = candidates.filter((p) => game.sheriffResults[p.id] === 'not_mafia');
    const unknown = candidates.filter((p) => game.sheriffResults[p.id] === undefined);
    if (unknown.length) pool = unknown;
    else if (cleared.length < candidates.length) pool = candidates;
  }

  // Подхватить лидера голосования — но только если он подходит боту
  const leader = voteLeader(game, [bot.id]);
  const leaderOk = leader !== null && pool.some((p) => p.id === leader);
  if (leaderOk && frac(bot.id, leader, game.dayNumber, 5) < (iAmMafia ? 0.75 : 0.55)) {
    return leader;
  }

  // Изредка мирный воздерживается — но не в переголосовке, там это бессмысленно
  if (!iAmMafia && !isRevote && frac(bot.id, game.dayNumber, 17) < 0.08) return null;

  return pick(pool, frac(bot.id, game.dayNumber, 23) * 1e6)?.id ?? undefined;
}

/** Что бот скажет в обсуждении. Возвращает код реплики, текст соберёт клиент. */
function saySomething(game, bot, slot) {
  const r = frac(bot.id, game.dayNumber, slot, 41);
  const code = SAY_CODES[Math.floor(r * SAY_CODES.length) % SAY_CODES.length];

  // Реплики про конкретного игрока называют имя — берём живого, кроме себя
  if (code === 'suspect' || code === 'defend' || code === 'watch') {
    const others = game.alive.filter((p) => p.id !== bot.id);
    if (!others.length) return { code: 'quiet', params: null };
    const who = pick(others, frac(bot.id, game.dayNumber, slot, 43) * 1e6);
    return { code, params: { name: who.name } };
  }
  return { code, params: null };
}

// ─────────────────────────── такт ───────────────────────────

/**
 * Один ход бота, если время пришло. Возвращает true, если состояние изменилось.
 */
function act(game, bot, now) {
  const m = memo(bot, game);

  if (game.phase === PHASE.NIGHT) {
    if (!timeCame(bot, game, now, 'night')) return false;

    if (bot.role === ROLE.MAFIA) {
      if (game.nightVotes[bot.id] !== undefined) return false;
      const target = mafiaTarget(game, bot);
      return target !== null && game.submitNightAction(bot.id, target).ok;
    }
    if (bot.role === ROLE.SHERIFF) {
      if (game.sheriffCheck !== null) return false;
      const target = sheriffTarget(game, bot);
      return target !== null && game.submitNightAction(bot.id, target).ok;
    }
    if (bot.role === ROLE.DOCTOR) {
      if (game.doctorHeal !== null) return false;
      const target = doctorTarget(game, bot);
      return target !== null && game.submitNightAction(bot.id, target).ok;
    }
    return false;
  }

  if (game.phase === PHASE.DISCUSSION) {
    let changed = false;

    // Пара реплик за обсуждение — больше превратилось бы в спам
    const maxSay = frac(bot.id, game.dayNumber, 29) < 0.45 ? 2 : 1;
    if (m.said < maxSay) {
      const waited = now - (game.phaseStartedAt || now);
      const due = thinkFor(bot, game, 'say') * (m.said + 1);
      if (waited >= due) {
        const line = saySomething(game, bot, m.said);
        if (game.addChat(bot.id, null, line).ok) {
          m.said++;
          changed = true;
        }
      }
    }

    if (!m.ready && timeCame(bot, game, now, 'ready')) {
      if (game.setReady(bot.id, true).ok) {
        m.ready = true;
        changed = true;
      }
    }
    return changed;
  }

  if (game.phase === PHASE.VOTING || game.phase === PHASE.REVOTE) {
    if (Object.prototype.hasOwnProperty.call(game.votes, bot.id)) return false;
    if (game.phase === PHASE.REVOTE && game.revoteCandidates?.includes(bot.id)) return false;
    if (!timeCame(bot, game, now, 'vote')) return false;

    const target = voteTarget(game, bot);
    if (target === undefined) return false;
    return game.submitVote(bot.id, target).ok;
  }

  return false;
}

/**
 * Дать всем ботам комнаты сходить. Вызывается из общего такта раз в секунду.
 * @returns {boolean} менялось ли состояние — тогда нужна рассылка игрокам
 */
export function runBots(game, now = Date.now()) {
  if (!game?.inProgress) return false;
  if (game.isHumanHosted && game.phase === PHASE.LOBBY) return false;

  let changed = false;
  for (const bot of game.players) {
    if (!bot.isBot || !bot.alive) continue;
    if (act(game, bot, now)) changed = true;
  }
  return changed;
}
