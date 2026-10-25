// The money coach: one ordered verdict on the user's money. Money is always considered in this
// order: needs due before the next income, then the emergency fund, then savings goals (nearest
// deadline first), then free spending. Nothing is recommended for saving while needs are
// uncovered. Every verdict carries the numbers it used.

import { coverage, goalSaved, monthOf, summarize } from './budget.js';
import { dailyEssentials } from './buckets.js';
import { ESSENTIAL } from './categories.js';
import { addDays, daysBetween } from './dates.js';
import { spendingPace } from './forecast.js';
import { ESSENTIAL_SPENDING, goalPlan, goalTarget, hasEnoughHistory, maxCuts, monthlyCapacity, monthlyEssentials, suggestCuts } from './goals.js';
import { lastDayOf } from './sweep.js';

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

/** The first essential bill (by due date) that Needs doesn't cover yet. */
function firstUnfunded(billsDue, needs) {
  let running = 0;
  for (const bill of billsDue.filter((x) => !isWant(x))) {
    running += bill.planned;
    if (running > needs) return { ...bill, short: Math.min(bill.planned, running - needs) };
  }
  return null;
}

function peaceOf(data, s, today, pace, monthsCovered) {
  const daysLeft = Math.max(1, daysBetween(today, s.next.date));
  const scale = Math.min(1, daysLeft / 30);
  const evidence = {
    cash: s.cash, needs: s.needs, bills: s.billsTotal, free: Math.max(0, s.free - s.unfunded), pace: pace.perDay, daysLeft,
    earmarked: s.earmarked, horizon: s.horizon, horizonBills: s.horizonTotal, unfundedEssential: s.unfundedEssential,
  };
  const actions = [];
  const base = { next: s.next.date, horizon: s.horizon, evidence };

  const notCovered = coverage(s.billsDue, s.covered).unfundedEssential;
  if (notCovered > 0) {
    const short = shortByKind(s.billsDue, s.cash);
    if (short.essentials.length) {
      // Not enough money for a must-pay: which bill, then what could cover it before payday.
      // Want bills due before payday come first: pausing one is the quickest fix.
      const essentialShort = sum(short.essentials.map((x) => x.short));
      const pause = s.billsDue.filter(isWant).map((x) => ({ kind: 'pauseWant', name: x.name, amount: x.planned, due: x.due }));
      const plan = cutBack(data, today, Math.max(0, essentialShort - sum(pause.map((x) => x.amount))), scale);
      actions.push(...pause, ...plan.cuts.map((c) => ({ kind: 'cutBefore', ...c })));
      plan.covered = sum(pause.map((x) => x.amount)) + plan.total >= essentialShort;
      return { ...base, status: 'act', reason: 'short', short: essentialShort, bill: short.essentials[0], plan, actions: actions.slice(0, MAX_ACTIONS) };
    }
    // The money is there, it just isn't set aside for a bill due before payday yet.
    return { ...base, status: 'act', reason: 'notSetAside', short: notCovered, bill: firstUnfunded(s.billsDue, s.covered), actions: [{ kind: 'setAside', amount: notCovered }] };
  }
  // Only a want bill is at risk: no alarm, just the suggestion to pause it.
  for (const w of shortByKind(s.billsDue, s.cash).wants) actions.push({ kind: 'pauseWant', name: w.name, amount: w.planned, due: w.due });
  if (s.unfundedEssential > 0) {
    return { ...base, status: 'watch', reason: 'billsAhead', amount: s.unfundedEssential, actions: actions.slice(0, MAX_ACTIONS) };
  }
  if (s.earmarked > 0 && s.free < 0) {
    const used = Math.min(s.earmarked, -s.free);
    const plan = cutBack(data, today, used, scale);
    for (const c of plan.cuts.slice(0, MAX_ACTIONS - actions.length)) actions.push({ kind: 'cutBefore', ...c });
    return { ...base, status: 'watch', reason: 'earmarkUsed', amount: used, plan, actions: actions.slice(0, MAX_ACTIONS) };
  }
  return { ...base, status: 'calm', earmarked: s.earmarked, monthsCovered, actions: actions.slice(0, MAX_ACTIONS) };
}

function emergencyOf(data, s, today, capacity, enough, essentials) {
  const goal = data.goals.find((g) => g.kind === 'emergency') ?? null;
  const saved = goal ? goalSaved(data.transactions, goal.id) : 0;
  const target = goalTarget(data, goal ?? { kind: 'emergency' }, today);
  const perDay = dailyEssentials(data, today);
  const month = monthOf(today);
  const base = {
    goalId: goal?.id ?? null, saved, target, perDay, essentials,
    months: data.settings.emergencyMonths,
    days: perDay ? Math.floor(saved / perDay) : null,
    monthsCovered: essentials.total ? Math.floor((saved * 10) / essentials.total) / 10 : null,
    earmarkedThisMonth: sum(data.earmarks.filter((e) => e.kind === 'emergency' && e.month === month).map((e) => e.amount)),
    monthEnd: lastDayOf(month),
  };
  if (saved >= target) return { ...base, reached: true, canSave: true };

  // Impact in plain numbers: the smallest surprise cost that would eat into bill money.
  const margin = Math.max(0, s.free - s.unfunded);
  const impact = { margin: margin > 0 ? ceilTo10Rand(margin + 1) : 0, bill: s.billsDue.find((x) => !isWant(x)) ?? null };

  // Bills in the next 30 days come first; saving waits until they're covered.
  if (s.unfundedEssential > 0 || s.unfundedWant > 0) {
    const daysLeft = Math.max(1, daysBetween(today, s.next.date));
    return { ...base, canSave: false, reason: 'needsFirst', impact, plan: cutBack(data, today, s.shortfall, Math.min(1, daysLeft / 30)) };
  }
  if (!enough) return { ...base, canSave: null };
  // Emergency comes before goals, so only income, bills and normal spending count here.
  const share = Math.min(target - saved, Math.floor((capacity.income * data.settings.savePercent) / 100));
  // A 0% savings rule is the user's choice, not a lack of money; say that instead.
  if (share <= 0) return { ...base, canSave: false, reason: 'noSavingsRule', impact };
  const room = capacity.income - capacity.essentials - capacity.wants - capacity.spending;
  if (room >= share) return { ...base, canSave: true, monthly: share };
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
  const essentials = monthlyEssentials(data, today);
  const emergency = emergencyOf(data, s, today, capacity, enough, essentials);
  const peace = peaceOf(data, s, today, pace, emergency.monthsCovered);
  // Needs come first: while bills in the next 30 days aren't covered, no goal is pushed.
  const needsFirst = s.unfundedEssential > 0 || s.unfundedWant > 0;
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

// Spending notices, highest priority first. In-app only: there is no push server.
export const NOTICE_TYPES = ['earmarkUsed', 'protectSaving', 'monthEndSoon', 'overPace'];
export const OVER_PACE = 1.25;
const MONTH_END_SOON_DAYS = 5;

/** One suggested action for a notice: pause the biggest want bill, or trim the biggest extra. */
function topAction(data, today, gap) {
  const [c] = suggestCuts(data, today, Math.max(1, gap));
  if (!c) return null;
  return c.billId ? { kind: 'pauseWant', name: c.name, amount: c.cut } : { kind: 'cut', category: c.category, cut: c.cut };
}

const discretionary = (t) => t.type === 'out' && !t.billId && !ESSENTIAL.includes(t.category);

/**
 * At most one notice about spending and month-end saving, or null. Each carries the numbers it
 * used (for "Why am I seeing this?") and, where it helps, one suggested action. A notice dismissed
 * today stays hidden today; only a higher-priority one can show instead.
 */
export function spendingNotices(data, today) {
  const s = summarize(data, today);
  const month = monthOf(today);
  const monthEnd = lastDayOf(month);
  const daysToMonthEnd = daysBetween(today, monthEnd);
  const pace = spendingPace(data.transactions, today);
  const mine = data.earmarks.filter((e) => e.month === month);
  const emergency = sum(mine.filter((e) => e.kind === 'emergency').map((e) => e.amount));
  const goalAmount = sum(mine.filter((e) => e.kind === 'goal').map((e) => e.amount));
  const goalName = data.goals.find((g) => mine.some((e) => e.kind === 'goal' && e.goalId === g.id))?.name ?? null;
  const evidence = { cash: s.cash, needs: s.needs, earmarked: s.earmarked, free: s.free, pace: pace.perDay, daysToMonthEnd };
  const found = [];

  if (s.earmarked > 0 && s.free < 0) {
    const used = Math.min(s.earmarked, -s.free);
    // Essentials only until month-end: what they usually cost a day.
    const perDay = Math.floor(sum(data.transactions
      .filter((t) => t.type === 'out' && !t.billId && ESSENTIAL_SPENDING.includes(t.category) && t.date > addDays(today, -30) && t.date <= today)
      .map((t) => t.amount)) / 30);
    found.push({ id: 'earmarkUsed', level: 'danger', vars: { used, perDay, date: monthEnd }, evidence, action: topAction(data, today, used) });
  }

  const days = Math.max(1, Math.min(daysToMonthEnd, daysBetween(today, s.next.date)));
  if (s.earmarked > 0 && s.free >= 0 && pace.perDay * days > s.free) {
    found.push({
      id: 'protectSaving', level: 'warn',
      vars: { earmarked: s.earmarked, goal: goalName, perDay: Math.floor(s.free / days) },
      evidence: { ...evidence, days }, action: topAction(data, today, pace.perDay * days - s.free),
    });
  }

  if (s.earmarked > 0 && daysToMonthEnd <= MONTH_END_SOON_DAYS) {
    found.push({ id: 'monthEndSoon', level: 'info', vars: { days: daysToMonthEnd, emergency, goalAmount, goal: goalName, date: monthEnd }, evidence, action: null });
  }

  // This week's extras against a usual week (the four weeks before it).
  const week = data.transactions.filter((t) => discretionary(t) && t.date > addDays(today, -7) && t.date <= today);
  const usual = sum(data.transactions.filter((t) => discretionary(t) && t.date > addDays(today, -35) && t.date <= addDays(today, -7)).map((t) => t.amount)) / 4;
  const thisWeek = sum(week.map((t) => t.amount));
  if (usual > 0 && thisWeek >= usual * OVER_PACE) {
    const by = new Map();
    for (const t of week) by.set(t.category, (by.get(t.category) ?? 0) + t.amount);
    const [category] = [...by].sort((a, b) => b[1] - a[1])[0];
    found.push({ id: 'overPace', level: 'info', vars: { category }, evidence: { ...evidence, week: thisWeek, usual: Math.round(usual) }, action: topAction(data, today, thisWeek - Math.round(usual)) });
  }

  const dismissed = data.noticeDismissed?.date === today ? NOTICE_TYPES.indexOf(data.noticeDismissed.id) : NOTICE_TYPES.length;
  return found.find((x) => NOTICE_TYPES.indexOf(x.id) < dismissed) ?? null;
}
