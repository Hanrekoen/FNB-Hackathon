// Month-end sweep: money earmarked for saving during a month moves into the emergency fund and
// accepted goal plans after the month ends. A PWA has no background jobs, so this runs the first
// time the app renders in a new month, once per missed month, in order.

import { cashAvailable, goalSaved, monthOf, needsBalance, nextIncome, unsweptEarmarks } from './budget.js';
import { EMERGENCY_STARTER } from './buckets.js';
import { addDays, daysBetween, toISO } from './dates.js';
import { ESSENTIAL_SPENDING, goalTarget, monthlyNeed } from './goals.js';


const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const defaultId = () => crypto.randomUUID();

export function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number);
  return toISO(new Date(y, m, 0));
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return monthOf(toISO(new Date(y, m, 1)));
}

/** Completed months not yet swept, oldest first, starting from the first month with an earmark. */
export function monthsToSweep(data, today) {
  const swept = new Set(data.sweeps.map((w) => w.month));
  const starts = data.earmarks.map((e) => e.month);
  const last = data.sweeps.map((w) => w.month).sort().at(-1);
  if (last) starts.push(nextMonth(last));
  if (!starts.length) return [];
  const months = [];
  for (let m = starts.sort()[0]; m < monthOf(today); m = nextMonth(m)) if (!swept.has(m)) months.push(m);
  return months;
}

/** Enough for everyday essentials (food, transport, airtime, health) until the next income. */
export function livingBuffer(data, today) {
  const from = addDays(today, -30);
  const spent = sum(data.transactions
    .filter((t) => t.type === 'out' && !t.billId && ESSENTIAL_SPENDING.includes(t.category) && t.date > from && t.date <= today)
    .map((t) => t.amount));
  const days = Math.max(1, daysBetween(today, nextIncome(data, today).date));
  return Math.ceil((spent / 30) * days);
}

/**
 * Sweeps one month: the emergency earmark first (only from cash that isn't Needs or another
 * month's earmark), then accepted goal plans, nearest deadline first, from their earmark plus
 * leftover cash above the living buffer. Records the sweep and returns it.
 */
export function sweepMonth(data, month, today, { emergencyName = '', newId = defaultId } = {}) {
  const date = lastDayOf(month);
  const mine = data.earmarks.filter((e) => e.month === month);
  const others = sum(unsweptEarmarks(data).filter((e) => e.month !== month).map((e) => e.amount));
  let free = cashAvailable(data.transactions) - needsBalance(data.transactions) - others;
  const save = (goalId, amount) => data.transactions.push({ id: newId(), type: 'save', amount, goalId, category: 'save', note: '', date, sweep: month });

  const earmarked = sum(mine.filter((e) => e.kind === 'emergency').map((e) => e.amount));
  let fund = data.goals.find((g) => g.kind === 'emergency');
  const room = fund ? Math.max(0, goalTarget(data, fund, today) - goalSaved(data.transactions, fund.id)) : Infinity;
  // Once the safety net is full, its share goes to goals instead.
  let pool = Math.max(0, earmarked - room);
  const emergencyWanted = earmarked - pool;
  const emergency = Math.min(emergencyWanted, Math.max(0, free));
  if (emergency > 0) {
    if (!fund) {
      fund = { id: newId(), name: emergencyName, target: EMERGENCY_STARTER, kind: 'emergency' };
      data.goals.push(fund);
    }
    save(fund.id, emergency);
    free -= emergency;
  }

  const buffer = livingBuffer(data, today);
  const goals = [];
  const planned = data.goals.filter((g) => g.by && g.plan && goalSaved(data.transactions, g.id) < g.target)
    .sort((a, b) => a.by.localeCompare(b.by));
  for (const g of planned) {
    const want = Math.min(monthlyNeed(data, g.plan.perContribution), g.target - goalSaved(data.transactions, g.id));
    const own = sum(mine.filter((e) => e.kind === 'goal' && e.goalId === g.id).map((e) => e.amount));
    const fromEarmark = Math.min(want, own + pool, Math.max(0, free));
    pool -= Math.max(0, fromEarmark - own);
    free -= fromEarmark;
    // Leftover cash only above what everyday essentials need until the next income.
    const extra = Math.min(want - fromEarmark, Math.max(0, free - buffer));
    free -= extra;
    if (fromEarmark + extra > 0) {
      save(g.id, fromEarmark + extra);
      goals.push({ goalId: g.id, amount: fromEarmark + extra });
    }
  }

  data.earmarks = data.earmarks.filter((e) => e.month !== month);
  const record = { month, emergency, emergencyShort: emergencyWanted - emergency, goals };
  data.sweeps.push(record);
  return { ...record, emergencyEarmarked: earmarked, date };
}

/** Sweeps every completed month not yet swept. Returns what happened, for the Home card. */
export function applySweeps(data, today, opts = {}) {
  return monthsToSweep(data, today).map((m) => sweepMonth(data, m, today, opts));
}
