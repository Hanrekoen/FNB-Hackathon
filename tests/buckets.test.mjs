import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cashAvailable, needsBalance, safetyBalance, summarize } from '../js/core/budget.js';
import {
  DAY_MS, allocate, applyAllocation, cancelRelease, checkRelease, deleteTransaction, needsAvailable, payBill, releaseWarning,
  requestRelease, safetyConsequence, settleReleases,
} from '../js/core/buckets.js';
import { emptyData } from '../js/core/schema.js';

let n = 0;
const id = () => `id-${++n}`;
const TODAY = '2026-11-02'; // a Monday
const NOW = new Date('2026-11-02T10:00').getTime();

/**
 * The worked example from the spec: rent R1 200 on the 10th and R198 of data on the 4th (both
 * within the 30-day bill window), next income in 14 days.
 */
function lerato(over = {}) {
  const d = emptyData('Lerato', TODAY);
  d.nextIncome = '2026-11-16';
  d.bills = [
    { id: 'rent', name: 'Rent', amount: 120_000, frequency: 'monthly', dueDay: 10, amountType: 'fixed', kind: 'essential', lastPaidDue: null },
    { id: 'data', name: 'Data', amount: 19_800, frequency: 'monthly', dueDay: 4, amountType: 'fixed', kind: 'essential', lastPaidDue: null },
  ];
  return Object.assign(d, over);
}

function receive(d, amount) {
  d.transactions.push({ id: id(), type: 'in', amount, category: 'allowance', note: '', date: TODAY });
  return allocate(d, amount, TODAY);
}

const gym = { id: 'gym', name: 'Gym', amount: 30_000, frequency: 'monthly', dueDay: 20, amountType: 'fixed', kind: 'want', lastPaidDue: null };

describe('income allocation: bills first, saving earmarked for month-end', () => {
  test('worked example: R2 400 with R1 398 of bills due', () => {
    const d = lerato();
    const a = receive(d, 240_000);
    assert.deepEqual([a.needs, a.needsEssential, a.needsWant, a.earmarkEmergency, a.free], [139_800, 139_800, 0, 10_020, 90_180]);
    applyAllocation(d, a, TODAY, id);
    const s = summarize(d, TODAY);
    assert.equal(s.needs, 139_800);
    assert.equal(s.earmarked, 10_020);
    assert.equal(s.safety, 0, 'nothing moves to savings until month-end');
    assert.equal(s.free, 90_180);
    assert.equal(s.perDay, 6_441); // R901,80 / 14, the same as before earmarks
    assert.deepEqual(d.earmarks.map((e) => [e.month, e.kind, e.amount]), [['2026-11', 'emergency', 10_020]]);
  });

  test('a small income goes entirely to bills', () => {
    const a = receive(lerato(), 50_000);
    assert.deepEqual([a.needs, a.earmarkEmergency, a.free], [50_000, 0, 0]);
  });

  test('bills already covered are not topped up twice', () => {
    const d = lerato();
    d.transactions.push({ id: id(), type: 'in', amount: 139_800, date: TODAY, category: 'gig' });
    d.transactions.push({ id: id(), type: 'needs', amount: 139_800, date: TODAY, category: 'needs' });
    const a = receive(d, 100_000);
    assert.equal(a.needs, 0);
    assert.equal(a.earmarkEmergency, 10_000);
  });

  test('want bills are covered after essentials and before any earmark', () => {
    const d = lerato();
    d.bills.push(gym);
    const a = receive(d, 240_000);
    assert.deepEqual([a.needsEssential, a.needsWant, a.earmarkEmergency, a.free], [139_800, 30_000, 7_020, 63_180]);
    const small = lerato();
    small.bills.push(gym);
    const b = receive(small, 150_000);
    assert.deepEqual([b.needsEssential, b.needsWant, b.earmarkEmergency], [139_800, 10_200, 0]);
  });

  test('an accepted goal plan earmarks its monthly amount; other goals do not', () => {
    const d = lerato({ goals: [
      { id: 'hol', name: 'Holiday', target: 200_000, kind: 'goal', by: '2026-12-28', plan: { cuts: [], perContribution: 10_000, acceptedAt: 1 } },
      { id: 'shoes', name: 'Shoes', target: 50_000, kind: 'goal', by: '2026-12-01' },
    ] });
    const a = receive(d, 240_000);
    // R100 a week is R433,34 a month; this one income is the whole month's income so far
    assert.deepEqual(a.earmarkGoals, [{ goalId: 'hol', name: 'Holiday', amount: 43_334 }]);
    assert.equal(a.free, 240_000 - 139_800 - 10_020 - 43_334);
    applyAllocation(d, a, TODAY, id);
    assert.equal(summarize(d, TODAY).free, a.free);
  });

  test('never sets aside more than the cash on hand', () => {
    const d = lerato();
    d.transactions.push({ id: id(), type: 'out', amount: 200_000, date: TODAY, category: 'debt' });
    const a = receive(d, 240_000);
    assert.deepEqual([a.needs, a.earmarkEmergency, a.free], [40_000, 0, 200_000]);
  });

  test('without set-aside needs, unfunded bills still come out of free money', () => {
    const d = lerato();
    d.transactions.push({ id: id(), type: 'in', amount: 240_000, date: TODAY, category: 'gig' });
    const s = summarize(d, TODAY);
    assert.equal(s.unfunded, 139_800);
    assert.equal(s.perDay, Math.floor((240_000 - 139_800) / 14));
  });
});

describe('paying bills', () => {
  test('draws from needs first, then free money', () => {
    const d = lerato();
    applyAllocation(d, receive(d, 240_000), TODAY, id);
    payBill(d, 'rent', '2026-11-10', 120_000, TODAY, id);
    assert.equal(needsBalance(d.transactions), 19_800);
    payBill(d, 'data', '2026-11-04', 30_000, TODAY, id);
    assert.equal(needsBalance(d.transactions), 0);
    assert.equal(d.transactions.at(-1).fromNeeds, 19_800);
    assert.equal(d.bills.find((b) => b.id === 'rent').lastPaidDue, '2026-11-10');
  });

  test('a once-off bill disappears when paid; bill payments are not daily spending', () => {
    const d = lerato();
    d.bills.push({ id: 'fee', name: 'Fee', amount: 25_000, frequency: 'once', dueDate: '2026-11-05', amountType: 'fixed', lastPaidDue: null });
    d.transactions.push({ id: id(), type: 'in', amount: 100_000, date: TODAY, category: 'gig' });
    payBill(d, 'fee', '2026-11-05', 25_000, TODAY, id);
    assert.ok(!d.bills.some((b) => b.id === 'fee'));
    assert.equal(summarize(d, TODAY).spentToday, 0);
  });
});

describe('needs release', () => {
  function funded() {
    const d = lerato();
    applyAllocation(d, receive(d, 240_000), TODAY, id);
    return d;
  }

  test('request, cancel and request again', () => {
    const d = funded();
    assert.equal(checkRelease(d, 200_000), 'err.notEnoughNeeds');
    assert.equal(checkRelease(d, 0), 'err.amount');
    const r = requestRelease(d, 30_000, 'Airtime', NOW, id);
    assert.equal(r.availableAt, NOW + 3 * DAY_MS);
    assert.equal(needsAvailable(d), 109_800);
    assert.equal(checkRelease(d, 109_801), 'err.notEnoughNeeds');
    cancelRelease(d, r.id);
    assert.equal(needsAvailable(d), 139_800);
    requestRelease(d, 30_000, '', NOW, id);
    assert.equal(needsAvailable(d), 109_800);
  });

  test('money moves to free only after the notice period', () => {
    const d = funded();
    const before = summarize(d, TODAY).free;
    requestRelease(d, 30_000, '', NOW, id);
    assert.deepEqual(settleReleases(d, NOW + 3 * DAY_MS - 1, TODAY, id), []);
    assert.equal(needsBalance(d.transactions), 139_800);
    const done = settleReleases(d, NOW + 3 * DAY_MS, '2026-11-05', id);
    assert.equal(done.length, 1);
    assert.equal(done[0].status, 'released');
    assert.equal(needsBalance(d.transactions), 109_800);
    assert.equal(summarize(d, '2026-11-05').free, before + 30_000);
    assert.deepEqual(settleReleases(d, NOW + 10 * DAY_MS, '2026-11-05', id), []);
  });

  test('releases only what is left if bills were paid from needs meanwhile', () => {
    const d = funded();
    requestRelease(d, 30_000, '', NOW, id);
    d.transactions.push({ id: id(), type: 'out', amount: 130_000, date: TODAY, category: 'bills', billId: 'rent', fromNeeds: 130_000 });
    const [r] = settleReleases(d, NOW + 3 * DAY_MS, TODAY, id);
    assert.equal(r.amount, 9_800);
    assert.equal(needsBalance(d.transactions), 0);
  });

  test('warns when a release would leave a bill due in the notice period short', () => {
    const d = funded();
    // Rent is due on the 10th: outside the 3-day notice from the 2nd, so no warning.
    assert.equal(releaseWarning(d, 50_000, TODAY, NOW), null);
    const late = new Date('2026-11-08T10:00').getTime();
    const w = releaseWarning(d, 50_000, '2026-11-08', late);
    assert.equal(w.bill.name, 'Rent');
    // Rent R1 200 due by the 11th, R898 left after releasing R500
    assert.equal(w.short, 30_200);
  });
});

describe('safety withdrawal consequence', () => {
  test('shows the new balance and days of essentials covered', () => {
    const d = emptyData('', TODAY);
    d.bills = [{ id: 'b', name: 'Essentials', amount: 400_000, frequency: 'monthly', dueDay: 1, amountType: 'fixed', lastPaidDue: null }];
    d.goals = [{ id: 'e', name: 'Emergency', target: 100_000, kind: 'emergency' }];
    d.transactions.push({ id: id(), type: 'in', amount: 80_000, date: TODAY, category: 'gig' });
    d.transactions.push({ id: id(), type: 'save', amount: 80_000, goalId: 'e', date: TODAY, category: 'save' });
    assert.equal(safetyBalance(d), 80_000);
    assert.deepEqual(safetyConsequence(d, 50_000, TODAY), { before: 80_000, after: 30_000, daysBefore: 6, daysAfter: 2, monthsBefore: 0.2, monthsAfter: 0 });
  });

  test('without bills or spending, days are unknown', () => {
    assert.deepEqual(safetyConsequence(emptyData('', TODAY), 1_000, TODAY), { before: 0, after: 0, daysBefore: null, daysAfter: null, monthsBefore: null, monthsAfter: null });
  });
});

describe('deleting an income after its split', () => {
  /** The bug report: R2 000 in, split applied (R1 200 to Needs for rent), then the income is deleted. */
  function splitThenDelete(linkIncome) {
    const d = emptyData('', TODAY);
    d.bills = [{ id: 'rent', name: 'Rent', amount: 120_000, frequency: 'monthly', dueDay: 10, amountType: 'fixed', lastPaidDue: null }];
    d.nextIncome = '2026-11-16';
    const income = { id: 'pay', type: 'in', amount: 200_000, category: 'wages', note: '', date: TODAY };
    d.transactions.push(income);
    const plan = allocate(d, 200_000, TODAY, linkIncome ? 'pay' : null);
    applyAllocation(d, plan, TODAY, id);
    assert.equal(needsBalance(d.transactions), 120_000);
    return { d, result: deleteTransaction(d, 'pay', TODAY, id) };
  }

  test('removes the Needs and Safety moves made from that income', () => {
    const { d, result } = splitThenDelete(true);
    assert.equal(result.linked.length, 2);
    assert.equal(result.corrected, 0);
    const s = summarize(d, TODAY);
    assert.deepEqual([s.cash, s.needs, s.safety, s.free], [0, 0, 0, 0]);
    assert.equal(d.transactions.length, 0);
  });

  test('older data without a link: Needs is trimmed to the cash really there', () => {
    const { d, result } = splitThenDelete(false);
    assert.deepEqual(result.linked, []);
    assert.equal(result.corrected, 120_000);
    assert.equal(needsBalance(d.transactions), 0);
    assert.ok(needsBalance(d.transactions) <= Math.max(0, cashAvailable(d.transactions)));
    assert.equal(d.transactions.at(-1).correction, true);
  });

  test('also removes the month-end earmarks made from that income', () => {
    const d = lerato({ goals: [
      { id: 'hol', name: 'Holiday', target: 200_000, kind: 'goal', by: '2026-12-28', plan: { cuts: [], perContribution: 10_000, acceptedAt: 1 } },
    ] });
    d.transactions.push({ id: 'pay', type: 'in', amount: 240_000, category: 'allowance', note: '', date: TODAY });
    applyAllocation(d, allocate(d, 240_000, TODAY, 'pay'), TODAY, id);
    assert.equal(summarize(d, TODAY).earmarked, 10_020 + 43_334);
    const result = deleteTransaction(d, 'pay', TODAY, id);
    assert.equal(result.linked.length, 3, 'needs, the emergency earmark and the holiday earmark');
    assert.deepEqual(d.earmarks, []);
    assert.equal(summarize(d, TODAY).earmarked, 0);
    assert.equal(d.transactions.length, 0);
  });

  test('deleting other entries leaves Needs alone', () => {
    const d = lerato();
    applyAllocation(d, receive(d, 240_000), TODAY, id);
    const spend = { id: 'snack', type: 'out', amount: 2_000, category: 'food', note: '', date: TODAY };
    d.transactions.push(spend);
    const before = needsBalance(d.transactions);
    assert.deepEqual(deleteTransaction(d, 'snack', TODAY, id), { linked: [], corrected: 0 });
    assert.equal(needsBalance(d.transactions), before);
  });
});
