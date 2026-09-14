/** Обёртка над Telegram WebApp SDK — чтобы приложение не падало в обычном браузере. */

export const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
    tg.setHeaderColor?.('#0d0f14');
    tg.setBackgroundColor?.('#0d0f14');
  } catch { /* старые версии клиента не всё умеют */ }
}

export function haptic(type = 'light') {
  try {
    const h = tg?.HapticFeedback;
    if (!h) return;
    if (type === 'success' || type === 'error' || type === 'warning') h.notificationOccurred(type);
    else if (type === 'select') h.selectionChanged();
    else h.impactOccurred(type);
  } catch { /* haptic не критичен */ }
}

export function showAlert(message) {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}

export function shareLink(url, text) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || '')}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else window.open(share, '_blank');
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  el.remove();
  return Promise.resolve();
}

/** Код комнаты из ссылки (?code=) или из start_param. */
export function initialRoomCode() {
  const fromQuery = new URLSearchParams(window.location.search).get('code');
  const fromStart = tg?.initDataUnsafe?.start_param;
  const raw = fromQuery || fromStart || '';
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export function backButton(visible, handler) {
  if (!tg?.BackButton) return () => {};
  if (visible) {
    tg.BackButton.show();
    tg.BackButton.onClick(handler);
    return () => {
      tg.BackButton.offClick(handler);
      tg.BackButton.hide();
    };
  }
  tg.BackButton.hide();
  return () => {};
}
