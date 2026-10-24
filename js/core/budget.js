// Budgeting for irregular income: instead of a monthly budget, work out how much is
// safe to spend per day until the next money is expected, after setting aside bills.

import { addDays, daysBetween, daysInMonth, parseISO, toISO } from './dates.js';
import { plannedAmount } from './forecast.js';
import { hasPayday, incomeDates, incomeGaps, median, nextPayday, percentile } from './income.js';

export const DEFAULT_GAP_DAYS = 14; // no income history yet
export const OVERDUE_PLAN_DAYS = 7; // income is late: plan conservatively for another week

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Cash on hand: money in, minus money out, minus money moved into savings goals. Needs moves stay in cash. */
export function cashAvailable(txs) {
  let cash = 0;
  for (const tx of txs) {
    if (tx.type === 'in' || tx.type === 'withdraw') cash += tx.amount;
    else if (tx.type === 'out' || tx.type === 'save') cash -= tx.amount;
  }
  return cash;
}

/** Money set aside in Imali for bills: top-ups, minus releases, minus bills paid from it. */
export function needsBalance(txs) {
  let needs = 0;
  for (const tx of txs) {
    if (tx.type === 'needs') needs += tx.amount;
    else if (tx.type === 'release') needs -= tx.amount;
    else if (tx.type === 'out' && tx.fromNeeds) needs -= tx.fromNeeds;
  }
  return Math.max(0, needs);
}

export function goalSaved(txs, goalId) {
  let saved = 0;
  for (const tx of txs) {
    if (tx.goalId !== goalId) continue;
    if (tx.type === 'save') saved += tx.amount;
    else if (tx.type === 'withdraw') saved -= tx.amount;
  }
  return saved;
}

export const safetyBalance = (data) => sum(data.goals.map((g) => goalSaved(data.transactions, g.id)));

/** Typical number of days between income payments, from the most recent ones. */
export function incomeGapDays(txs) {
  const gaps = incomeGaps(txs);
  return gaps.length ? Math.max(1, median(gaps)) : null;
}

export function nextIncome(data, today) {
  if (data.nextIncome && data.nextIncome >= today) return { date: data.nextIncome, source: 'user' };
  const income = data.income;
  const last = incomeDates(data.transactions).at(-1);
  if (hasPayday(income)) return { date: nextPayday(income, today, last), source: 'payday' };
  const gaps = incomeGaps(data.transactions);
  if (gaps.length && last) {
    // "It varies" plans from a longer-than-usual gap, so a late payment doesn't leave you short.
    const cautious = !income || income.pattern === 'varies';
    const gap = Math.max(1, cautious ? percentile(gaps, 75) : median(gaps));
    const est = addDays(last, gap);
    if (est > today) return { date: est, source: 'estimate', gap };
    return { date: addDays(today, OVERDUE_PLAN_DAYS), source: 'late', gap };
  }
  return { date: addDays(today, DEFAULT_GAP_DAYS), source: 'default' };
}

/** Next date (>= today) a monthly bill falls due; day 31 becomes the last day of short months. */
export function nextDueDate(dueDay, today) {
  const d = parseISO(today);
  const y = d.getFullYear();
  const m = d.getMonth();
  const thisMonth = toISO(new Date(y, m, Math.min(dueDay, daysInMonth(y, m))));
  if (thisMonth >= today) return thisMonth;
  return toISO(new Date(y, m + 1, Math.min(dueDay, daysInMonth(y, m + 1))));
}

const nextWeekday = (weekday, from) => addDays(from, (weekday - parseISO(from).getDay() + 7) % 7);

/** Next unpaid due date. Once-off bills keep their date even when overdue. */
export function billNextDue(bill, today) {
  if (bill.frequency === 'once') return bill.dueDate;
  const next = bill.frequency === 'weekly' ? (from) => nextWeekday(bill.weekday, from) : (from) => nextDueDate(bill.dueDay, from);
  const due = next(today);
  if (bill.lastPaidDue && bill.lastPaidDue >= due) return next(addDays(bill.lastPaidDue, 1));
  return due;
}

/** Every unpaid occurrence of a bill due on or before `until` (weekly bills can fall due several times). */
export function billOccurrences(bill, today, until) {
  const first = billNextDue(bill, today);
  if (bill.frequency !== 'weekly') return first <= until ? [first] : [];
  const out = [];
  for (let d = first; d <= until; d = addDays(d, 7)) out.push(d);
  return out;
}

/** Bills due before a date, one entry per occurrence, with the amount to plan for. */
export function billsDueBy(data, today, until) {
  return data.bills
    .flatMap((b) => {
      const planned = plannedAmount(b, data.transactions, today);
      return billOccurrences(b, today, until).map((due) => ({ ...b, due, planned }));
    })
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function summarize(data, today) {
  const txs = data.transactions;
  const cash = cashAvailable(txs);
  const needs = needsBalance(txs);
  const safety = safetyBalance(data);
  // Bill payments aren't "daily spending": they were already set aside.
  const spentToday = sum(txs.filter((t) => t.type === 'out' && t.date === today && !t.billId).map((t) => t.amount));
  const next = nextIncome(data, today);
  const daysLeft = Math.max(1, daysBetween(today, next.date));
  const billsDue = billsDueBy(data, today, next.date);
  const billsTotal = sum(billsDue.map((b) => b.planned));
  // Bills Needs can't cover still have to come out of free money.
  const unfunded = Math.max(0, billsTotal - needs);
  const free = cash - needs;
  const perDay = Math.max(0, Math.floor((free - unfunded + spentToday) / daysLeft));
  return {
    cash,
    needs,
    safety,
    free,
    unfunded,
    spentToday,
    perDay,
    leftToday: perDay - spentToday,
    next,
    daysLeft,
    billsDue,
    billsTotal,
    shortfall: Math.max(0, billsTotal - cash),
  };
}

export function monthTotals(txs, month) {
  let income = 0;
  let spent = 0;
  for (const t of txs) {
    if (!t.date.startsWith(month)) continue;
    if (t.type === 'in') income += t.amount;
    else if (t.type === 'out') spent += t.amount;
  }
  return { income, spent };
}

export function spendingByCategory(txs, month) {
  const by = new Map();
  for (const t of txs) {
    if (t.type === 'out' && t.date.startsWith(month)) by.set(t.category, (by.get(t.category) ?? 0) + t.amount);
  }
  return [...by].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

/** Average monthly income over the last 90 days (0 if none). */
export function monthlyIncomeEstimate(txs, today) {
  const from = addDays(today, -90);
  const total = sum(txs.filter((t) => t.type === 'in' && t.date > from && t.date <= today).map((t) => t.amount));
  return Math.round(total / 3);
}
