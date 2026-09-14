/**
 * Автопубликация постов в канал.
 *
 * Логика расписания вынесена в чистые функции и не зависит ни от сети,
 * ни от системных часов — время всегда приходит параметром. Это позволяет
 * прогонять недели «за секунду» в тестах и не бояться, что после
 * перезапуска сервера подписчики получат один и тот же пост дважды.
 */

import { POSTS } from '../content/posts.js';

export const DEFAULT_SCHEDULE = {
  everyDays: 2, // раз в сколько дней публиковать
  hourUtc: 8, // 08:00 UTC = 12:00 в Самаре (UTC+4)
  minuteUtc: 0,
};

/**
 * Достаёт имя канала из чего угодно: «@name», «name», «t.me/name»,
 * «https://t.me/s/name». Возвращает null, если публичного имени нет —
 * например, для ссылки-приглашения вида t.me/+AbCdEf.
 */
export function channelNameFrom(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/(?:https?:\/\/)?(?:www\.)?t\.me\/(?:s\/)?(\+?[A-Za-z0-9_]+)/i);
  const name = (m ? m[1] : s).replace(/^@/, '');
  if (name.startsWith('+')) return null;
  return /^[A-Za-z0-9_]{4,32}$/.test(name) ? name : null;
}

/** Дата в виде YYYY-MM-DD по UTC — ключ «дня публикации». */
export function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Сколько целых суток между двумя днями вида YYYY-MM-DD. */
export function daysBetween(fromDay, toDay) {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86400000);
}

/** Момент сегодняшней публикации по расписанию. */
export function scheduledTimeOn(ts, schedule) {
  const d = new Date(ts);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    schedule.hourUtc,
    schedule.minuteUtc,
    0,
    0,
  );
}

/**
 * Пора ли публиковать.
 *
 * @param {object} opts
 * @param {number} opts.now       текущее время
 * @param {object} opts.state     {index, lastDay, paused}
 * @param {object} opts.schedule  {everyDays, hourUtc, minuteUtc}
 * @param {number} opts.total     сколько всего постов в очереди
 * @returns {{due: boolean, reason: string}}
 */
export function isDue({ now, state, schedule, total }) {
  if (state.paused) return { due: false, reason: 'на паузе' };
  if (state.index >= total) return { due: false, reason: 'очередь пуста' };

  const today = dayKey(now);

  // Уже публиковали сегодня — второй раз за день не выкладываем никогда.
  // Это же спасает от дубля, если сервер перезапустился после публикации.
  if (state.lastDay === today) return { due: false, reason: 'сегодня уже публиковали' };

  if (now < scheduledTimeOn(now, schedule)) {
    return { due: false, reason: 'время ещё не пришло' };
  }

  if (state.lastDay) {
    const passed = daysBetween(state.lastDay, today);
    if (passed < schedule.everyDays) {
      return { due: false, reason: `прошло ${passed} дн. из ${schedule.everyDays}` };
    }
  }

  return { due: true, reason: 'пора' };
}

/** Состояние по умолчанию — используется, пока ничего не публиковали. */
export function emptyState() {
  return { index: 0, lastDay: null, paused: false, extra: [], warnedEmpty: false };
}

export class Publisher {
  /**
   * @param {object} opts
   * @param {import('grammy').Bot} opts.bot
   * @param {object} opts.store        хранилище состояния
   * @param {string} opts.channelId    @username канала или числовой id
   * @param {string} opts.playUrl      ссылка на игру для кнопки под постом
   * @param {object} [opts.schedule]
   */
  constructor({ bot, store, channelId, playUrl, schedule = {} }) {
    this.bot = bot;
    this.store = store;
    this.channelId = channelId;
    this.playUrl = playUrl;
    this.schedule = { ...DEFAULT_SCHEDULE, ...schedule };
    this.busy = false;
  }

  get enabled() {
    return !!this.channelId;
  }

  /** Состояние живёт в общем хранилище, чтобы пережить перезапуск. */
  state() {
    if (!this.store.data.publisher) this.store.data.publisher = emptyState();
    const s = this.store.data.publisher;
    if (!Array.isArray(s.extra)) s.extra = [];
    return s;
  }

  /** Встроенные посты плюс добавленные владельцем. */
  queue() {
    return [...POSTS, ...this.state().extra];
  }

  remaining() {
    return Math.max(0, this.queue().length - this.state().index);
  }

  nextPost() {
    return this.queue()[this.state().index] || null;
  }

  render(post) {
    return String(post.text || '').replaceAll('{{PLAY_URL}}', this.playUrl);
  }

  /** Раз в минуту: проверяем расписание и при необходимости публикуем. */
  async tick(now = Date.now()) {
    if (!this.enabled || this.busy) return null;
    const state = this.state();
    const verdict = isDue({ now, state, schedule: this.schedule, total: this.queue().length });

    if (!verdict.due) {
      if (state.index >= this.queue().length && !state.warnedEmpty) {
        state.warnedEmpty = true;
        this.store.scheduleSave();
        await this.notifyOwnersQueueEmpty().catch(() => {});
      }
      return null;
    }

    return this.publishNext(now);
  }

  /** Публикует следующий пост и двигает очередь. */
  async publishNext(now = Date.now()) {
    if (!this.enabled) return { ok: false, error: 'Канал не подключён.' };
    if (this.busy) return { ok: false, error: 'Публикация уже идёт.' };

    const state = this.state();
    const post = this.nextPost();
    if (!post) return { ok: false, error: 'Посты в очереди закончились.' };

    this.busy = true;
    try {
      const sent = await this.bot.api.sendMessage(this.channelId, this.render(post), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [[{ text: '🎭 Играть в мафию', url: this.playUrl }]],
        },
      });

      if (post.pin) {
        await this.bot.api
          .pinChatMessage(this.channelId, sent.message_id, { disable_notification: true })
          .catch(() => { /* прав на закрепление может не быть — не критично */ });
      }

      // Сдвигаем очередь только после успешной отправки:
      // если Telegram ответил ошибкой, пост не должен потеряться.
      state.index += 1;
      state.lastDay = dayKey(now);
      state.warnedEmpty = false;
      this.store.scheduleSave();

      console.log(`[канал] опубликован пост «${post.title}» (${state.index}/${this.queue().length})`);
      return { ok: true, post, remaining: this.remaining() };
    } catch (err) {
      const msg = err?.description || err?.message || String(err);
      console.error('[канал] не удалось опубликовать:', msg);
      return { ok: false, error: msg };
    } finally {
      this.busy = false;
    }
  }

  /** Добавить свой пост в конец очереди. */
  addPost(text, title = 'Свой пост') {
    const clean = String(text || '').trim();
    if (!clean) return { ok: false, error: 'Пустой текст.' };
    if (clean.length > 4000) return { ok: false, error: 'Слишком длинный пост: Telegram не пропустит больше 4096 символов.' };
    const state = this.state();
    state.extra.push({ id: `custom-${state.extra.length + 1}`, title, text: clean });
    state.warnedEmpty = false;
    this.store.scheduleSave();
    return { ok: true, remaining: this.remaining() };
  }

  setPaused(paused) {
    const state = this.state();
    state.paused = !!paused;
    this.store.scheduleSave();
    return { ok: true, paused: state.paused };
  }

  /** Когда выйдет следующий пост — человекочитаемо. */
  nextRunDescription(now = Date.now()) {
    const state = this.state();
    if (state.paused) return 'публикация на паузе';
    if (this.remaining() === 0) return 'очередь пуста';

    const today = dayKey(now);
    let day = today;
    if (state.lastDay) {
      const passed = daysBetween(state.lastDay, today);
      if (passed < this.schedule.everyDays) {
        const wait = this.schedule.everyDays - passed;
        day = dayKey(Date.parse(`${today}T00:00:00Z`) + wait * 86400000);
      }
    }
    const at = scheduledTimeOn(Date.parse(`${day}T00:00:00Z`), this.schedule);
    if (day === today && now >= at) return 'в ближайшую минуту';

    const hh = String(this.schedule.hourUtc).padStart(2, '0');
    const mm = String(this.schedule.minuteUtc).padStart(2, '0');
    return `${day} в ${hh}:${mm} UTC`;
  }

  async notifyOwnersQueueEmpty() {
    console.log('[канал] очередь постов закончилась');
  }
}
