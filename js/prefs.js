// Non-sensitive display preferences. Kept outside the vault because they're needed on the
// lock screen (language, text size) before the PIN is entered.

import { detectLang, isLang, setLang } from './i18n.js';

const KEY = 'imali.prefs';
const DEFAULTS = { lang: null, large: false, contrast: false, autoLockMin: 3, numericPin: true };
export const AUTO_LOCK_OPTIONS = [1, 3, 5, 10];

export function loadPrefs() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    // Storage blocked or corrupt: fall back to defaults.
  }
  const p = { ...DEFAULTS };
  if (isLang(stored.lang)) p.lang = stored.lang;
  for (const k of ['large', 'contrast', 'numericPin']) if (typeof stored[k] === 'boolean') p[k] = stored[k];
  if (AUTO_LOCK_OPTIONS.includes(stored.autoLockMin)) p.autoLockMin = stored.autoLockMin;
  return p;
}

export function savePrefs(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Not fatal: preferences just won't persist.
  }
}

export function applyPrefs(p) {
  const root = document.documentElement;
  root.classList.toggle('large', p.large);
  root.classList.toggle('hc', p.contrast);
  setLang(p.lang ?? detectLang());
}
