/**
 * Удостоверение игрока на устройстве: имя, фамилия, возраст, пол, фото.
 *
 * Профиль живёт у самого игрока — в localStorage и в облаке Telegram
 * (CloudStorage). Сервер на бесплатном Render забывает всё при каждом
 * перезапуске, поэтому приложение присылает профиль при каждом входе.
 * Облако нужно, чтобы профиль пережил очистку памяти приложения
 * и появился на втором устройстве.
 *
 * Спор копий решается просто: побеждает та, что сохранена позже
 * (поле updatedAt).
 */

import { tg } from './tg.js';

const LOCAL_KEY = 'mafia_profile';
const CLOUD_KEY = 'profile';
const CLOUD_PHOTO_PREFIX = 'pp_';
// Значение в CloudStorage — не длиннее 4096 символов, фото режем на куски
const CLOUD_CHUNK = 4000;
const CLOUD_TIMEOUT_MS = 5000;

export const NAME_MAX = 24;

// Снимок 4:5, как рамка удостоверения. Крупнее всего фото показывается
// в самой карточке, а там оно шириной с треть экрана — больше не нужно.
const PHOTO_W = 300;
const PHOTO_H = 375;
// Сервер принимает до 100 КБ; держимся с запасом
const PHOTO_MAX_CHARS = 90 * 1024;
const PHOTO_PREFIX = 'data:image/jpeg;base64,';

const cut = (value) => Array.from(String(value || '')).slice(0, NAME_MAX).join('');

/** Приводит что угодно к форме профиля. Мусор превращается в пустые поля. */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const age = Number(raw.age);
  const photo = typeof raw.photo === 'string'
    && raw.photo.startsWith(PHOTO_PREFIX)
    && raw.photo.length <= PHOTO_MAX_CHARS ? raw.photo : null;
  return {
    firstName: cut(raw.firstName),
    lastName: cut(raw.lastName),
    age: raw.age !== null && Number.isInteger(age) && age >= 1 && age <= 99 ? age : null,
    gender: raw.gender === 'male' || raw.gender === 'female' ? raw.gender : null,
    photo,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

/** Более свежая из двух копий. */
export function fresher(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
}

export function profileName(p) {
  return [p?.firstName, p?.lastName].filter(Boolean).join(' ');
}

export function loadLocalProfile() {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'));
  } catch {
    return null;
  }
}

export function saveLocalProfile(p) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(p));
  } catch { /* приватный режим браузера — останется облако и сервер */ }
}

// ─────────── облако Telegram ───────────

function cloud() {
  const storage = tg?.CloudStorage;
  if (!storage || !tg.isVersionAtLeast?.('6.9')) return null;
  return storage;
}

/** Колбэки CloudStorage — в обещание. С тайм-аутом: старые клиенты молчат. */
function call(method, ...args) {
  const storage = cloud();
  if (!storage) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), CLOUD_TIMEOUT_MS);
    try {
      storage[method](...args, (err, value) => {
        clearTimeout(timer);
        resolve(err ? null : value);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export async function loadCloudProfile() {
  const raw = await call('getItem', CLOUD_KEY);
  if (!raw) return null;

  let meta;
  try { meta = JSON.parse(raw); } catch { return null; }

  let photo = null;
  const parts = Number(meta?.photoParts) || 0;
  if (meta?.photoKey && parts > 0 && parts <= 40) {
    const keys = Array.from({ length: parts }, (_, i) => `${meta.photoKey}_${i}`);
    const values = await call('getItems', keys);
    if (values) photo = keys.map((k) => values[k] || '').join('');
  }
  return normalizeProfile({ ...meta, photo });
}

async function writeCloud(p) {
  if (!cloud()) return;
  const { photo, ...fields } = p;
  const meta = { ...fields, photoKey: null, photoParts: 0 };

  if (photo) {
    // Куски пишем под новым именем и только потом переключаем на них
    // запись профиля: другое устройство не соберёт фото из половины
    // старых и половины новых кусков.
    meta.photoKey = `${CLOUD_PHOTO_PREFIX}${Math.round(p.updatedAt || Date.now()).toString(36)}`;
    const parts = [];
    for (let i = 0; i < photo.length; i += CLOUD_CHUNK) parts.push(photo.slice(i, i + CLOUD_CHUNK));
    meta.photoParts = parts.length;
    const written = await Promise.all(parts.map((part, i) => call('setItem', `${meta.photoKey}_${i}`, part)));
    if (written.some((ok) => !ok)) return;
  }

  if (!(await call('setItem', CLOUD_KEY, JSON.stringify(meta)))) return;

  // Куски прежних фото больше не нужны
  const keys = (await call('getKeys')) || [];
  const stale = keys.filter((k) => k.startsWith(CLOUD_PHOTO_PREFIX)
    && !(meta.photoKey && k.startsWith(`${meta.photoKey}_`)));
  if (stale.length) await call('removeItems', stale);
}

// Сохранения идут строго по очереди: иначе уборка старых кусков
// одного сохранения могла бы стереть куски соседнего.
let cloudQueue = Promise.resolve();

export function saveCloudProfile(p) {
  cloudQueue = cloudQueue.then(() => writeCloud(p)).catch(() => {});
  return cloudQueue;
}

// ─────────── фото ───────────

/**
 * Готовит выбранный снимок: обрезает под рамку 4:5 и ужимает в JPEG.
 * Заодно пропадают EXIF и геометка — холст их не переносит.
 */
export async function photoFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    if (!sw || !sh) throw new Error('empty image');

    const ratio = PHOTO_W / PHOTO_H;
    let cw = sw;
    let ch = sw / ratio;
    if (ch > sh) {
      ch = sh;
      cw = sh * ratio;
    }
    // По вертикали берём выше центра: на портретах лицо обычно вверху
    const sx = (sw - cw) / 2;
    const sy = (sh - ch) * 0.3;

    const scale = Math.min(1, PHOTO_W / cw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cw * scale));
    canvas.height = Math.max(1, Math.round(ch * scale));

    const ctx = canvas.getContext('2d');
    // Прозрачный PNG иначе ляжет на чёрное
    ctx.fillStyle = '#ddd2b8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.86, 0.78, 0.68, 0.56, 0.44]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.startsWith(PHOTO_PREFIX) && data.length <= PHOTO_MAX_CHARS) return data;
    }
    throw new Error('photo too big');
  } finally {
    URL.revokeObjectURL(url);
  }
}
