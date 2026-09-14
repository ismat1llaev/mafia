/**
 * Проверка подлинности Telegram Mini App.
 *
 * Telegram передаёт в мини-апп строку initData, подписанную ключом,
 * производным от токена бота. Проверяем подпись, чтобы никто не мог
 * зайти в игру под чужим именем.
 *
 * Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import crypto from 'node:crypto';

const MAX_AGE_SEC = 60 * 60 * 24; // сутки

let cachedSecret = null;
let cachedToken = null;

function secretKey(botToken) {
  if (cachedToken !== botToken) {
    cachedSecret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    cachedToken = botToken;
  }
  return cachedSecret;
}

/**
 * @param {string} initData  сырая строка window.Telegram.WebApp.initData
 * @param {string} botToken
 * @returns {{ok: true, user: object} | {ok: false, error: string}}
 */
export function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') {
    return { ok: false, code: 'auth_missing' };
  }
  if (!botToken) {
    return { ok: false, code: 'auth_no_token' };
  }

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, code: 'auth_corrupt' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, code: 'auth_no_hash' };

  // Исключается ТОЛЬКО hash. Поле signature (появилось в Bot API 7.10)
  // убирают лишь при сторонней проверке через Ed25519 — в проверке по токену
  // бота оно обязано участвовать, иначе подпись не сойдётся.
  const dataCheckString = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const computed = crypto
    .createHmac('sha256', secretKey(botToken))
    .update(dataCheckString)
    .digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 'auth_bad_hash' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SEC) {
    return { ok: false, code: 'auth_expired' };
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, code: 'auth_bad_profile' };
  }
  if (!user?.id) return { ok: false, code: 'auth_no_user' };

  return {
    ok: true,
    user: normalizeUser(user),
    startParam: params.get('start_param') || null,
  };
}

export function normalizeUser(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return {
    id: Number(user.id),
    name: name || user.username || `Игрок ${user.id}`,
    username: user.username || null,
    photo: user.photo_url || null,
  };
}

/**
 * Псевдо-авторизация для локальной отладки в обычном браузере.
 * Включается только переменной ALLOW_DEV_AUTH=true.
 */
export function devUser(raw) {
  const id = Number(raw?.id) || Math.floor(Math.random() * 1e9);
  return {
    id,
    name: raw?.name || `Тест ${String(id).slice(-4)}`,
    username: raw?.username || null,
    photo: null,
    // такого пользователя нет в Telegram — ему нельзя писать в личку
    isDev: true,
  };
}
