import { useCallback, useEffect, useRef, useState } from 'react';
import { tg } from './tg.js';

const RECONNECT_BASE = 800;
const RECONNECT_MAX = 8000;

/**
 * Код комнаты переживает перезагрузку страницы.
 *
 * Telegram на телефоне может выгрузить приложение из памяти, пока экран
 * выключен. При возвращении страница открывается заново и без этой памяти
 * игрок оказался бы в главном меню вместо своей комнаты.
 */
const ROOM_KEY = 'mafia_room';

function rememberRoom(code) {
  try {
    if (code) localStorage.setItem(ROOM_KEY, code);
    else localStorage.removeItem(ROOM_KEY);
  } catch { /* приватный режим браузера — переживём */ }
}

function recallRoom() {
  try {
    return localStorage.getItem(ROOM_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Режим отладки: адрес вида ?dev=1 открывает игру в обычном браузере под
 * выдуманным игроком. Меняя цифру, можно открыть несколько вкладок и сыграть
 * партию в одиночку. На сервере это работает, только если включена
 * переменная ALLOW_DEV_AUTH — на боевом сервере её держат выключенной.
 */
function devIdentity() {
  const url = new URLSearchParams(window.location.search);
  const slot = url.get('dev');
  if (!slot) return null;
  const n = Math.max(1, Math.min(99, Number(slot) || 1));
  return {
    id: 900000000 + n, // заведомо не пересекается с настоящими Telegram id
    name: `Игрок ${n}`,
  };
}

/**
 * Соединение с игровым сервером.
 *
 * Само переподключается при обрыве и заново авторизуется: игрок опознаётся
 * по Telegram id, поэтому после потери связи он возвращается на своё место.
 */
export function useGameSocket({ autoCode }) {
  const [status, setStatus] = useState('connecting'); // connecting | online | offline | rejected
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const [rooms, setRooms] = useState(null);
  const [clockSkew, setClockSkew] = useState(0);

  const wsRef = useRef(null);
  const attemptsRef = useRef(0);
  const closedRef = useRef(false);
  const autoCodeRef = useRef(autoCode || recallRoom());
  const inRoomRef = useRef(null);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptsRef.current = 0;
      const payload = {
        t: 'auth',
        initData: tg?.initData || '',
        // код из ссылки нужен только при самом первом входе
        code: inRoomRef.current || autoCodeRef.current || null,
      };
      if (!tg?.initData) {
        const dev = devIdentity();
        if (dev) payload.dev = dev;
      }
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.t) {
        case 'auth_ok':
          setUser(msg.user);
          setStats(msg.stats);
          setStatus('online');
          setError(null);
          break;
        case 'state':
          setState(msg.state);
          inRoomRef.current = msg.state.code;
          rememberRoom(msg.state.code);
          setClockSkew(Date.now() - msg.state.serverTime);
          break;
        case 'joined':
          setJoinError(null);
          autoCodeRef.current = null;
          break;
        case 'join_failed':
          // комнаты больше нет — забываем её, иначе будем ломиться туда вечно
          setJoinError({ code: msg.reason, params: null });
          autoCodeRef.current = null;
          rememberRoom(null);
          break;
        case 'left':
          setState(null);
          inRoomRef.current = null;
          rememberRoom(null);
          break;
        case 'rooms':
          setRooms(msg.list || []);
          break;
        case 'error':
          // Сервер присылает код, а не готовую фразу: язык выбирает приложение
          setError({ code: msg.code, params: msg.params });
          break;
        case 'fatal':
          // Сервер отказал окончательно — переподключаться бессмысленно
          closedRef.current = true;
          setError({ code: msg.code, params: msg.params });
          setStatus('rejected');
          break;
        case 'ping':
          ws.send(JSON.stringify({ t: 'pong' }));
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      // Об отказе авторизации сервер сообщает сообщением 'fatal' — оно
      // выставляет closedRef, поэтому обычный обрыв мы не спутаем с отказом.
      if (closedRef.current) return;
      setStatus('offline');
      const delay = Math.min(RECONNECT_MAX, RECONNECT_BASE * 2 ** attemptsRef.current);
      attemptsRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => { /* onclose разберётся */ };
  }, []);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
    };
    // подключаемся один раз за жизнь приложения
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendRaw = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    setError({ code: 'no_connection', params: null });
    return false;
  }, []);

  const actions = {
    create: (settings) => sendRaw({ t: 'create', settings }),
    playBots: (players, settings) => sendRaw({ t: 'play_bots', players, settings }),
    addBot: () => sendRaw({ t: 'add_bot' }),
    removeBot: (userId = null) => sendRaw({ t: 'remove_bot', userId }),
    join: (code) => { setJoinError(null); return sendRaw({ t: 'join', code }); },
    listRooms: () => sendRaw({ t: 'rooms' }),
    leave: () => sendRaw({ t: 'leave' }),
    start: () => sendRaw({ t: 'start' }),
    restart: () => sendRaw({ t: 'restart' }),
    hostNext: () => sendRaw({ t: 'host_next' }),
    nightAction: (target) => sendRaw({ t: 'night_action', target }),
    vote: (target) => sendRaw({ t: 'vote', target }),
    ready: (value) => sendRaw({ t: 'ready', value }),
    chat: (text) => sendRaw({ t: 'chat', text }),
    settings: (patch) => sendRaw({ t: 'settings', settings: patch }),
    kick: (userId) => sendRaw({ t: 'kick', userId }),
  };

  return { status, state, user, stats, error, joinError, rooms, clockSkew, actions, clearError: () => setError(null) };
}
