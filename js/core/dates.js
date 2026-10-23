// Dates are stored as local "YYYY-MM-DD" strings so they sort and compare as plain strings.

const pad = (n) => String(n).padStart(2, '0');

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

/** Whole days from a to b (b - a). Uses rounding so daylight-saving shifts don't matter. */
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86_400_000);

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

export function dayOfYear(iso) {
  const d = parseISO(iso);
  return daysBetween(`${d.getFullYear()}-01-01`, iso);
}
