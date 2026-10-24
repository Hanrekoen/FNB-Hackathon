// The money coach: one ordered verdict on the user's money. Money is always considered in this
// order: needs due before the next income, then the emergency fund, then savings goals (nearest
// deadline first), then free spending. Nothing is recommended for saving while needs are
// uncovered. Every verdict carries the numbers it used.

import { goalSaved, summarize } from './budget.js';
import { EMERGENCY_STARTER, dailyEssentials } from './buckets.js';
import { daysBetween } from './dates.js';
import { runOutForecast, spendingPace } from './forecast.js';
import { goalPlan, hasEnoughHistory, maxCuts, monthlyCapacity, suggestCuts } from './goals.js';

const MAX_ACTIONS = 2;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const ceilTo10Rand = (cents) => Math.ceil(cents / 1000) * 1000;

/** Cut-backs that close a gap, and whether they're enough. `scale` < 1 means "before payday". */
export function cutBack(data, today, gap, scale = 1) {
  const cuts = gap > 0 ? suggestCuts(data, today, gap, scale) : [];
  const total = sum(cuts.map((c) => c.cut));
  return { cuts, total, covered: total >= gap, gap: Math.max(0, gap) };
}

/** Bills before the next income that the money on hand can't cover, in due-date order. */
function shortBills(billsDue, money) {
  const short = [];
  let running = 0;
  for (const b of billsDue) {
    running += b.planned;
    const over = running - Math.max(0, money);
    if (over > 0) short.push({ name: b.name, due: b.due, planned: b.planned, short: Math.min(b.planned, over) });
  }
  return short;
}

const isWant = (b) => b.kind === 'want';

/** Essentials are paid first and wants after, so a short want never hides a short essential. */
function shortByKind(billsDue, money) {
  const essentials = billsDue.filter((b) => !isWant(b));
  const left = money - sum(essentials.map((b) => b.planned));
  return { essentials: shortBills(essentials, money), wants: shortBills(billsDue.filter(isWant), left) };
}

/**
 * What spending (or saving) `amount` now would do to the bills due before the next income.
 * `fromBillMoney` is the part that would come out of money needed for bills; `affected` lists
 * essential bills that would end up short, `wants` the want bills that could be paused instead.
 * Checked before money leaves, so the user can decide.
 */
export function spendingConsequence(data, amount, today) {
  const s = summarize(data, today);
  const spendable = Math.max(0, s.free - s.unfunded);
  const before = shortByKind(s.billsDue, s.cash);
  const after = shortByKind(s.billsDue, s.cash - amount);
  return {
    amount,
    fromBillMoney: Math.max(0, amount - spendable),
    shortBefore: sum(before.essentials.map((b) => b.short)),
    shortAfter: sum(after.essentials.map((b) => b.short)),
    affected: after.essentials,
    wants: after.wants,
    nextIncome: s.next.date,
  };
}

function peaceOf(data, s, today, pace) {
  const daysLeft = Math.max(1, daysBetween(today, s.next.date));
  const scale = Math.min(1, daysLeft / 30);
  const forecast = runOutForecast(s.free - s.unfunded, pace, today, s.next.date);
  const evidence = { cash: s.cash, needs: s.needs, bills: s.billsTotal, free: Math.max(0, s.free - s.unfunded), pace: pace.perDay, daysLeft, runOut: forecast.date ?? null };
  const actions = [];

  const short = shortByKind(s.billsDue, s.cash);
  if (short.essentials.length) {
    // Not enough money for a must-pay: say which bill, then what could cover it before payday.
    // Want bills due before payday come first: pausing one is the quickest fix.
    const essentialShort = sum(short.essentials.map((b) => b.short));
    const pause = s.billsDue.filter(isWant).map((b) => ({ kind: 'pauseWant', name: b.name, amount: b.planned, due: b.due }));
    const plan = cutBack(data, today, Math.max(0, essentialShort - sum(pause.map((p) => p.amount))), scale);
    actions.push(...pause, ...plan.cuts.map((c) => ({ kind: 'cutBefore', ...c })));
    plan.covered = sum(pause.map((p) => p.amount)) + plan.total >= essentialShort;
    return { status: 'act', short: essentialShort, bill: short.essentials[0], plan, actions: actions.slice(0, MAX_ACTIONS), next: s.next.date, evidence };
  }
  // Only a want bill is at risk: no alarm, just the suggestion to pause it.
  for (const w of short.wants) actions.push({ kind: 'pauseWant', name: w.name, amount: w.planned, due: w.due });
  // Money is there but not set aside yet: a nudge, not an alarm.
  if (s.unfunded > 0 && !short.wants.length) actions.push({ kind: 'setAside', amount: s.unfunded });
  if (!forecast.onTrack) {
    actions.push({ kind: 'keepTo', amount: s.perDay });
    const plan = cutBack(data, today, pace.perDay * forecast.gap, scale);
    for (const c of plan.cuts.slice(0, MAX_ACTIONS - actions.length)) actions.push({ kind: 'cutBefore', ...c });
    return { status: 'watch', runOut: forecast.date, gap: forecast.gap, plan, actions: actions.slice(0, MAX_ACTIONS), next: s.next.date, evidence };
  }
  return { status: 'calm', actions: actions.slice(0, MAX_ACTIONS), next: s.next.date, evidence };
}

function emergencyOf(data, s, today, capacity, enough) {
  const goal = data.goals.find((g) => g.kind === 'emergency') ?? null;
  const saved = goal ? goalSaved(data.transactions, goal.id) : 0;
  const target = goal?.target ?? EMERGENCY_STARTER;
  const perDay = dailyEssentials(data, today);
  const base = { goalId: goal?.id ?? null, saved, target, days: perDay ? Math.floor(saved / perDay) : null, perDay };
  if (saved >= target) return { ...base, reached: true, canSave: true };

  // Impact in plain numbers: the smallest surprise cost that would eat into bill money.
  const margin = Math.max(0, s.free - s.unfunded);
  const impact = { margin: margin > 0 ? ceilTo10Rand(margin + 1) : 0, bill: s.billsDue.find((b) => !isWant(b)) ?? null };

  if (shortByKind(s.billsDue, s.cash).essentials.length) {
    const daysLeft = Math.max(1, daysBetween(today, s.next.date));
    return { ...base, canSave: false, reason: 'needsUncovered', impact, plan: cutBack(data, today, s.shortfall, Math.min(1, daysLeft / 30)) };
  }
  if (!enough) return { ...base, canSave: null };
  // Emergency comes before goals, so only income, essentials and normal spending count here.
  const share = Math.min(target - saved, Math.floor((capacity.income * data.settings.savePercent) / 100));
  // A 0% savings rule is the user's choice, not a lack of money; say that instead.
  if (share <= 0) return { ...base, canSave: false, reason: 'noSavingsRule', impact };
  const room = capacity.income - capacity.essentials - capacity.spending;
  if (share > 0 && room >= share) return { ...base, canSave: true, monthly: share };
  return { ...base, canSave: false, reason: 'noFreeMoney', monthly: share, impact, plan: cutBack(data, today, Math.max(1, share - Math.max(0, room))) };
}

/**
 * Everything the coach knows, in decision order: peace of mind (needs and pace), the
 * emergency fund, then each dated goal. Without enough history it says so instead of guessing.
 */
export function assessMoney(data, today) {
  const s = summarize(data, today);
  const pace = spendingPace(data.transactions, today);
  const enough = hasEnoughHistory(data, today);
  const capacity = monthlyCapacity(data, today);
  const peace = peaceOf(data, s, today, pace);
  const emergency = emergencyOf(data, s, today, capacity, enough);
  // Needs come first: while they aren't covered, no goal is pushed.
  const needsFirst = peace.status === 'act';
  const goals = data.goals
    .filter((g) => g.by)
    .map((g) => ({ goal: g, plan: goalPlan(data, g, today), needsFirst }));
  return {
    history: { enough },
    peace,
    emergency,
    goals,
    evidence: { ...capacity, maxCuts: maxCuts(data, today), cash: s.cash, billsDue: s.billsTotal, nextIncome: s.next.date },
  };
}
