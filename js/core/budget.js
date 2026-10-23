// Budgeting for irregular income: instead of a monthly budget, work out how much is
// safe to spend per day until the next money is expected, after setting aside bills.

import { addDays, daysBetween, daysInMonth, parseISO, toISO } from './dates.js';

export const DEFAULT_GAP_DAYS = 14; // no income history yet
export const OVERDUE_PLAN_DAYS = 7; // income is late: plan conservatively for another week

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Cash on hand: money in, minus money out, minus money moved into savings goals. */
export function cashAvailable(txs) {
  let cash = 0;
  for (const tx of txs) cash += tx.type === 'in' || tx.type === 'withdraw' ? tx.amount : -tx.amount;
  return cash;
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

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Typical number of days between income payments, from the most recent ones. */
export function incomeGapDays(txs) {
  const dates = [...new Set(txs.filter((t) => t.type === 'in').map((t) => t.date))].sort();
  if (dates.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  return Math.max(1, median(gaps.slice(-6)));
}

export function nextIncome(data, today) {
  if (data.nextIncome && data.nextIncome >= today) return { date: data.nextIncome, source: 'user' };
  const incomes = data.transactions.filter((t) => t.type === 'in').map((t) => t.date).sort();
  const last = incomes.at(-1);
  const gap = incomeGapDays(data.transactions);
  if (gap && last) {
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

export function billNextDue(bill, today) {
  const due = nextDueDate(bill.dueDay, today);
  if (bill.lastPaidDue && bill.lastPaidDue >= due) return nextDueDate(bill.dueDay, addDays(bill.lastPaidDue, 1));
  return due;
}

export function summarize(data, today) {
  const txs = data.transactions;
  const cash = cashAvailable(txs);
  // Bill payments aren't "daily spending": they were already set aside.
  const spentToday = sum(txs.filter((t) => t.type === 'out' && t.date === today && !t.billId).map((t) => t.amount));
  const next = nextIncome(data, today);
  const daysLeft = Math.max(1, daysBetween(today, next.date));
  const billsDue = data.bills
    .map((b) => ({ ...b, due: billNextDue(b, today) }))
    .filter((b) => b.due <= next.date)
    .sort((a, b) => a.due.localeCompare(b.due));
  const billsTotal = sum(billsDue.map((b) => b.amount));
  const startOfDay = cash + spentToday;
  const perDay = Math.max(0, Math.floor((startOfDay - billsTotal) / daysLeft));
  return {
    cash,
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

/** Suggested way to divide new income: cover uncovered bills first, then pay yourself, then daily spending. */
export function splitIncome(amount, savePercent, uncoveredBills) {
  const bills = Math.min(amount, uncoveredBills);
  const save = Math.floor(((amount - bills) * savePercent) / 100);
  return { bills, save, spend: amount - bills - save, pct: savePercent };
}
