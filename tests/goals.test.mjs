import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CUTTABLE } from '../js/core/categories.js';
import { addDays } from '../js/core/dates.js';
import {
  alternatives, contributionsLeft, datedGoalContributions, goalPlan, maxCuts, monthlyCapacity, monthlyNeed,
  perContribution, suggestCuts,
} from '../js/core/goals.js';
import { cautiousMonthlyIncome, defaultIncome } from '../js/core/income.js';
import { emptyData } from '../js/core/schema.js';

const TODAY = '2026-10-24'; // a Saturday
let n = 0;
const tx = (type, amount, date, extra = {}) => ({ id: `t${++n}`, type, amount, date, category: 'other', note: '', ...extra });

/**
 * R1 000 every Tuesday since 1 Sep (careful income R4 000/month), rent R1 500, R420 of fun and
 * groceries and clothes in the last two weeks (R900/month), and an empty R1 000 emergency fund (R400/month).
 * Left for a new goal: R1 200 a month. Most the cuts can find: fun R150 + clothing R10 = R160
 * (groceries are essential and never cut).
 */
function base(income = defaultIncome()) {
  const d = emptyData('', '2026-09-01');
  d.income = income;
  for (let date = '2026-09-01'; date <= TODAY; date = addDays(date, 7)) d.transactions.push(tx('in', 100_000, date, { category: 'wages' }));
  d.bills = [{ id: 'rent', name: 'Rent', amount: 150_000, frequency: 'monthly', dueDay: 1, amountType: 'fixed', lastPaidDue: null }];
  d.transactions.push(tx('out', 30_000, '2026-10-20', { category: 'fun' }), tx('out', 9_500, '2026-10-22', { category: 'food' }), tx('out', 2_500, '2026-10-22', { category: 'clothing' }));
  d.goals = [{ id: 'em', name: 'Emergency fund', target: 100_000, kind: 'emergency' }];
  return d;
}

function withGoal(d, target, by, saved = 0) {
  d.goals.push({ id: 'g', name: 'Holiday', target, kind: 'goal', by });
  if (saved) d.transactions.push(tx('save', saved, '2026-10-01', { goalId: 'g', category: 'save' }));
  return d.goals.at(-1);
}

const monthly = (payDay) => ({ ...defaultIncome(), pattern: 'monthly', payDay });

describe('contributions left before a deadline', () => {
  test('monthly paydays, including the weekend shift and day 31', () => {
    // 25 Oct is a Sunday, so October's payday was Fri 23 Oct; only 25 Nov falls before 15 Dec
    assert.equal(contributionsLeft({ ...base(monthly(25)), transactions: [] }, TODAY, '2026-12-15'), 1);
    assert.equal(contributionsLeft({ ...base(monthly(25)), transactions: [] }, TODAY, '2027-02-28'), 4);
    // Day 31: 30 Jan (31st is a Saturday), 27 Feb (28th is a Saturday), 31 Mar, 30 Apr
    assert.equal(contributionsLeft({ ...base(monthly(31)), transactions: [] }, '2026-01-10', '2026-04-30'), 4);
  });

  test('weekly and two-weekly', () => {
    const weekly = { ...defaultIncome(), pattern: 'weekly', payWeekday: 5 };
    assert.equal(contributionsLeft({ ...base(weekly), transactions: [] }, TODAY, '2026-11-20'), 4);
    const biweekly = { ...defaultIncome(), pattern: 'biweekly', anchorDate: '2026-10-16' };
    assert.equal(contributionsLeft({ ...base(biweekly), transactions: [] }, TODAY, '2026-11-30'), 3);
  });

  test('"It varies" counts weeks, at least one', () => {
    assert.equal(contributionsLeft(base(), TODAY, addDays(TODAY, 20)), 2);
    assert.equal(contributionsLeft(base(), TODAY, addDays(TODAY, 3)), 1);
  });

  test('a deadline today or in the past leaves no contributions', () => {
    assert.equal(contributionsLeft(base(), TODAY, TODAY), 0);
    assert.equal(contributionsLeft(base(), TODAY, '2026-01-01'), 0);
  });

  test("today's payday counts only while splitting today's income", () => {
    const d = { ...base(monthly(25)), transactions: [tx('in', 500_000, '2026-11-25')] };
    assert.equal(contributionsLeft(d, '2026-11-25', '2026-12-31'), 1);
    assert.equal(contributionsLeft(d, '2026-11-25', '2026-12-31', true), 2);
  });

  test('a monthly earner with no payday before the deadline saves it all at once', () => {
    assert.equal(contributionsLeft({ ...base(monthly(25)), transactions: [] }, TODAY, '2026-11-10'), 1);
  });
});

describe('amounts', () => {
  test('per contribution rounds up to the cent; monthly need follows the pay pattern', () => {
    assert.equal(perContribution(260_000, 7), 37_143);
    assert.equal(perContribution(300_000, 3), 100_000);
    assert.equal(perContribution(5_000, 0), 5_000);
    assert.equal(monthlyNeed(base(), 37_143), 160_953); // weekly: x 52 / 12
    assert.equal(monthlyNeed(base(monthly(25)), 37_143), 37_143);
  });

  test('careful income is the 25th percentile of rolling 30-day totals, below the average', () => {
    assert.equal(cautiousMonthlyIncome(base().transactions, TODAY), 400_000);
    const mixed = [tx('in', 240_000, '2026-09-13'), tx('in', 45_000, '2026-09-21'), tx('in', 30_000, '2026-09-27'), tx('in', 45_000, '2026-10-06'), tx('in', 240_000, '2026-10-11'), tx('in', 50_000, '2026-10-20')];
    const careful = cautiousMonthlyIncome(mixed, TODAY);
    assert.ok(careful > 45_000 * 4, 'not fooled by a small side payment');
    assert.ok(careful < Math.round((650_000 * 30) / 41), 'more careful than the average');
    assert.equal(cautiousMonthlyIncome([tx('in', 70_000, '2026-10-10')], TODAY), 70_000);
    assert.equal(cautiousMonthlyIncome([], TODAY), 0);
  });
});

describe('monthly capacity', () => {
  test('returns every number used', () => {
    assert.deepEqual(monthlyCapacity(base(), TODAY), { income: 400_000, essentials: 150_000, spending: 90_000, emergency: 40_000, otherGoals: 0, available: 120_000 });
  });

  test('the emergency share stops at its target, and other dated goals count', () => {
    const d = base();
    d.transactions.push(tx('save', 80_000, '2026-10-01', { goalId: 'em', category: 'save' }));
    d.goals.push({ id: 'other', name: 'Shoes', target: 40_000, kind: 'goal', by: addDays(TODAY, 28) });
    const c = monthlyCapacity(d, TODAY);
    assert.equal(c.emergency, 20_000);
    assert.equal(c.otherGoals, 43_334); // R100 a week for 4 weeks
    assert.equal(c.available, 400_000 - 150_000 - 90_000 - 20_000 - 43_334);
    assert.equal(monthlyCapacity(d, TODAY, d.goals.at(-1)).otherGoals, 0);
  });
});

describe('spending cuts', () => {
  test('biggest category first, rounded up to R10, stopping once the gap is covered', () => {
    assert.deepEqual(suggestCuts(base(), TODAY, 10_000), [{ category: 'fun', current: 30_000, cut: 10_000, after: 20_000 }]);
    assert.deepEqual(suggestCuts(base(), TODAY, 15_500), [{ category: 'fun', current: 30_000, cut: 15_000, after: 15_000 }, { category: 'clothing', current: 2_500, cut: 1_000, after: 1_500 }]);
    assert.deepEqual(suggestCuts(base(), TODAY, 0), []);
  });

  test('caps are never exceeded, even when the gap is bigger', () => {
    const cuts = suggestCuts(base(), TODAY, 1_000_000);
    for (const c of cuts) assert.ok(c.cut <= (c.current * CUTTABLE[c.category]) / 100, c.category);
    assert.equal(maxCuts(base(), TODAY), 16_000);
  });

  test('essentials and bill payments are never cut', () => {
    const d = base();
    for (const category of ['rent', 'electricity', 'bills', 'school', 'health', 'food', 'airtime', 'family', 'stokvel', 'debt', 'transport']) {
      d.transactions.push(tx('out', 900_000, '2026-10-21', { category }));
    }
    d.transactions.push(tx('out', 900_000, '2026-10-21', { category: 'fun', billId: 'x' }));
    const cuts = suggestCuts(d, TODAY, 1_000_000);
    assert.deepEqual(cuts.map((c) => c.category), ['fun', 'clothing']);
    assert.equal(cuts[0].current, 30_000, 'a bill payment is not everyday spending');
  });
});

describe('goal status', () => {
  const by = addDays(TODAY, 28); // 4 weekly contributions

  test('on track', () => {
    const d = base();
    const p = goalPlan(d, withGoal(d, 80_000, by), TODAY);
    assert.equal(p.status, 'onTrack');
    assert.equal(p.perContribution, 20_000);
    assert.equal(p.unit, 'week');
    assert.deepEqual(p.cuts, []);
  });

  test('stretch: closable with cuts', () => {
    const d = base();
    const p = goalPlan(d, withGoal(d, 120_000, by), TODAY);
    assert.equal(p.status, 'stretch');
    assert.equal(p.monthlyNeed, 130_000);
    assert.equal(p.gap, 10_000);
    assert.deepEqual(p.cuts, [{ category: 'fun', current: 30_000, cut: 10_000, after: 20_000 }]);
  });

  test('unrealistic, with a later date or a lower amount that both fit', () => {
    const d = base();
    const goal = withGoal(d, 200_000, by);
    const p = goalPlan(d, goal, TODAY);
    assert.equal(p.status, 'unrealistic');
    assert.equal(p.alternatives.earliestFeasibleDate, addDays(TODAY, 49));
    assert.equal(p.alternatives.maxAffordable, 125_000);
    assert.notEqual(goalPlan(d, { ...goal, by: p.alternatives.earliestFeasibleDate }, TODAY).status, 'unrealistic');
    assert.notEqual(goalPlan(d, { ...goal, target: p.alternatives.maxAffordable }, TODAY).status, 'unrealistic');
  });

  test('says whether spending habits or income are what stops the goal', () => {
    // R1 200 is left after spending; R2 100 would be left if everyday spending were zero.
    const d = base();
    const spendingBound = goalPlan(d, withGoal(d, 190_000, by), TODAY);
    assert.equal(spendingBound.status, 'unrealistic');
    assert.equal(spendingBound.limitedBy, 'spending'); // R2 058/month fits within R1 200 + R900
    const e = base();
    const incomeBound = goalPlan(e, withGoal(e, 400_000, by), TODAY);
    assert.equal(incomeBound.limitedBy, 'income'); // R4 333/month: even spending nothing wouldn't free that up
    const f = base();
    assert.equal(goalPlan(f, withGoal(f, 120_000, by), TODAY).limitedBy, 'spending');
  });

  test('an oversized later goal does not make an earlier goal unmanageable', () => {
    const d = base();
    const soon = withGoal(d, 120_000, by);
    d.goals.push({ id: 'big', name: 'Laptop', target: 2_000_000, kind: 'goal', by: addDays(TODAY, 35) });
    assert.equal(goalPlan(d, soon, TODAY).status, 'stretch');
    const big = goalPlan(d, d.goals.at(-1), TODAY);
    assert.equal(big.status, 'unrealistic');
    assert.equal(big.capacity.otherGoals, 130_000, 'the earlier goal comes first');
  });

  test('a suggested later date still fits once other goals come before it', () => {
    const d = base();
    const big = withGoal(d, 200_000, by);
    d.goals.push({ id: 'mid', name: 'Shoes', target: 30_000, kind: 'goal', by: addDays(TODAY, 42) });
    const p = goalPlan(d, big, TODAY);
    assert.equal(p.status, 'unrealistic');
    const moved = { ...big, by: p.alternatives.earliestFeasibleDate };
    assert.ok(moved.by > d.goals.at(-1).by, 'the new date puts Shoes ahead of it');
    assert.notEqual(goalPlan({ ...d, goals: d.goals.map((g) => (g.id === big.id ? moved : g)) }, moved, TODAY).status, 'unrealistic');
  });

  test('zero capacity: no date can be promised', () => {
    const d = base();
    d.bills[0].amount = 900_000;
    const goal = withGoal(d, 200_000, by, 30_500);
    const p = goalPlan(d, goal, TODAY);
    assert.equal(p.status, 'unrealistic');
    assert.deepEqual(alternatives(d, goal, TODAY, p.capacity), { earliestFeasibleDate: null, maxAffordable: 30_000, perAmount: 0 });
  });

  test('unknown until there are 3 incomes and 3 weeks of history, but still shows the amount', () => {
    const d = base();
    d.transactions = d.transactions.filter((t) => t.type !== 'in' || t.date >= '2026-10-13');
    const p = goalPlan(d, withGoal(d, 80_000, by), TODAY);
    assert.equal(p.status, 'unknown');
    assert.equal(p.perContribution, 20_000);
  });

  test('reached, past due, and goals without a date', () => {
    const d = base();
    assert.equal(goalPlan(d, withGoal(d, 50_000, by, 50_000), TODAY).status, 'reached');
    const late = goalPlan(d, { id: 'late', name: 'Late', target: 50_000, kind: 'goal', by: TODAY }, TODAY);
    assert.equal(late.status, 'pastDue');
    assert.ok(late.alternatives.earliestFeasibleDate > TODAY);
    assert.equal(goalPlan(d, d.goals[0], TODAY), null);
  });

  test('a monthly earner plans per payday', () => {
    const d = base(monthly(25));
    const p = goalPlan(d, withGoal(d, 90_000, '2027-02-28'), TODAY);
    assert.equal(p.unit, 'payday');
    assert.equal(p.contributions, 4);
    assert.equal(p.perContribution, 22_500);
    assert.equal(p.monthlyNeed, 22_500);
  });
});

describe('income split contributions', () => {
  test('nearest deadline first; reached and past goals left out', () => {
    const d = base();
    d.goals.push(
      { id: 'late', name: 'Later', target: 40_000, kind: 'goal', by: addDays(TODAY, 56) },
      { id: 'soon', name: 'Sooner', target: 40_000, kind: 'goal', by: addDays(TODAY, 28) },
      { id: 'gone', name: 'Gone', target: 40_000, kind: 'goal', by: '2026-01-01' },
    );
    assert.deepEqual(datedGoalContributions(d, TODAY), [
      { goalId: 'soon', name: 'Sooner', amount: 10_000 },
      { goalId: 'late', name: 'Later', amount: 5_000 },
    ]);
  });
});
