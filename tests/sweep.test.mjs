import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { goalSaved, summarize } from '../js/core/budget.js';
import { emptyData, normalize } from '../js/core/schema.js';
import { applySweeps, lastDayOf, livingBuffer, monthsToSweep } from '../js/core/sweep.js';

let n = 0;
const id = () => `s${++n}`;
const tx = (type, amount, date, extra = {}) => ({ id: id(), type, amount, date, category: 'other', note: '', ...extra });
const earmark = (month, amount, extra = {}) => ({ id: id(), month, kind: 'emergency', amount, incomeId: null, ...extra });
const plan = { cuts: [], perContribution: 10_000, acceptedAt: 1 }; // R100 a week: R433,34 a month

/** R5 000 came in on 5 October; R500 was earmarked for the safety net that month. */
function october(cashOut = 0) {
  const d = emptyData('', '2026-10-01');
  d.transactions.push(tx('in', 500_000, '2026-10-05', { category: 'wages' }));
  if (cashOut) d.transactions.push(tx('out', cashOut, '2026-10-20', { category: 'debt' }));
  d.goals = [{ id: 'em', name: 'Emergency fund', target: 1_000_000, kind: 'emergency' }];
  d.earmarks = [earmark('2026-10', 50_000)];
  return d;
}

const opts = { emergencyName: 'Emergency fund', newId: id };

describe('month-end sweep', () => {
  test('moves the earmark once, dated the last day of the month', () => {
    const d = october();
    const [w] = applySweeps(d, '2026-11-02', opts);
    assert.deepEqual([w.month, w.emergency, w.emergencyShort], ['2026-10', 50_000, 0]);
    assert.equal(goalSaved(d.transactions, 'em'), 50_000);
    assert.equal(d.transactions.at(-1).date, '2026-10-31');
    assert.deepEqual(d.earmarks, []);
    assert.deepEqual(applySweeps(d, '2026-11-20', opts), [], 'never twice');
    assert.equal(summarize(d, '2026-11-02').earmarked, 0);
  });

  test('partial when some of the earmark was spent, and the shortfall is recorded', () => {
    const d = october(470_000); // R300 left of the R500
    const [w] = applySweeps(d, '2026-11-02', opts);
    assert.deepEqual([w.emergency, w.emergencyShort], [30_000, 20_000]);
  });

  test('never takes money set aside for bills', () => {
    const d = october(470_000);
    d.transactions.push(tx('needs', 25_000, '2026-10-25', { category: 'needs' }));
    const [w] = applySweeps(d, '2026-11-02', opts);
    assert.deepEqual([w.emergency, w.emergencyShort], [5_000, 45_000]);
  });

  test("this month's earmarks are not touched by last month's sweep", () => {
    const d = october(20_000); // R4 800 cash
    d.earmarks.push(earmark('2026-11', 450_000));
    const [w] = applySweeps(d, '2026-11-02', opts);
    assert.deepEqual([w.emergency, w.emergencyShort], [30_000, 20_000]);
    assert.equal(summarize(d, '2026-11-02').earmarked, 450_000);
  });

  test('several missed months are swept in order, including a month with no income', () => {
    const d = october();
    d.earmarks.unshift(earmark('2026-09', 30_000));
    assert.deepEqual(monthsToSweep(d, '2026-12-02'), ['2026-09', '2026-10', '2026-11']);
    const done = applySweeps(d, '2026-12-02', opts);
    assert.deepEqual(done.map((w) => [w.month, w.emergency]), [['2026-09', 30_000], ['2026-10', 50_000], ['2026-11', 0]]);
    assert.deepEqual(d.transactions.filter((t) => t.type === 'save').map((t) => t.date), ['2026-09-30', '2026-10-31']);
  });

  test('once the safety net is full, its share goes to goals', () => {
    const d = october();
    // No bills or essential spending yet, so the target is the R1 000 starter: R900 already saved
    d.transactions.push(tx('save', 90_000, '2026-10-06', { goalId: 'em', category: 'save' }));
    d.goals.push({ id: 'trip', name: 'Trip', target: 300_000, kind: 'goal', by: '2027-02-01', plan });
    const [w] = applySweeps(d, '2026-11-02', opts);
    assert.equal(w.emergency, 10_000, 'only what the fund still needed');
    assert.deepEqual(w.goals, [{ goalId: 'trip', amount: 43_334 }]); // R400 redirected + R33,34 leftover
  });

  test('goals get leftover cash only above the living buffer', () => {
    const d = emptyData('', '2026-10-01');
    d.transactions.push(tx('in', 100_000, '2026-10-05', { category: 'wages' }), tx('out', 50_000, '2026-10-20', { category: 'food' }));
    d.goals = [{ id: 'trip', name: 'Trip', target: 300_000, kind: 'goal', by: '2027-02-01', plan }];
    d.earmarks = [earmark('2026-10', 1)];
    // R500 of groceries in 30 days for the 14 days until the next income: R233,34 kept
    assert.equal(livingBuffer(d, '2026-11-02'), 23_334);
    const [w] = applySweeps(d, '2026-11-02', opts);
    assert.deepEqual(w.goals, [{ goalId: 'trip', amount: 50_000 - 1 - 23_334 }]);
  });

  test('a goal without an accepted plan is never funded automatically', () => {
    const d = october();
    d.goals.push({ id: 'trip', name: 'Trip', target: 300_000, kind: 'goal', by: '2027-02-01' });
    assert.deepEqual(applySweeps(d, '2026-11-02', opts)[0].goals, []);
  });

  test('nothing to sweep before any earmark, and the last day of each month', () => {
    assert.deepEqual(monthsToSweep(emptyData('', '2026-10-01'), '2026-12-01'), []);
    assert.deepEqual(['2026-02', '2028-02', '2026-12'].map(lastDayOf), ['2026-02-28', '2028-02-29', '2026-12-31']);
  });

  test('earmarks and sweeps survive normalisation; bad ones are dropped', () => {
    const d = normalize({
      earmarks: [earmark('2026-10', 500), { month: '2026-13', kind: 'emergency', amount: 5 }, { month: '2026-10', kind: 'goal', amount: 5 }, { month: '2026-10', kind: 'emergency', amount: -1 }],
      sweeps: [{ month: '2026-09', emergency: 1, emergencyShort: 0, goals: [] }, { month: '2026-09', emergency: 9 }, { month: 'x' }],
    }, '2026-11-01');
    assert.equal(d.earmarks.length, 1);
    assert.deepEqual(d.sweeps, [{ month: '2026-09', emergency: 1, emergencyShort: 0, goals: [] }]);
    assert.deepEqual([normalize({}, '2026-11-01').earmarks, normalize({}, '2026-11-01').sweeps], [[], []]);
  });
});
