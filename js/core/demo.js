// Example data for a first look: about six weeks in the life of a student on an allowance.
// It is replayed through the real engine (allocations, bill payments, spending), so every
// balance is consistent, and it is always relative to today so it never looks stale.

import { billNextDue, goalSaved, summarize } from './budget.js';
import { DAY_MS, allocate, applyAllocation, checkRelease, payBill, requestRelease, setAside } from './buckets.js';
import { addDays, parseISO } from './dates.js';
import { PER_MONTH, contributionsLeft, monthlyCapacity, suggestCuts } from './goals.js';
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
  // She aims high at 15%, which her current habits can't quite carry: the coach has something to explain.
  data.settings.savePercent = 15;
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

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const income = incomes.get(d);
    if (income) {
      const incomeId = id();
      data.transactions.push({ id: incomeId, type: 'in', amount: income.amount, category: income.category, note: '', date: d });
      applyAllocation(data, allocate(data, income.amount, d, incomeId), d, names.emergency, id);
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

  weekendTrip(data, today, id);

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
 * A weekend outing in the last fortnight, sized so this month's habits leave no room for the
 * emergency fund: the coach then has a real warning to explain. Skipped if it can't be afforded.
 */
function weekendTrip(data, today, id) {
  const c = monthlyCapacity(data, today);
  const em = data.goals.find((g) => g.kind === 'emergency');
  const share = Math.min(em ? em.target - goalSaved(data.transactions, em.id) : Infinity, Math.floor((c.income * data.settings.savePercent) / 100));
  const room = c.income - c.essentials - c.spending;
  if (share <= 0 || room < share) return;
  // Spending over 14 days counts about 30/14 times towards a month.
  const amount = Math.ceil(((room - share + 1_000) * 14) / 30 / 1_000) * 1_000;
  const s = summarize(data, today);
  if (amount > s.free - s.unfunded) return;
  let day = addDays(today, -1);
  while (weekdayOf(day) !== 6) day = addDays(day, -1);
  data.transactions.push({ id: id(), type: 'out', amount, category: 'outings', note: '', date: day });
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
