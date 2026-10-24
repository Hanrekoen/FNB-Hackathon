// Example data for a first look: about six weeks in the life of a student on an allowance.
// It is replayed through the real engine (allocations, bill payments, spending), so every
// balance is consistent, and it is always relative to today so it never looks stale.

import { billNextDue, summarize } from './budget.js';
import { DAY_MS, allocate, applyAllocation, checkRelease, payBill, requestRelease, setAside } from './buckets.js';
import { addDays, parseISO } from './dates.js';
import { PER_MONTH, contributionsLeft, maxCuts, monthlyCapacity } from './goals.js';
import { emptyData } from './schema.js';

export const DEMO_DAYS = 42;
const HOLIDAY_WEEKS = 10;
const HOLIDAY_SAVED = 40_000;

const INCOMES = [
  [-41, 240_000, 'allowance'],
  [-33, 45_000, 'gig'],
  [-27, 30_000, 'familyIn'],
  [-18, 45_000, 'gig'],
  [-13, 240_000, 'allowance'],
  [-4, 50_000, 'gig'],
];

// [category, min rand, max rand, notes]; weekend treats are what make the weekday insight work
const WEEKDAY_SPEND = [['food', 15, 60, ['Shoprite', 'Spaza']], ['airtime', 12, 29, []], ['food', 20, 45, ['Pick n Pay']]];
const WEEKEND_SPEND = [['fun', 35, 90, ['KFC', 'Steers']], ['food', 25, 70, ['Spaza']], ['clothing', 60, 120, ['Pep']]];

// Deterministic, so the same day always produces the same example (not for security use).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const dayOf = (iso) => parseISO(iso).getDate();
const weekdayOf = (iso) => parseISO(iso).getDay();

/**
 * Builds a complete example dataset. `names` holds translated labels (bills, goal, release
 * reason) because the data is stored as entered, in the user's language at the time.
 */
export function generateDemo({ today, now, names, profileName = '', newId }) {
  let n = 0;
  const id = newId ?? (() => `demo-${++n}`);
  const rand = seeded(Number(today.replaceAll('-', '')));
  const between = (min, max) => Math.round(min + rand() * (max - min)) * 100;
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];

  const start = addDays(today, -DEMO_DAYS);
  const data = emptyData(profileName, start);
  data.demo = true;
  // Rent falls inside the 3-day notice period so a release request shows the rent warning.
  data.bills = [
    { id: id(), name: names.rent, amount: 120_000, frequency: 'monthly', dueDay: dayOf(addDays(today, 3)), amountType: 'fixed', lastPaidDue: null },
    { id: id(), name: names.data, amount: 9_900, frequency: 'monthly', dueDay: dayOf(addDays(today, 15)), amountType: 'fixed', lastPaidDue: null },
    { id: id(), name: names.taxi, amount: 15_000, frequency: 'weekly', weekday: weekdayOf(addDays(today, 2)), amountType: 'varies', linkedCategory: 'transport', lastPaidDue: null },
    { id: id(), name: names.registration, amount: 25_000, frequency: 'once', dueDate: addDays(today, 20), amountType: 'fixed', lastPaidDue: null },
  ];
  const incomes = new Map(INCOMES.map(([offset, amount, category]) => [addDays(today, offset), { amount, category }]));

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const income = incomes.get(d);
    if (income) {
      data.transactions.push({ id: id(), type: 'in', amount: income.amount, category: income.category, note: '', date: d });
      applyAllocation(data, allocate(data, income.amount, d), d, names.emergency, id);
    }
    for (const bill of [...data.bills]) {
      if (bill.frequency === 'once' || billNextDue(bill, d) !== d) continue;
      const amount = bill.amountType === 'varies' ? between(130, 190) : bill.amount;
      payBill(data, bill.id, d, amount, d, id);
    }
    const weekend = [5, 6].includes(weekdayOf(d));
    const count = weekend ? 1 + Math.floor(rand() * 2) : rand() < 0.55 ? 1 : 0;
    for (let i = 0; i < count; i++) {
      const [category, min, max, notes] = pick(weekend ? WEEKEND_SPEND : WEEKDAY_SPEND);
      const amount = between(min, max);
      const s = summarize(data, d);
      if (amount > s.free - s.unfunded) continue;
      data.transactions.push({ id: id(), type: 'out', amount, category, note: notes.length ? pick(notes) : '', date: d });
    }
  }

  // She has set aside everything due before her next income, then asked for a little back.
  const release = 5_000;
  const s = summarize(data, today);
  const topUp = Math.min(s.unfunded + release, Math.max(0, s.free));
  if (topUp > 0) setAside(data, topUp, today, id);
  addHoliday(data, today, names.holiday, id);
  if (!checkRelease(data, release)) requestRelease(data, release, names.releaseReason, now - DAY_MS, id);
  return data;
}

/**
 * A holiday goal sized from her own numbers so it always needs a few small cuts ('stretch'),
 * whatever day the example is loaded. A fixed date and amount would drift into 'unrealistic'.
 */
function addHoliday(data, today, name, id) {
  const goal = { id: id(), name, target: 0, kind: 'goal', by: addDays(today, HOLIDAY_WEEKS * 7) };
  const saved = Math.min(HOLIDAY_SAVED, Math.floor(Math.max(0, summarize(data, today).free) / 2 / 1000) * 1000);
  if (saved > 0) data.transactions.push({ id: id(), type: 'save', amount: saved, goalId: goal.id, category: 'save', note: '', date: addDays(today, -13) });
  data.goals.push(goal);
  const capacity = monthlyCapacity(data, today, goal);
  const need = capacity.available + Math.ceil(maxCuts(data, today) / 2);
  const perWeek = Math.floor(need / PER_MONTH.varies);
  goal.target = saved + Math.max(5_000, Math.floor((perWeek * contributionsLeft(data, today, goal.by)) / 5_000) * 5_000);
}
