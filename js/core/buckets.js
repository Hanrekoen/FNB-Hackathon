// Three buckets: Needs (bills, hard-guarded with a release notice), Safety (savings goals,
// soft-guarded) and Free (what's left, which becomes safe-to-spend). Money never moves in a
// bank here; these are amounts Imali keeps aside on the user's behalf.

import { cashAvailable, goalSaved, needsBalance, safetyBalance, summarize } from './budget.js';
import { needsBalance, safetyBalance, summarize } from './budget.js';
import { addDays, toISO } from './dates.js';
import { monthlyEquivalent } from './forecast.js';
import { datedGoalContributions, savingsShare, savingsTarget } from './goals.js';

export const NOTICE_DAYS = 3;
export const DAY_MS = 86_400_000;
export const EMERGENCY_STARTER = 100_000; // R1 000

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const defaultId = () => crypto.randomUUID();

export const pendingReleases = (data) => data.releases.filter((r) => r.status === 'pending');
export const pendingTotal = (data) => sum(pendingReleases(data).map((r) => r.amount));

/** Needs money not already promised to a pending release. */
export const needsAvailable = (data) => Math.max(0, needsBalance(data.transactions) - pendingTotal(data));

/**
 * Split income that was just recorded: cover bills due before the next income first, then
 * the savings %, and the rest is free. Never sets aside more than the cash actually on hand.
 * `incomeId` links the split to its income, so deleting the income can undo the split.
 * Split income that was just recorded: bills due before the next income first, then the
 * savings % (emergency fund first), then each dated goal's per-payday amount, nearest deadline
 * first. The rest is free. Never sets aside more than the free money actually on hand.
 */
export function allocate(data, amount, today, incomeId = null) {
  const s = summarize(data, today);
  const room = Math.max(0, s.cash - s.needs);
  const needs = Math.min(amount, room, Math.max(0, s.billsTotal - needsAvailable(data)));
  const remaining = amount - needs;
  let left = Math.min(remaining, room - needs);
  const safety = Math.min(left, savingsShare(data, remaining));
  left -= safety;
  const goals = [];
  for (const c of datedGoalContributions(data, today)) {
    const give = Math.min(left, c.amount);
    if (give <= 0) break;
    goals.push({ ...c, amount: give });
    left -= give;
  }
  return {
    amount,
    incomeId,
    needs,
    safety,
    goals,
    free: remaining - safety - sum(goals.map((g) => g.amount)),
    pct: data.settings.savePercent,
    goalId: savingsTarget(data)?.id ?? null,
    nextIncome: s.next.date,
    bills: s.billsDue,
  };
}

/** Records an allocation. Creates an emergency fund if the user has no goals yet. */
export function applyAllocation(data, { needs, safety, goalId, incomeId = null }, today, emergencyName, newId = defaultId) {
  const link = incomeId ? { fromIncome: incomeId } : {};
  if (needs > 0) data.transactions.push({ id: newId(), type: 'needs', amount: needs, category: 'needs', note: '', date: today, ...link });
/** Records an allocation. Creates an emergency fund if the savings % has nowhere to go yet. */
export function applyAllocation(data, { needs, safety, goalId, goals = [] }, today, emergencyName, newId = defaultId) {
  const save = (goal, amount) => data.transactions.push({ id: newId(), type: 'save', amount, goalId: goal, category: 'save', note: '', date: today });
  if (needs > 0) data.transactions.push({ id: newId(), type: 'needs', amount: needs, category: 'needs', note: '', date: today });
  for (const g of goals) if (g.amount > 0 && data.goals.some((x) => x.id === g.goalId)) save(g.goalId, g.amount);
  if (safety <= 0) return;
  let id = goalId ?? savingsTarget(data)?.id ?? data.goals.find((g) => g.kind === 'emergency')?.id;
  if (!id) {
    id = newId();
    data.goals.push({ id, name: emergencyName, target: EMERGENCY_STARTER, kind: 'emergency' });
  }
  data.transactions.push({ id: newId(), type: 'save', amount: safety, goalId: id, category: 'save', note: '', date: today, ...link });
}

/**
 * Deletes a transaction. Deleting an income also removes the Needs and Safety moves made from
 * its split, and Needs is then trimmed so it never holds more than the cash really on hand
 * (older data has no link, and money can't stay set aside if it was never there).
 * Returns the linked moves removed and the amount trimmed from Needs.
 */
export function deleteTransaction(data, txId, today, newId = defaultId) {
  const linked = data.transactions.filter((t) => t.fromIncome === txId);
  const gone = new Set([txId, ...linked.map((t) => t.id)]);
  data.transactions = data.transactions.filter((t) => !gone.has(t.id));
  const excess = needsBalance(data.transactions) - Math.max(0, cashAvailable(data.transactions));
  if (excess > 0) {
    data.transactions.push({ id: newId(), type: 'release', amount: excess, category: 'release', note: '', date: today, correction: true });
  }
  return { linked, corrected: Math.max(0, excess) };
  save(id, safety);
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
  return {
    before,
    after,
    daysBefore: perDay ? Math.floor(before / perDay) : null,
    daysAfter: perDay ? Math.floor(after / perDay) : null,
  };
}
