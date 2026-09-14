/**
 * Профиль игрока: имя, фамилия, возраст, пол и фотография.
 *
 * Хозяин профиля — устройство игрока: приложение хранит его у себя
 * (и в облаке Telegram) и присылает при каждом входе. Серверу профиль
 * нужен, пока игрок здесь, — чтобы за столом стояли его имя и фото.
 * Поэтому на диск здесь ничего не пишется: на бесплатном Render запись
 * всё равно стиралась бы при каждом перезапуске, а телефон помнит и так.
 *
 * Фото не ездит внутри состояния комнаты: оно весит десятки килобайт,
 * а состояние рассылается на каждый ход. У снимка есть короткий адрес
 * /api/photo/<хеш>.jpg — браузер скачает его один раз и закеширует.
 *
 * Возраст и пол остаются между сервером и владельцем: в состояние
 * комнаты уходят только имя и адрес фото.
 */

import crypto from 'node:crypto';

export const NAME_MAX = 24;
export const AGE_MIN = 1;
export const AGE_MAX = 99;
export const GENDERS = ['male', 'female'];

/** Приложение ужимает снимок до ~40 КБ; предел с запасом. */
export const PHOTO_MAX_BYTES = 100 * 1024;

const MAX_PROFILES = 2000;

// Снимок, который сменили, живёт ещё несколько часов: в идущей партии
// у игрока остаётся старое фото до конца, и оно не должно пропасть.
const PHOTO_GRACE_MS = 6 * 60 * 60 * 1000;
// Но и копиться бесконечно брошенным снимкам нельзя
const RELEASED_PHOTOS_MAX_BYTES = 24 * 1024 * 1024;

const DATA_URL = /^data:image[/]jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

// Управляющие и невидимые символы, переключатели направления текста:
// с ними можно прикинуться чужим именем или сломать вёрстку.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
// Больше двух диакритик подряд — это уже «залго», которое лезет на соседние строки
const STACKED_MARKS = /(\p{M}{2})\p{M}+/gu;

export function cleanName(value) {
  const text = String(value ?? '')
    .replace(INVISIBLE, '')
    .replace(STACKED_MARKS, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // Array.from режет по символам, а не по половинкам эмодзи
  return Array.from(text).slice(0, NAME_MAX).join('').trim();
}

export const photoUrl = (hash) => `/api/photo/${hash}.jpg`;

/**
 * JPEG из data:-адреса. Тип проверяем по сигнатуре файла, а не по
 * заявленному: иначе под видом картинки можно подсунуть что угодно.
 */
export function decodePhoto(dataUrl) {
  if (dataUrl === null || dataUrl === undefined || dataUrl === '') return { ok: true, bytes: null };
  if (typeof dataUrl !== 'string') return { ok: false, code: 'photo_bad' };
  // Длину проверяем до разбора: base64 длиннее исходника на треть
  if (dataUrl.length > Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 32) return { ok: false, code: 'photo_too_big' };

  const m = DATA_URL.exec(dataUrl);
  if (!m) return { ok: false, code: 'photo_bad' };

  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, code: 'photo_too_big' };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, code: 'photo_bad' };
  }
  return { ok: true, bytes };
}

/** Оставляет от присланного только настоящие поля профиля. */
export function sanitizeProfile(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'profile_bad' };

  const photo = decodePhoto(raw.photo);
  if (!photo.ok) return photo;

  const age = raw.age === null || raw.age === '' ? NaN : Number(raw.age);
  const stamp = Number(raw.updatedAt);

  return {
    ok: true,
    profile: {
      firstName: cleanName(raw.firstName),
      lastName: cleanName(raw.lastName),
      age: Number.isInteger(age) && age >= AGE_MIN && age <= AGE_MAX ? age : null,
      gender: GENDERS.includes(raw.gender) ? raw.gender : null,
      photo: photo.bytes,
      // Отметка из будущего навсегда перебивала бы правки с других устройств
      updatedAt: Number.isFinite(stamp) && stamp > 0 && stamp <= now + 86400000 ? stamp : now,
    },
  };
}

export class Profiles {
  constructor({ max = MAX_PROFILES } = {}) {
    this.max = max;
    this.byUser = new Map(); // userId -> {firstName, lastName, age, gender, photoHash, updatedAt}
    this.photos = new Map(); // hash -> {bytes, users: Set<userId>, releasedAt}
  }

  get(userId) {
    return this.byUser.get(Number(userId)) || null;
  }

  /**
   * Принять профиль от игрока.
   *
   * При входе (force: false) профиль с устройства берём, только если он
   * не старше того, что уже есть: второе устройство с устаревшей копией
   * не должно затирать свежую правку. Явное сохранение (force: true)
   * принимается всегда и получает отметку новее прежней.
   */
  save(userId, raw, { force = false, now = Date.now() } = {}) {
    const res = sanitizeProfile(raw, now);
    if (!res.ok) return res;

    const id = Number(userId);
    const current = this.byUser.get(id) || null;
    // Map помнит порядок вставки: переставляем игрока в конец,
    // чтобы при переполнении вытеснялись самые давние
    this.byUser.delete(id);

    if (current && !force && current.updatedAt > res.profile.updatedAt) {
      this.byUser.set(id, current);
      return { ok: true, profile: current, changed: false };
    }

    const { photo, ...fields } = res.profile;
    if (current && force && fields.updatedAt <= current.updatedAt) {
      fields.updatedAt = current.updatedAt + 1;
    }

    const photoHash = photo ? this.keepPhoto(id, photo) : null;
    if (current?.photoHash && current.photoHash !== photoHash) {
      this.releasePhoto(id, current.photoHash, now);
    }

    const next = { ...fields, photoHash };
    this.byUser.set(id, next);
    this.evict(now);
    return { ok: true, profile: next, changed: true };
  }

  keepPhoto(userId, bytes) {
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24);
    let entry = this.photos.get(hash);
    if (!entry) {
      entry = { bytes, users: new Set(), releasedAt: null };
      this.photos.set(hash, entry);
    }
    entry.users.add(userId);
    entry.releasedAt = null;
    return hash;
  }

  releasePhoto(userId, hash, now = Date.now()) {
    const entry = this.photos.get(hash);
    if (!entry) return;
    entry.users.delete(userId);
    if (entry.users.size === 0) entry.releasedAt = now;
  }

  evict(now = Date.now()) {
    while (this.byUser.size > this.max) {
      const [oldest, profile] = this.byUser.entries().next().value;
      this.byUser.delete(oldest);
      if (profile.photoHash) this.releasePhoto(oldest, profile.photoHash, now);
    }

    const released = [...this.photos.entries()]
      .filter(([, e]) => e.users.size === 0)
      .sort(([, a], [, b]) => a.releasedAt - b.releasedAt);

    let bytes = released.reduce((sum, [, e]) => sum + e.bytes.length, 0);
    for (const [hash, entry] of released) {
      if (now - entry.releasedAt <= PHOTO_GRACE_MS && bytes <= RELEASED_PHOTOS_MAX_BYTES) break;
      this.photos.delete(hash);
      bytes -= entry.bytes.length;
    }
  }

  /** Байты снимка по хешу из адреса /api/photo/<хеш>.jpg. */
  photo(hash) {
    return this.photos.get(String(hash))?.bytes || null;
  }

  /** Как игрок выглядит за столом: профиль поверх данных Telegram. */
  identity(user) {
    const p = this.get(user.id);
    if (!p) return user;
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return {
      ...user,
      name: name || user.name,
      photo: p.photoHash ? photoUrl(p.photoHash) : user.photo,
    };
  }

  /**
   * Профиль для самого владельца — вместе со снимком, чтобы новое
   * устройство могло сохранить его у себя целиком.
   */
  ownerView(userId) {
    const p = this.get(userId);
    if (!p) return null;
    const bytes = p.photoHash ? this.photo(p.photoHash) : null;
    return {
      firstName: p.firstName,
      lastName: p.lastName,
      age: p.age,
      gender: p.gender,
      photo: bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null,
      updatedAt: p.updatedAt,
    };
  }
}
