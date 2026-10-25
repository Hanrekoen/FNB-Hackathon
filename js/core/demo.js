// Example data for a first look: about six weeks in the life of a student on an allowance.
// It is replayed through the real engine (allocations, bill payments, spending), so every
// balance is consistent, and it is always relative to today so it never looks stale.

import { billNextDue, goalSaved, monthOf, summarize } from './budget.js';
import { DAY_MS, EMERGENCY_STARTER, allocate, applyAllocation, checkRelease, payBill, requestRelease, setAside } from './buckets.js';
import { spendingNotices } from './coach.js';
import { addDays, daysBetween, parseISO } from './dates.js';
import { spendingPace } from './forecast.js';
import { PER_MONTH, contributionsLeft, goalTarget, monthlyCapacity, monthlyEssentials, suggestCuts } from './goals.js';
import { emptyData } from './schema.js';
import { applySweeps, lastDayOf } from './sweep.js';

export const DEMO_DAYS = 42;
const HOLIDAY_WEEKS = 10;
const HOLIDAY_SAVED = 40_000;

const INCOMES = [
  [-41, 260_000, 'allowance'],
  [-33, 60_000, 'gig'],
  [-27, 60_000, 'familyIn'],
  [-18, 60_000, 'gig'],
  [-13, 260_000, 'allowance'],
  [-4, 60_000, 'gig'],
];

// [category, min rand, max rand, notes]. Friday takeaways and Saturday outings give the weekday
// insight something to find and the coach real extras to suggest cutting; groceries never are.
const WEEKDAY_SPEND = [['food', 15, 60, ['Shoprite', 'Spaza']], ['airtime', 12, 29, []], ['food', 20, 45, ['Pick n Pay']], ['takeaway', 30, 60, ['Chicken Licken']]];
const WEEKEND_TREAT = { 5: ['takeaway', 45, 90, ['KFC', 'Steers']], 6: ['outings', 50, 110, []] };
const WEEKEND_EXTRA = [['food', 25, 70, ['Spaza']], ['takeaway', 30, 60, ['Debonairs']]];
const CLOTHING = [-20, 15_000, 'Pep'];

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
  // Example data is for exploring, so it skips the guided setup.
  data.setup = { done: true, step: 'summary' };
  // Rent falls inside the 3-day notice period so a release request shows the rent warning.
  data.bills = [
    { id: id(), name: names.rent, amount: 120_000, frequency: 'monthly', dueDay: dayOf(addDays(today, 3)), amountType: 'fixed', kind: 'essential', lastPaidDue: null },
    { id: id(), name: names.data, amount: 9_900, frequency: 'monthly', dueDay: dayOf(addDays(today, 15)), amountType: 'fixed', kind: 'essential', lastPaidDue: null },
    { id: id(), name: names.taxi, amount: 15_000, frequency: 'weekly', weekday: weekdayOf(addDays(today, 2)), amountType: 'varies', linkedCategory: 'transport', kind: 'essential', lastPaidDue: null },
    { id: id(), name: names.registration, amount: 25_000, frequency: 'once', dueDate: addDays(today, 20), amountType: 'fixed', kind: 'essential', lastPaidDue: null },
    // A want: the coach can suggest cancelling it to fund her savings.
    { id: id(), name: names.streaming, amount: 9_900, frequency: 'monthly', dueDay: dayOf(addDays(today, 12)), amountType: 'fixed', kind: 'want', lastPaidDue: null },
  ];
  const incomes = new Map(INCOMES.map(([offset, amount, category]) => [addDays(today, offset), { amount, category }]));

  // Her safety net exists from the start; month-end sweeps fill it as the weeks go by.
  data.goals.push({ id: id(), name: names.emergency, target: EMERGENCY_STARTER, kind: 'emergency' });
  for (let d = start; d <= today; d = addDays(d, 1)) {
    applySweeps(data, d, { emergencyName: names.emergency, newId: id });
    const income = incomes.get(d);
    if (income) {
      const incomeId = id();
      data.transactions.push({ id: incomeId, type: 'in', amount: income.amount, category: income.category, note: '', date: d });
      applyAllocation(data, allocate(data, income.amount, d, incomeId), d, id);
    }
    for (const bill of [...data.bills]) {
      if (bill.frequency === 'once' || billNextDue(bill, d) !== d) continue;
      const amount = bill.amountType === 'varies' ? between(130, 190) : bill.amount;
      payBill(data, bill.id, d, amount, d, id);
    }
    const treat = WEEKEND_TREAT[weekdayOf(d)];
    const choices = treat ? [treat, ...(rand() < 0.5 ? [pick(WEEKEND_EXTRA)] : [])] : rand() < 0.55 ? [pick(WEEKDAY_SPEND)] : [];
    if (d === addDays(today, CLOTHING[0])) data.transactions.push({ id: id(), type: 'out', amount: CLOTHING[1], category: 'clothing', note: CLOTHING[2], date: d });
    for (const [category, min, max, notes] of choices) {
      const amount = between(min, max);
      const s = summarize(data, d);
      if (amount > s.free - s.unfunded) continue;
      data.transactions.push({ id: id(), type: 'out', amount, category, note: notes.length ? pick(notes) : '', date: d });
    }
  }

  // She has set aside everything due before her next income, then asked for a little back.
  const release = 5_000;
  const s = summarize(data, today);
  const topUp = Math.min(s.unfundedEssential + s.unfundedWant + release, Math.max(0, s.free));
  if (topUp > 0) setAside(data, topUp, today, id);
  safetyNetFrom(data, today, names.savings, id);
  thisMonthEarmark(data, today, id);
  addHoliday(data, today, names.holiday, id);
  savingMoreThisMonth(data, today, id);
  if (!checkRelease(data, release)) requestRelease(data, release, names.releaseReason, now - DAY_MS, id);
  return data;
}

/**
 * Savings from a holiday job months ago, so her safety net covers about 1.5 months of essentials.
 * Cash-neutral (in, then saved) and dated well outside the 90 days used for careful income, so it
 * doesn't look like recent pay.
 */
function safetyNetFrom(data, today, note, id) {
  const fund = data.goals.find((g) => g.kind === 'emergency');
  const date = addDays(today, -200);
  const income = { id: id(), type: 'in', amount: 1, category: 'otherIn', note, date };
  const saved = { id: id(), type: 'save', amount: 1, goalId: fund.id, category: 'save', note: '', date };
  data.transactions.push(income, saved);
  // Essentials are averaged over the history there is, which this older entry lengthens.
  const want = Math.round(monthlyEssentials(data, today).total * 1.5) - goalSaved(data.transactions, fund.id) + 1;
  income.amount = Math.max(1, want);
  saved.amount = Math.max(1, want);
}

/** Saving set aside this month and waiting for month-end, even if no income has come in yet. */
function thisMonthEarmark(data, today, id) {
  const month = monthOf(today);
  if (data.earmarks.some((e) => e.month === month)) return;
  const s = summarize(data, today);
  const amount = Math.min(15_000, Math.floor(Math.max(0, s.free - s.unfunded) / 3 / 1_000) * 1_000);
  if (amount > 0) data.earmarks.push({ id: id(), month, kind: 'emergency', amount, incomeId: null });
}

/**
 * She set a little more aside for saving this month, so judges see a spending notice: unless
 * month-end is close (which has its own notice), what's left now won't last until payday at her
 * usual pace. Her spending isn't changed, so her goal stays a stretch rather than out of reach.
 */
function savingMoreThisMonth(data, today, id) {
  const shown = spendingNotices(data, today)?.id;
  if (shown === 'monthEndSoon' || shown === 'protectSaving') return;
  const s = summarize(data, today);
  const days = Math.max(1, Math.min(daysBetween(today, lastDayOf(monthOf(today))), daysBetween(today, s.next.date)));
  const needed = spendingPace(data.transactions, today).perDay * days;
  const extra = Math.ceil((s.free - needed + 1_000) / 1_000) * 1_000;
  if (extra > 0 && extra < s.free) data.earmarks.push({ id: id(), month: monthOf(today), kind: 'emergency', amount: extra, incomeId: null });
}

/**
 * A holiday goal sized from her own numbers so it always needs a few small cuts ('stretch'),
 * whatever day the example is loaded. A fixed date and amount would drift into 'unrealistic'.
 */
function addHoliday(data, today, name, id) {
  const goal = { id: id(), name, target: 0, kind: 'goal', by: addDays(today, HOLIDAY_WEEKS * 7) };
  const saved = Math.min(HOLIDAY_SAVED, Math.floor(Math.max(0, summarize(data, today).free - summarize(data, today).unfunded) / 4 / 1000) * 1000);
  if (saved > 0) data.transactions.push({ id: id(), type: 'save', amount: saved, goalId: goal.id, category: 'save', note: '', date: addDays(today, -13) });
  data.goals.push(goal);
  const capacity = monthlyCapacity(data, today, goal);
  // The gap takes all of the biggest cut and part of the next, so two extras are always named.
  const [first, second] = suggestCuts(data, today, Infinity);
  const gap = second ? first.cut + Math.ceil(second.cut / 2) : Math.ceil((first?.cut ?? 0) / 2);
  const need = capacity.available + gap;
  const perWeek = Math.floor(need / PER_MONTH.varies);
  goal.target = saved + Math.max(5_000, Math.floor((perWeek * contributionsLeft(data, today, goal.by)) / 5_000) * 5_000);
}
