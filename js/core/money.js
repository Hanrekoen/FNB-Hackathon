// All money is stored as integer cents to avoid floating-point rounding errors.

export const MAX_CENTS = 1_000_000_000; // R10 million: generous ceiling that blocks typos like 1e12

/** Parse user input such as "1 234,50", "R250" or "99.9" into cents. Returns null if invalid. */
export function parseAmount(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^r\s*/i, '').replace(/[\s ']/g, '');
  if (!s) return null;
  // A single comma followed by 1-2 digits is a decimal comma (common in South Africa).
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

/** Like parseAmount, but an empty field means 0. Returns null only for invalid input. */
export function parseOptionalAmount(input) {
  if (typeof input === 'string' && input.trim() === '') return 0;
  return parseAmount(input);
}

/** Parse a percentage like "27,5" or "27.5%" into a number between 0 and 1000. */
export function parsePercent(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/%$/, '').replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 1000 ? n : null;
}

const formatters = new Map();

export function formatMoney(cents, locale = 'en-ZA') {
  let f = formatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency: 'ZAR' });
    formatters.set(locale, f);
  }
  return f.format(cents / 100);
}

export const centsToInput = (cents) => (cents / 100).toFixed(2);
