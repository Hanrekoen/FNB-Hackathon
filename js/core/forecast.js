// Explainable forecasts from the user's own history: variable bill estimates, spending pace,
// run-out date and spending patterns. Every result carries the numbers it was based on.

import { addDays, daysBetween, parseISO } from './dates.js';

export const ESTIMATE_WINDOW_DAYS = 42;
export const MIN_ESTIMATE_TXS = 3;
export const PACE_WINDOW_DAYS = 14;
export const INSIGHT_MIN_DAYS = 21;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const roundUpTo10Rand = (cents) => Math.ceil(cents / 1000) * 1000;
const inWindow = (date, today, days) => date > addDays(today, -days) && date <= today;

/** Planning amount for a bill whose amount varies (e.g. fuel), from the last 6 weeks of spending. */
export function variableEstimate(bill, txs, today) {
  const window = txs.filter((t) => t.type === 'out' && t.category === bill.linkedCategory && inWindow(t.date, today, ESTIMATE_WINDOW_DAYS));
  if (window.length < MIN_ESTIMATE_TXS) return { amount: bill.amount, estimated: false };
  const weekly = sum(window.map((t) => t.amount)) / (ESTIMATE_WINDOW_DAYS / 7);
  const amount = roundUpTo10Rand(bill.frequency === 'weekly' ? weekly : (weekly * 52) / 12);
  return { amount, estimated: true, count: window.length };
}

export function plannedAmount(bill, txs, today) {
  return bill.amountType === 'varies' ? variableEstimate(bill, txs, today).amount : bill.amount;
}

/** What a bill costs per month on average; once-off bills aren't a regular essential. */
export function monthlyEquivalent(bill, txs, today) {
  if (bill.frequency === 'once') return 0;
  const amount = plannedAmount(bill, txs, today);
  return bill.frequency === 'weekly' ? Math.round((amount * 52) / 12) : amount;
}

/** Average daily discretionary spending (bill payments excluded) over the last 14 days. */
export function spendingPace(txs, today) {
  const spent = sum(txs.filter((t) => t.type === 'out' && !t.billId && inWindow(t.date, today, PACE_WINDOW_DAYS)).map((t) => t.amount));
  return { perDay: Math.round(spent / PACE_WINDOW_DAYS), spent, days: PACE_WINDOW_DAYS };
}

/** At the current pace, when does free money run out, and is that before the next income? */
export function runOutForecast(free, pace, today, nextIncome) {
  if (pace.perDay <= 0) return { onTrack: true, pace };
  const days = Math.floor(Math.max(0, free) / pace.perDay);
  const date = addDays(today, days);
  if (date >= nextIncome) return { onTrack: true, pace, date };
  return { onTrack: false, pace, date, gap: daysBetween(date, nextIncome) };
}

/** Weekday with the highest average discretionary spend over the last 6 weeks. */
export function weekdayInsight(txs, today) {
  const out = txs.filter((t) => t.type === 'out' && !t.billId);
  const first = out.map((t) => t.date).sort()[0];
  if (!first || daysBetween(first, today) < INSIGHT_MIN_DAYS) return null;
  const from = first > addDays(today, -ESTIMATE_WINDOW_DAYS) ? first : addDays(today, -ESTIMATE_WINDOW_DAYS + 1);
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (let d = from; d <= today; d = addDays(d, 1)) counts[parseISO(d).getDay()]++;
  for (const t of out) if (t.date >= from && t.date <= today) totals[parseISO(t.date).getDay()] += t.amount;
  const averages = totals.map((x, i) => (counts[i] ? Math.round(x / counts[i]) : 0));
  const weekday = averages.indexOf(Math.max(...averages));
  if (!averages[weekday]) return null;
  return { weekday, average: averages[weekday], total: totals[weekday], count: counts[weekday], from };
}
