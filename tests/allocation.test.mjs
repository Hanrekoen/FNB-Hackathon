import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { needsHorizon, summarize } from '../js/core/budget.js';
import { allocate, applyAllocation, deleteTransaction } from '../js/core/buckets.js';
import { defaultIncome } from '../js/core/income.js';
import { emptyData } from '../js/core/schema.js';

let n = 0;
const id = () => `a${++n}`;
const DAY0 = '2026-11-02'; // a Monday
const bill = (bid, name, amount, dueDay, extra = {}) => ({ id: bid, name, amount, frequency: 'monthly', dueDay, amountType: 'fixed', kind: 'essential', lastPaidDue: null, ...extra });

/**
 * The reported bug: a new user paid irregularly ("It varies", no history) with R8 000 of
 * essential bills spread over the next four weeks, an emergency fund and a goal with a plan.
 */
function newUser() {
  const d = emptyData('', DAY0);
  d.income = defaultIncome();
  d.bills = [
    bill('rent', 'Rent', 450_000, 5),
    bill('power', 'Electricity', 100_000, 12),
    bill('school', 'School fees', 150_000, 19),
    bill('loan', 'Loan repayment', 100_000, 26, { category: 'debt' }),
  ];
  d.goals = [
    { id: 'em', name: 'Emergency fund', target: 1_000_000, kind: 'emergency' },
    { id: 'laptop', name: 'Laptop', target: 600_000, kind: 'goal', by: '2027-03-01', plan: { cuts: [], perContribution: 20_000, acceptedAt: 1 } },
  ];
  return d;
}

function income(d, amount, date) {
  const tid = id();
  d.transactions.push({ id: tid, type: 'in', amount, category: 'wages', note: '', date });
  const a = allocate(d, amount, date, tid);
  applyAllocation(d, a, date, id);
  return { a, tid };
}

describe('the R8 000 reproduction', () => {
  test('nothing is earmarked until every essential bill in the next 30 days is covered', () => {
    const d = newUser();
    const day0 = income(d, 250_000, DAY0).a;
    assert.deepEqual([day0.needsEssential, day0.earmarkEmergency, day0.earmarkGoals.length], [250_000, 0, 0]);

    // The bug: on day 7 the next income looked 7 days away, so later bills were ignored and this
    // income went to saving. Now the 30-day window still sees R5 500 of bills to cover.
    const day7 = income(d, 250_000, '2026-11-09').a;
    assert.deepEqual([day7.needsEssential, day7.earmarkEmergency, day7.earmarkGoals.length, day7.free], [250_000, 0, 0, 0]);

    const day14 = income(d, 500_000, '2026-11-16').a;
    assert.equal(day14.needsEssential, 300_000, 'the last R3 000 of bills');
    const s = summarize(d, '2026-11-16');
    assert.equal(s.needs, 800_000);
    assert.equal(s.unfundedEssential, 0);
    // Only now: 10% of the R2 000 left, then the laptop plan's share, then free money
    assert.equal(day14.earmarkEmergency, 20_000);
    assert.deepEqual(day14.earmarkGoals.map((g) => g.goalId), ['laptop']);
    assert.equal(day14.free, 500_000 - 300_000 - 20_000 - day14.earmarkGoals[0].amount);
  });

  test('income smaller than the essential shortfall goes 100% to bills', () => {
    const a = income(newUser(), 100_000, DAY0).a;
    assert.deepEqual([a.needs, a.earmarkEmergency, a.free], [100_000, 0, 0]);
  });

  test('want bills are covered only after essentials, and before any earmark', () => {
    const d = newUser();
    d.bills.push(bill('gym', 'Gym', 40_000, 20, { kind: 'want' }));
    const small = income(d, 820_000, DAY0).a;
    assert.deepEqual([small.needsEssential, small.needsWant, small.earmarkEmergency], [800_000, 20_000, 0], 'half the gym, nothing earmarked');
    const b = income(d, 100_000, '2026-11-03').a;
    assert.deepEqual([b.needsEssential, b.needsWant, b.earmarkEmergency], [0, 20_000, 8_000], 'rest of the gym, then 10% of R800');
  });

  test('earmarks reduce safe-to-spend, and deleting the income removes them', () => {
    const d = newUser();
    income(d, 800_000, DAY0);
    const { tid } = income(d, 400_000, '2026-11-03');
    const s = summarize(d, '2026-11-03');
    assert.ok(s.earmarked > 0);
    assert.equal(s.free, s.cash - s.needs - s.earmarked);
    deleteTransaction(d, tid, '2026-11-03', id);
    assert.equal(summarize(d, '2026-11-03').earmarked, 0);
    assert.deepEqual(d.earmarks, []);
  });
});

describe('needs horizon', () => {
  test('30 days ahead, or the next payday if that is later', () => {
    const d = newUser();
    assert.equal(needsHorizon(d, DAY0), '2026-12-02');
    // Paid early on the 24th, so the next monthly payday is 25 December: 31 days away
    d.income = { ...defaultIncome(), pattern: 'monthly', payDay: 25 };
    d.transactions.push({ id: id(), type: 'in', amount: 900_000, category: 'wages', note: '', date: '2026-11-24' });
    assert.equal(needsHorizon(d, '2026-11-24'), '2026-12-25');
  });
});
