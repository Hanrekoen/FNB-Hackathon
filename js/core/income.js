// How the user says they're paid, and what their income history says. Planning stays
// cautious: when unsure, assume money comes later rather than sooner.

import { addDays, daysBetween, daysInMonth, parseISO, toISO } from './dates.js';

export const PATTERNS = ['monthly', 'biweekly', 'weekly', 'varies'];
export const STATED_GAP = { monthly: 30, biweekly: 14, weekly: 7 };
export const NUDGE_SNOOZE_DAYS = 14;

export function defaultIncome() {
  return { pattern: 'varies', payDay: null, payWeekday: null, anchorDate: null, nudgeSnoozedUntil: null };
}

/** Distinct income dates, oldest first. */
export const incomeDates = (txs) => [...new Set(txs.filter((t) => t.type === 'in').map((t) => t.date))].sort();

/** Days between consecutive income dates (the most recent `limit` gaps). */
export function incomeGaps(txs, limit = 6) {
  const dates = incomeDates(txs);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  return gaps.slice(-limit);
}

/** Nearest-rank percentile (p in 0..100); always returns a value that really occurred. */
export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function monthlyPayday(year, month, payDay) {
  const d = new Date(year, month, Math.min(payDay, daysInMonth(year, month)));
  // Employers usually pay on the last working day before a weekend payday.
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1);
  if (dow === 0) d.setDate(d.getDate() - 2);
  return toISO(d);
}

function candidates(income, today) {
  const t = parseISO(today);
  if (income.pattern === 'monthly') {
    return [0, 1, 2].map((m) => monthlyPayday(t.getFullYear(), t.getMonth() + m, income.payDay));
  }
  if (income.pattern === 'weekly') {
    const first = addDays(today, (income.payWeekday - t.getDay() + 7) % 7);
    return [0, 7, 14].map((n) => addDays(first, n));
  }
  const behind = daysBetween(income.anchorDate, today);
  const first = addDays(income.anchorDate, Math.max(0, Math.ceil(behind / 14)) * 14);
  return [0, 14, 28].map((n) => addDays(first, n));
}

export function hasPayday(income) {
  if (!income) return false;
  if (income.pattern === 'monthly') return Number.isInteger(income.payDay);
  if (income.pattern === 'weekly') return Number.isInteger(income.payWeekday);
  if (income.pattern === 'biweekly') return typeof income.anchorDate === 'string';
  return false;
}

/**
 * Next payday on or after today. A payday is skipped if income already arrived within a few
 * days before it (paid early), so the money isn't planned to last only until tomorrow.
 */
export function nextPayday(income, today, lastIncome = null) {
  if (!hasPayday(income)) return null;
  const slack = Math.min(3, Math.floor(STATED_GAP[income.pattern] / 3));
  return candidates(income, today).find((d) => d >= today && (!lastIncome || daysBetween(lastIncome, d) > slack));
}

/** Returns { stated, learned } when real income timing clearly differs from the stated pattern. */
export function patternMismatch(income, txs, today) {
  const stated = STATED_GAP[income?.pattern];
  if (!stated) return null;
  if (income.nudgeSnoozedUntil && today < income.nudgeSnoozedUntil) return null;
  if (incomeDates(txs).length < 3) return null;
  const learned = median(incomeGaps(txs));
  const diff = Math.abs(learned - stated);
  return diff > stated * 0.4 && diff >= 3 ? { stated, learned } : null;
}
