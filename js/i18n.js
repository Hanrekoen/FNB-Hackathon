import af from './lang/af.js';
import en from './lang/en.js';
import zu from './lang/zu.js';

const DICTS = { en, af, zu };
const LOCALES = { en: 'en-ZA', af: 'af-ZA', zu: 'zu-ZA' };

export const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'zu', name: 'isiZulu' },
];

let lang = 'en';

export function detectLang(langs = globalThis.navigator?.languages ?? []) {
  for (const l of langs) {
    const code = l.slice(0, 2).toLowerCase();
    if (DICTS[code]) return code;
  }
  return 'en';
}

export function setLang(code) {
  lang = DICTS[code] ? code : 'en';
  if (globalThis.document) document.documentElement.lang = lang;
}

export const getLang = () => lang;
export const locale = () => LOCALES[lang];
export const isLang = (code) => code in DICTS;

/** Translate a key, falling back to English. `{name}` placeholders are filled from vars. */
export function t(key, vars) {
  const v = DICTS[lang][key] ?? en[key];
  if (typeof v !== 'string') return key;
  return vars ? v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : v;
}

export function list(key) {
  const v = DICTS[lang][key] ?? en[key];
  return Array.isArray(v) ? v : [];
}
