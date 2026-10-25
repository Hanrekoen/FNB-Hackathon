// Three buckets: Needs (bills, hard-guarded with a release notice), Safety (savings goals,
// soft-guarded) and Free (what's left, which becomes safe-to-spend). Money never moves in a
// bank here; these are amounts Imali keeps aside on the user's behalf.

import { cashAvailable, coverage, goalSaved, monthOf, needsBalance, safetyBalance, summarize } from './budget.js';
import { addDays, toISO } from './dates.js';
import { monthlyEquivalent } from './forecast.js';
import { monthlyEssentials, monthlyNeed } from './goals.js';

export { EMERGENCY_STARTER } from './goals.js';
import { cautiousMonthlyIncome } from './income.js';

export const NOTICE_DAYS = 3;
export const DAY_MS = 86_400_000;
// An accepted goal plan also earmarks its monthly amount from each income (decided by the team).
export const EARMARK_GOAL_PLAN = true;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const defaultId = () => crypto.randomUUID();

export const pendingReleases = (data) => data.releases.filter((r) => r.status === 'pending');
export const pendingTotal = (data) => sum(pendingReleases(data).map((r) => r.amount));

/** Needs money not already promised to a pending release. */
export const needsAvailable = (data) => Math.max(0, needsBalance(data.transactions) - pendingTotal(data));

/** Goals whose accepted plan earmarks money each month: unfinished, nearest deadline first. */
function plannedGoals(data, today) {
  return data.goals
    .filter((g) => g.by && g.by > today && g.plan && goalSaved(data.transactions, g.id) < g.target)
    .sort((x, y) => x.by.localeCompare(y.by));
}

/**
 * Split income that was just recorded, in a fixed order: essential bills due in the next 30 days
 * (or until the next income, if later) until fully covered, then want bills, then an earmark of
 * the savings % for month-end, then each accepted goal plan's share. The rest is free money.
 * Nothing moves to savings now: earmarks stay in cash until the month-end sweep. Never sets
 * aside more than the cash on hand. `incomeId` links it all to the income for undoing.
 */
export function allocate(data, amount, today, incomeId = null) {
  const s = summarize(data, today);
  const pending = s.needs - needsAvailable(data);
  const { unfundedEssential, unfundedWant } = coverage(s.billsHorizon, Math.max(0, s.covered - pending));
  let left = Math.min(amount, Math.max(0, s.cash - s.needs - s.earmarked));
  const take = (want) => { const x = Math.max(0, Math.min(left, want)); left -= x; return x; };
  const needsEssential = take(unfundedEssential);
  const needsWant = take(unfundedWant);
  const afterBills = amount - needsEssential - needsWant;
  const earmarkEmergency = take(Math.floor((afterBills * data.settings.savePercent) / 100));
  const earmarkGoals = [];
  if (EARMARK_GOAL_PLAN) {
    // A goal's monthly amount, shared across the month's incomes in proportion to their size.
    const monthly = Math.max(amount, cautiousMonthlyIncome(data.transactions, today));
    for (const g of plannedGoals(data, today)) {
      const share = Math.ceil((monthlyNeed(data, g.plan.perContribution) * amount) / monthly);
      const x = take(Math.min(share, g.target - goalSaved(data.transactions, g.id)));
      if (x > 0) earmarkGoals.push({ goalId: g.id, name: g.name, amount: x });
    }
  }
  const needs = needsEssential + needsWant;
  return {
    amount,
    incomeId,
    needs,
    needsEssential,
    needsWant,
    earmarkEmergency,
    earmarkGoals,
    free: amount - needs - earmarkEmergency - earmarkGoals.reduce((x, g) => x + g.amount, 0),
    pct: data.settings.savePercent,
    nextIncome: s.next.date,
    horizon: s.horizon,
    bills: s.billsHorizon,
  };
}

/** Records an allocation: bill money into Needs now, saving as earmarks for month-end. */
export function applyAllocation(data, { needs, earmarkEmergency = 0, earmarkGoals = [], incomeId = null }, today, newId = defaultId) {
  const link = incomeId ? { fromIncome: incomeId } : {};
  if (needs > 0) data.transactions.push({ id: newId(), type: 'needs', amount: needs, category: 'needs', note: '', date: today, ...link });
  const earmark = (kind, amount, goalId) => data.earmarks.push({
    id: newId(), month: monthOf(today), kind, amount, incomeId, ...(goalId ? { goalId } : {}),
  });
  if (earmarkEmergency > 0) earmark('emergency', earmarkEmergency);
  for (const g of earmarkGoals) if (g.amount > 0 && data.goals.some((x) => x.id === g.goalId)) earmark('goal', g.amount, g.goalId);
}

/**
 * Deletes a transaction. Deleting an income also removes the Needs moves and month-end
 * earmarks made from its split, and Needs is then trimmed so it never holds more than the cash
 * really on hand (older data has no link, and money can't stay set aside if it was never there).
 * Returns the linked moves removed and the amount trimmed from Needs.
 */
export function deleteTransaction(data, txId, today, newId = defaultId) {
  const linked = [...data.transactions.filter((t) => t.fromIncome === txId), ...data.earmarks.filter((e) => e.incomeId === txId)];
  const gone = new Set([txId, ...linked.map((t) => t.id)]);
  data.transactions = data.transactions.filter((t) => !gone.has(t.id));
  data.earmarks = data.earmarks.filter((e) => !gone.has(e.id));
  const excess = needsBalance(data.transactions) - Math.max(0, cashAvailable(data.transactions));
  if (excess > 0) {
    data.transactions.push({ id: newId(), type: 'release', amount: excess, category: 'release', note: '', date: today, correction: true });
  }
  return { linked, corrected: Math.max(0, excess) };
}

export function setAside(data, amount, today, newId = defaultId) {
  data.transactions.push({ id: newId(), type: 'needs', amount, category: 'needs', note: '', date: today });
}

/** Paying a bill draws from Needs first (it was set aside for this), then from free money. */
export function payBill(data, billId, due, amount, today, newId = defaultId) {
  const bill = data.bills.find((b) => b.id === billId);
  if (!bill) return;
  const fromNeeds = Math.min(amount, needsAvailable(data));
  const category = bill.amountType === 'varies' ? bill.linkedCategory : 'bills';
  data.transactions.push({ id: newId(), type: 'out', amount, category, note: bill.name, date: today, billId, fromNeeds });
  if (bill.frequency === 'once') data.bills = data.bills.filter((b) => b.id !== billId);
  else bill.lastPaidDue = due;
}

/**
 * Before releasing Needs money: would any bill due within the notice period end up
 * underfunded? Returns the first such bill and the total shortfall, or null.
 */
export function releaseWarning(data, amount, today, now) {
  const until = toISO(new Date(now + NOTICE_DAYS * DAY_MS));
  const { billsDue } = summarize(data, today);
  const after = needsAvailable(data) - amount;
  let running = 0;
  for (const b of billsDue.filter((x) => x.due <= until)) {
    running += b.planned;
    if (running > after) {
      const needed = sum(billsDue.filter((x) => x.due <= until).map((x) => x.planned));
      return { bill: b, short: needed - Math.max(0, after) };
    }
  }
  return null;
}

/** Returns an error key, or null if the request is allowed. */
export function checkRelease(data, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'err.amount';
  if (amount > needsAvailable(data)) return 'err.notEnoughNeeds';
  return null;
}

export function requestRelease(data, amount, reason, now, newId = defaultId) {
  const r = { id: newId(), amount, reason: reason.slice(0, 80), requestedAt: now, availableAt: now + NOTICE_DAYS * DAY_MS, status: 'pending' };
  data.releases.push(r);
  return r;
}

export function cancelRelease(data, id) {
  const r = data.releases.find((x) => x.id === id && x.status === 'pending');
  if (r) r.status = 'cancelled';
}

/**
 * Moves every release whose notice period has ended into free money. There are no background
 * jobs in a PWA, so this runs whenever the app renders. Returns the releases it completed.
 */
export function settleReleases(data, now, today, newId = defaultId) {
  const done = [];
  for (const r of pendingReleases(data).sort((a, b) => a.availableAt - b.availableAt)) {
    if (r.availableAt > now) continue;
    // Bills may have been paid from Needs during the notice period; release what is still there.
    const amount = Math.min(r.amount, needsBalance(data.transactions));
    r.status = 'released';
    r.amount = amount;
    if (amount > 0) data.transactions.push({ id: newId(), type: 'release', amount, category: 'release', note: r.reason, date: today });
    done.push(r);
  }
  return done;
}

/** Daily cost of essentials: regular bills, or recent spending if no bills are set up. */
export function dailyEssentials(data, today) {
  const monthly = sum(data.bills.map((b) => monthlyEquivalent(b, data.transactions, today)));
  if (monthly > 0) return Math.round(monthly / 30);
  const from = addDays(today, -30);
  const spent = sum(data.transactions.filter((t) => t.type === 'out' && t.date > from && t.date <= today).map((t) => t.amount));
  return Math.round(spent / 30);
}

/** What taking money out of Safety means, in plain numbers, before the user confirms. */
export function safetyConsequence(data, amount, today) {
  const before = safetyBalance(data);
  const after = Math.max(0, before - amount);
  const perDay = dailyEssentials(data, today);
  const { total } = monthlyEssentials(data, today);
  const months = (x) => (total ? Math.floor((x * 10) / total) / 10 : null);
  return {
    before,
    after,
    daysBefore: perDay ? Math.floor(before / perDay) : null,
    daysAfter: perDay ? Math.floor(after / perDay) : null,
    monthsBefore: months(before),
    monthsAfter: months(after),
  };
}

/**
 * Moves money from one goal to another (e.g. from the emergency fund to a savings goal). Both
 * steps are recorded, so history shows where it went and the money on hand doesn't change.
 */
export function moveToGoal(data, fromId, toId, amount, today, newId = defaultId) {
  const to = data.goals.find((g) => g.id === toId);
  data.transactions.push(
    { id: newId(), type: 'withdraw', amount, goalId: fromId, category: 'withdraw', note: to?.name ?? '', date: today },
    { id: newId(), type: 'save', amount, goalId: toId, category: 'save', note: '', date: today },
  );
}
