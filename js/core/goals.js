// Savings goals with a deadline: how much to put aside per payday, whether that fits the
// user's income, and if not, what would make it fit. Every result carries the numbers it
// used, so the screen can explain itself.

import { goalSaved } from './budget.js';
import { CUTTABLE } from './categories.js';
import { addDays, daysBetween } from './dates.js';
import { monthlyEquivalent, spendingPace } from './forecast.js';
import { cautiousMonthlyIncome, hasPayday, incomeDates, nextPayday } from './income.js';

export const MIN_INCOMES = 3;
export const MIN_HISTORY_DAYS = 21;
export const CUT_WINDOW_DAYS = 30;
const MAX_CONTRIBUTIONS = 520; // ten years of weekly paydays

export const EMERGENCY_STARTER = 100_000; // R1 000, until there are bills or spending to go on
export const DEFAULT_EMERGENCY_MONTHS = 6;
// Everyday essentials that aren't bills: counted in the safety-net target and the living buffer.
export const ESSENTIAL_SPENDING = ['food', 'transport', 'airtime', 'health'];

export const PER_MONTH = { monthly: 1, biweekly: 26 / 12, weekly: 52 / 12, varies: 52 / 12 };

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const floorTo10Rand = (cents) => Math.floor(cents / 1000) * 1000;
const ceilTo10Rand = (cents) => Math.ceil(cents / 1000) * 1000;

/** "It varies" saves weekly, because there is no payday to count. */
export const contributionUnit = (data) => (hasPayday(data.income) ? 'payday' : 'week');
const perMonth = (data) => (hasPayday(data.income) ? PER_MONTH[data.income.pattern] : PER_MONTH.varies);

/** Date of each upcoming contribution, in order, up to `limit` of them. */
function contributionDates(data, today, limit, until = null, countToday = false) {
  const dates = [];
  if (!hasPayday(data.income)) {
    for (let n = 1; n <= limit; n++) {
      const d = addDays(today, 7 * n);
      if (until && d > until) break;
      dates.push(d);
    }
    return dates;
  }
  // An income already recorded today means today's payday has been and gone, unless we are
  // splitting that very income right now.
  let last = incomeDates(data.transactions).filter((d) => !countToday || d < today).at(-1) ?? null;
  let from = today;
  while (dates.length < limit) {
    const d = nextPayday(data.income, from, last);
    if (!d || (until && d > until)) break;
    dates.push(d);
    last = d;
    from = addDays(d, 1);
  }
  return dates;
}

/** Paydays (or weeks, for "It varies") between today and the deadline; at least 1 while the deadline is ahead. */
export function contributionsLeft(data, today, by, countToday = false) {
  if (!by || by <= today) return 0;
  if (!hasPayday(data.income)) return Math.max(1, Math.floor(daysBetween(today, by) / 7));
  return Math.max(1, contributionDates(data, today, MAX_CONTRIBUTIONS, by, countToday).length);
}

/** Amount for each contribution, rounded up so the goal is never missed by a few cents. */
export function perContribution(remaining, contributions) {
  return contributions > 0 ? Math.ceil(remaining / contributions) : remaining;
}

export const monthlyNeed = (data, perAmount) => Math.ceil(perAmount * perMonth(data));

export function hasEnoughHistory(data, today) {
  const first = data.transactions.map((t) => t.date).sort()[0];
  return incomeDates(data.transactions).length >= MIN_INCOMES && !!first && daysBetween(first, today) >= MIN_HISTORY_DAYS;
}

/**
 * What essentials cost in a month: essential bills (not wants, not once-off) plus everyday
 * essential spending (groceries, transport, airtime, health) averaged over the last 90 days, or
 * over the days there are if fewer. The parts are returned for "How we worked this out".
 */
export function monthlyEssentials(data, today) {
  const bills = sum(data.bills.filter((b) => b.kind !== 'want' && b.frequency !== 'once').map((b) => monthlyEquivalent(b, data.transactions, today)));
  const first = data.transactions.map((t) => t.date).sort()[0];
  const days = first ? Math.min(90, Math.max(1, daysBetween(first, today) + 1)) : 0;
  const from = addDays(today, -days);
  const spent = sum(data.transactions
    .filter((t) => t.type === 'out' && !t.billId && ESSENTIAL_SPENDING.includes(t.category) && t.date > from && t.date <= today)
    .map((t) => t.amount));
  const spending = days ? Math.round((spent * 30) / days) : 0;
  return { bills, spending, total: bills + spending, days };
}

/**
 * The target a goal is working towards. The emergency fund's is automatic: the chosen number of
 * months of essentials, rounded up to R100, so it grows with the user's real costs.
 */
export function goalTarget(data, goal, today) {
  if (goal.kind !== 'emergency') return goal.target;
  const { total } = monthlyEssentials(data, today);
  const months = data.settings.emergencyMonths ?? DEFAULT_EMERGENCY_MONTHS;
  return total > 0 ? Math.ceil((total * months) / 10_000) * 10_000 : EMERGENCY_STARTER;
}

/** Undated, unfinished goals get the savings % from each income, the emergency fund first. */
export function savingsTarget(data, today) {
  const open = data.goals.filter((g) => !g.by && goalSaved(data.transactions, g.id) < goalTarget(data, g, today));
  return open.find((g) => g.kind === 'emergency') ?? open[0] ?? null;
}

/** Without any emergency fund, the savings % starts one; once every undated goal is full it stops. */
export function savingsShare(data, amount, today) {
  const target = savingsTarget(data, today);
  if (!target && data.goals.some((g) => g.kind === 'emergency')) return 0;
  const share = Math.floor((amount * data.settings.savePercent) / 100);
  return target ? Math.min(share, goalTarget(data, target, today) - goalSaved(data.transactions, target.id)) : share;
}

/** Monthly amount a dated goal still asks for, or 0 once it's reached or its date has passed. */
function goalMonthlyNeed(data, goal, today) {
  const remaining = goal.target - goalSaved(data.transactions, goal.id);
  if (remaining <= 0 || !goal.by || goal.by <= today) return 0;
  return monthlyNeed(data, perContribution(remaining, contributionsLeft(data, today, goal.by)));
}

/** Dated goals that get money before this one: an earlier deadline, or the same one but created first. */
function goalsAhead(data, goal) {
  const index = data.goals.findIndex((g) => g.id === goal.id);
  return data.goals.filter((g, i) => g.by && g.id !== goal.id && (g.by < goal.by || (g.by === goal.by && i < index)));
}

/**
 * What's realistically left each month: careful income, minus essentials, normal spending,
 * the emergency fund's savings % and dated goals. For a given goal only goals due before it
 * count, the same order the income split pays them in, so one oversized later goal can't
 * make every earlier goal look unmanageable. Can be negative.
 */
export function monthlyCapacity(data, today, goal = null) {
  const income = cautiousMonthlyIncome(data.transactions, today);
  const monthly = (b) => monthlyEquivalent(b, data.transactions, today);
  const essentials = sum(data.bills.filter((b) => b.kind !== 'want').map(monthly));
  const wants = sum(data.bills.filter((b) => b.kind === 'want').map(monthly));
  const spending = spendingPace(data.transactions, today).perDay * 30;
  // Same rule as the income split, so the same money is never promised twice.
  const emergency = savingsShare(data, income, today);
  const others = goal ? goalsAhead(data, goal) : data.goals;
  const otherGoals = sum(others.map((g) => goalMonthlyNeed(data, g, today)));
  return { income, essentials, wants, spending, emergency, otherGoals, available: income - essentials - wants - spending - emergency - otherGoals };
}

function recentSpending(data, today) {
  const from = addDays(today, -CUT_WINDOW_DAYS);
  const by = new Map();
  for (const t of data.transactions) {
    if (t.type === 'out' && !t.billId && t.date > from && t.date <= today) by.set(t.category, (by.get(t.category) ?? 0) + t.amount);
  }
  return by;
}

/**
 * Most each everyday extra could give up, biggest first. Essential spending is never in
 * CUTTABLE, so it can never be suggested. `scale` shrinks a month to a shorter period, e.g. the
 * days left before payday.
 */
function cuttableSpending(data, today, scale = 1) {
  return [...recentSpending(data, today)]
    .filter(([category]) => category in CUTTABLE)
    .map(([category, monthly]) => {
      const current = Math.round(monthly * scale);
      return { category, current, max: floorTo10Rand((current * CUTTABLE[category]) / 100) };
    })
    .filter((c) => c.max > 0)
    .sort((a, b) => b.current - a.current);
}

/** Want bills (never essential ones), each saving its whole monthly amount if cancelled. */
function wantBills(data, today, scale = 1) {
  // Cancelling only pays off over a month or more, so it isn't offered for "before payday".
  if (scale < 1) return [];
  return data.bills
    .filter((b) => b.kind === 'want' && b.frequency !== 'once')
    .map((b) => ({ billId: b.id, name: b.name, current: monthlyEquivalent(b, data.transactions, today) }))
    .filter((w) => w.current > 0);
}

export const maxCuts = (data, today, scale = 1) =>
  sum(cuttableSpending(data, today, scale).map((c) => c.max)) + sum(wantBills(data, today, scale).map((w) => w.current));

/**
 * Cut-backs that close a gap. Want bills come first and whole (a subscription is paused or
 * cancelled, not trimmed), largest first, showing the monthly saving.
 * Then everyday extras, biggest first, each rounded up to R10 but never past its cap, stopping
 * once the gap is covered. `current` and `after` are over the same period as the gap.
 */
export function suggestCuts(data, today, gap, scale = 1) {
  const cuts = [];
  let left = gap;
  for (const w of wantBills(data, today, scale).sort((a, b) => b.current - a.current)) {
    if (left <= 0) break;
    cuts.push({ billId: w.billId, name: w.name, current: w.current, cut: w.current, after: 0 });
    left -= w.current;
  }
  for (const c of cuttableSpending(data, today, scale)) {
    if (left <= 0) break;
    const cut = Math.min(c.max, ceilTo10Rand(left));
    cuts.push({ category: c.category, current: c.current, cut, after: c.current - cut });
    left -= cut;
  }
  return cuts;
}

/**
 * Other ways to make a goal fit, assuming every possible cut: the earliest date it can be
 * reached, and the most it can reach by its current date. null date: not reachable at all.
 */
export function alternatives(data, goal, today, capacity) {
  const saved = goalSaved(data.transactions, goal.id);
  const remaining = Math.max(0, goal.target - saved);
  const cuts = maxCuts(data, today);
  // Floored, so a plan built from these numbers never asks for more than is possible.
  const perAmount = Math.floor((capacity.available + cuts) / perMonth(data));
  const maxAffordable = floorTo10Rand(saved + Math.max(0, perAmount) * contributionsLeft(data, today, goal.by));
  // A later date can put other goals ahead of this one, so plan it as if every other goal comes first.
  const behindAll = monthlyCapacity(data, today, { ...goal, by: '9999-12-31' });
  const laterPer = Math.floor((behindAll.available + cuts) / perMonth(data));
  if (laterPer <= 0) return { earliestFeasibleDate: null, maxAffordable, perAmount: Math.max(0, perAmount) };
  const needed = Math.ceil(remaining / laterPer);
  const dates = needed <= MAX_CONTRIBUTIONS ? contributionDates(data, today, needed) : [];
  const earliestFeasibleDate = dates.length === needed ? dates.at(-1) ?? null : null;
  return { earliestFeasibleDate, maxAffordable, perAmount: Math.max(0, perAmount) };
}

/**
 * Everything the goal card shows. status: reached, pastDue, unknown (not enough history yet),
 * onTrack, stretch (fits with cuts) or unrealistic. Returns null for goals without a deadline.
 */
export function goalPlan(data, goal, today) {
  if (!goal.by) return null;
  const saved = goalSaved(data.transactions, goal.id);
  const remaining = Math.max(0, goal.target - saved);
  const unit = contributionUnit(data);
  const base = { saved, remaining, unit, by: goal.by, target: goal.target };
  if (remaining === 0) return { ...base, status: 'reached' };

  const capacity = monthlyCapacity(data, today, goal);
  if (goal.by <= today) return { ...base, status: 'pastDue', capacity, alternatives: alternatives(data, goal, today, capacity) };

  const contributions = contributionsLeft(data, today, goal.by);
  const amount = perContribution(remaining, contributions);
  const need = monthlyNeed(data, amount);
  const plan = { ...base, contributions, perContribution: amount, monthlyNeed: need, capacity };
  if (!hasEnoughHistory(data, today)) return { ...plan, status: 'unknown' };

  const gap = need - capacity.available;
  if (gap <= 0) return { ...plan, status: 'onTrack', gap: 0, cuts: [] };
  const possible = maxCuts(data, today);
  const cuts = suggestCuts(data, today, gap);
  // Spending is the limit when the goal would fit if everyday spending were lower; otherwise income is.
  const limitedBy = need <= capacity.available + capacity.spending ? 'spending' : 'income';
  if (gap <= possible) return { ...plan, status: 'stretch', reason: 'notEnoughSpendable', gap, cuts, limitedBy };
  return { ...plan, status: 'unrealistic', reason: 'notEnoughTime', gap, cuts, limitedBy, alternatives: alternatives(data, goal, today, capacity) };
}
