import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { tg } from './tg.js';
import { DICTS, LANGS, translate } from './dict.js';

/**
 * Язык интерфейса: определение, хранение и доступ из компонентов.
 * Сами фразы лежат в dict.js.
 */

const LANG_KEY = 'mafia_lang';

export { LANGS, translate };

/** Язык по умолчанию: сохранённый выбор, иначе язык Telegram. */
export function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* приватный режим */ }

  const code = tg?.initDataUnsafe?.user?.language_code || navigator?.language || '';
  return /^(ru|uk|be|kk|uz|ky|tg|az|hy)/i.test(code) ? 'ru' : 'en';
}

const LangContext = createContext({ lang: 'ru', setLang: () => {}, t: (k) => k });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);

  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* переживём */ }
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (LANGS.includes(next)) setLangState(next);
  }, []);

  const t = useCallback((key, params) => translate(lang, key, params), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return createElement(LangContext.Provider, { value }, children);
}

export function useT() {
  return useContext(LangContext);
}

export { DICTS };
