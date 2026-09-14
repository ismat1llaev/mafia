/**
 * Удостоверение игрока — профиль, оформленный как карточка мафиози.
 *
 * Значок в левом верхнем углу показывает, под каким именем и с каким фото
 * игрок сидит за столом. Нажатие открывает саму карточку: фото слева, поля
 * справа, как в старых бумагах. Храним всё на устройстве игрока
 * (profile.js), а за стол уходят только имя и фото.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { haptic } from './tg.js';
import { useT } from './i18n.js';
import { IconCamera, IconCheck, IconFedora } from './icons.jsx';
import { NAME_MAX, photoFromFile, profileName } from './profile.js';

const GENDERS = ['male', 'female'];

// Если сервер не ответил на сохранение за это время — профиль всё равно
// лежит на устройстве и уедет на сервер при следующем входе
const SAVE_TIMEOUT_MS = 8000;

/** Силуэт в пустой рамке — как на бланке, куда ещё не вклеили фото. */
function Silhouette() {
  return (
    <svg className="id-silhouette" viewBox="0 0 80 100" aria-hidden="true" focusable="false">
      <path d="M40 18C50.5 18 57 26.5 57 38C57 46 53.5 52.6 48 56V63C60 66 71 71 75.5 78C78 82 79 88 79 94V100H1V94C1 88 2 82 4.5 78C9 71 20 66 32 63V56C26.5 52.6 23 46 23 38C23 26.5 29.5 18 40 18Z" />
    </svg>
  );
}

/** Револьвер в нижней строке карточки. */
function Revolver() {
  return (
    <svg className="idcard-revolver" viewBox="0 0 64 32" aria-hidden="true" focusable="false">
      <path d="M26 7h33a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 59 12H26Z" />
      <path d="M55 4.5h3V7h-3Z" />
      <path d="M28 12.6h21v2H28Z" />
      <rect x="16.5" y="5" width="12" height="11.5" rx="2.2" />
      <path d="M11.5 2.6 15.4 1.8 17.5 6H12.8Z" />
      <path d="M12.6 5.4h5v11.8h-5Z" />
      <path d="M12.8 14.2C10.8 18.4 7.2 24.4 5.1 28.8a1.9 1.9 0 0 0 1.7 2.7h5.6a1.9 1.9 0 0 0 1.8-1.4l2.9-10.3h3.4v-5.6Z" />
      <path className="idcard-revolver-guard" d="M18.6 17.2c.2 4.6 3.6 6 6.6 4.2l.9-4.2" />
    </svg>
  );
}

/** Значок в левом верхнем углу: фото и имя, под которыми игрок сидит за столом. */
export function IdBadge({ user, profile, onOpen }) {
  const { t } = useT();
  const filled = !!profile?.updatedAt;
  const name = profileName(profile) || user?.name || t('profile.badgeEmpty');
  const photo = profile?.photo || user?.photo || null;

  return (
    <button
      type="button"
      className="id-badge"
      aria-haspopup="dialog"
      aria-label={`${t('profile.open')}: ${name}`}
      onClick={() => { haptic('light'); onOpen(); }}
    >
      <span className="id-badge-photo">
        {photo ? <img src={photo} alt="" /> : <Silhouette />}
      </span>
      <span className="id-badge-text">
        <span className="id-badge-brand">{t('profile.brand')}</span>
        <span className="id-badge-name">{name}</span>
      </span>
      {/* Точка-напоминание, пока удостоверение ни разу не заполняли */}
      {!filled && <span className="id-badge-dot" />}
    </button>
  );
}

function draftFrom(profile, user) {
  if (profile?.updatedAt) {
    const { firstName, lastName, age, gender, photo } = profile;
    return { firstName, lastName, age, gender, photo };
  }
  // В первый раз подставляем имя из Telegram — чтобы не набирать его заново
  const [first = '', ...rest] = String(user?.name || '').split(' ');
  return {
    firstName: first.slice(0, NAME_MAX),
    lastName: rest.join(' ').slice(0, NAME_MAX),
    age: null,
    gender: null,
    photo: null,
  };
}

const sameDraft = (a, b) => a.firstName === b.firstName
  && a.lastName === b.lastName
  && a.age === b.age
  && a.gender === b.gender
  && a.photo === b.photo;

/** Сама карточка — окно поверх любого экрана. */
export function IdCard({ user, profile, ack, error, onSave, onClose }) {
  const { t } = useT();
  const titleId = useId();
  const formId = useId();
  const genderId = useId();
  const dialogRef = useRef(null);
  const fileRef = useRef(null);

  const [draft, setDraft] = useState(() => draftFrom(profile, user));
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [sentAt, setSentAt] = useState(null);
  const [notice, setNotice] = useState(null); // 'saved' | 'deferred' | {code, params}

  const saved = profile?.updatedAt ? draftFrom(profile, user) : null;
  const dirty = !saved || !sameDraft(draft, saved);

  const change = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setNotice(null);
  };

  // Фокус в окно, Escape закрывает, страница под окном не прокручивается
  useEffect(() => {
    const before = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Сервер принял профиль. Показываем его версию: он мог почистить имя.
  useEffect(() => {
    if (!sentAt || !ack || ack.at < sentAt) return;
    setSentAt(null);
    setDraft(draftFrom(profile, user));
    setNotice(ack.deferred ? 'deferred' : 'saved');
    haptic('success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ack]);

  useEffect(() => {
    if (!sentAt || !error || error.at < sentAt) return;
    setSentAt(null);
    setNotice({ code: error.code, params: error.params });
    haptic('error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  useEffect(() => {
    if (!sentAt) return undefined;
    const id = setTimeout(() => {
      setSentAt(null);
      setNotice('saved');
    }, SAVE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [sentAt]);

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // тот же файл можно выбрать повторно
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(false);
    try {
      change({ photo: await photoFromFile(file) });
      haptic('light');
    } catch {
      setPhotoError(true);
      haptic('error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!dirty || sentAt || photoBusy) return;
    const next = { ...draft, firstName: draft.firstName.trim(), lastName: draft.lastName.trim() };
    haptic('medium');
    setDraft(next);
    setNotice(null);
    const at = Date.now();
    if (onSave(next)) setSentAt(at);
    else setNotice('saved');
  };

  const done = !dirty && (notice === 'saved' || notice === 'deferred');
  const problem = photoError
    ? t('profile.photoError')
    : notice?.code ? t(`err.${notice.code}`, notice.params) : null;

  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <form id={formId} className="idcard" onSubmit={submit} noValidate>
          <div className="idcard-head">
            <div className="idcard-title" id={titleId}>{t('profile.brand')}</div>
            <div className="idcard-band">{t('profile.band')}</div>
          </div>

          <div className="idcard-body">
            <div className="idcard-photo-col">
              <button
                type="button"
                className="idcard-photo"
                disabled={photoBusy}
                aria-label={t(draft.photo ? 'profile.changePhoto' : 'profile.addPhoto')}
                onClick={() => fileRef.current?.click()}
              >
                {draft.photo ? <img src={draft.photo} alt="" /> : <Silhouette />}
                <span className="idcard-photo-cta">
                  {photoBusy ? <span className="spinner spinner-sm" /> : <IconCamera size={16} />}
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
              {draft.photo && (
                <button type="button" className="idcard-link" onClick={() => change({ photo: null })}>
                  {t('profile.removePhoto')}
                </button>
              )}
            </div>

            <div className="idcard-fields">
              <label className="idcard-field">
                <span className="idcard-label">{t('profile.firstName')}:</span>
                <input
                  className="idcard-input"
                  value={draft.firstName}
                  maxLength={NAME_MAX}
                  autoComplete="given-name"
                  enterKeyHint="next"
                  onChange={(e) => change({ firstName: e.target.value })}
                />
              </label>

              <label className="idcard-field">
                <span className="idcard-label">{t('profile.lastName')}:</span>
                <input
                  className="idcard-input"
                  value={draft.lastName}
                  maxLength={NAME_MAX}
                  autoComplete="family-name"
                  enterKeyHint="next"
                  onChange={(e) => change({ lastName: e.target.value })}
                />
              </label>

              <label className="idcard-field">
                <span className="idcard-label">{t('profile.age')}:</span>
                <input
                  className="idcard-input idcard-input-age"
                  value={draft.age ?? ''}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  autoComplete="off"
                  enterKeyHint="done"
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                    change({ age: Number(digits) >= 1 ? Number(digits) : null });
                  }}
                />
              </label>

              <div className="idcard-field" role="radiogroup" aria-labelledby={genderId}>
                <span className="idcard-label" id={genderId}>{t('profile.gender')}:</span>
                <span className="idcard-genders">
                  {GENDERS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={draft.gender === g}
                      className={`idcard-stamp${draft.gender === g ? ' on' : ''}`}
                      onClick={() => {
                        haptic('select');
                        change({ gender: draft.gender === g ? null : g });
                      }}
                    >
                      {t(`profile.${g}`)}
                    </button>
                  ))}
                </span>
              </div>
            </div>
          </div>

          <div className="idcard-foot" aria-hidden="true">
            <Revolver />
            <span className="idcard-motto">★ La Cosa Nostra ★</span>
            <IconFedora size={28} />
          </div>
        </form>

        {problem && <div className="banner" role="alert">{problem}</div>}

        <div className="sheet-actions">
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={!dirty || !!sentAt || photoBusy}
          >
            {sentAt && t('profile.saving')}
            {!sentAt && done && <><IconCheck size={18} />{t('profile.saved')}</>}
            {!sentAt && !done && t('profile.save')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('profile.close')}
          </button>
        </div>

        <div className="dim center">
          {notice === 'deferred' ? t('profile.deferred') : t('profile.hint')}
        </div>
      </div>
    </div>
  );
}
