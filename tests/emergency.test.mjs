import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cashAvailable, goalSaved, safetyBalance } from '../js/core/budget.js';
import { moveToGoal } from '../js/core/buckets.js';
import { addDays } from '../js/core/dates.js';
import { EMERGENCY_STARTER, goalPlan, goalTarget, monthlyEssentials } from '../js/core/goals.js';
import { emptyData, normalize } from '../js/core/schema.js';

const TODAY = '2026-10-24';
let n = 0;
const tx = (type, amount, date, extra = {}) => ({ id: `e${++n}`, type, amount, date, category: 'other', note: '', ...extra });
const bill = (id, amount, extra = {}) => ({ id, name: id, amount, frequency: 'monthly', dueDay: 1, amountType: 'fixed', kind: 'essential', lastPaidDue: null, ...extra });
const fund = { id: 'em', name: 'Emergency fund', target: 100_000, kind: 'emergency' };

/** Rent R1 500 (essential), gym R300 (want), a once-off fee, and R600 of groceries in 30 days. */
function household() {
  const d = emptyData('', addDays(TODAY, -29));
  d.bills = [bill('rent', 150_000), bill('gym', 30_000, { kind: 'want' }), bill('fee', 25_000, { frequency: 'once', dueDate: '2026-11-10' })];
  d.transactions.push(tx('in', 500_000, addDays(TODAY, -29), { category: 'wages' }), tx('out', 60_000, '2026-10-10', { category: 'food' }));
  d.goals = [{ ...fund }];
  return d;
}

describe('emergency fund target', () => {
  test('monthly essentials: essential bills plus everyday essentials, with the parts', () => {
    assert.deepEqual(monthlyEssentials(household(), TODAY), { bills: 150_000, spending: 60_000, total: 210_000, days: 30 });
  });

  test('target is months x essentials, rounded up to R100; the stored target is ignored', () => {
    const d = household();
    assert.equal(goalTarget(d, d.goals[0], TODAY), 1_260_000); // 6 x R2 100
    d.settings.emergencyMonths = 3;
    d.transactions.push(tx('out', 1, '2026-10-11', { category: 'food' })); // a cent more a month
    assert.equal(goalTarget(d, d.goals[0], TODAY), 640_000); // 3 x R2 100,01, rounded up
  });

  test('with no bills and no history, the starter target', () => {
    const d = emptyData('', TODAY);
    assert.equal(goalTarget(d, { ...fund }, TODAY), EMERGENCY_STARTER);
  });

  test('other goals keep their own target', () => {
    assert.equal(goalTarget(household(), { id: 'g', target: 77_700, kind: 'goal' }, TODAY), 77_700);
  });

  test('emergencyMonths is validated (1-12) and migrated (default 6)', () => {
    const months = (v) => normalize({ settings: { emergencyMonths: v } }, TODAY).settings.emergencyMonths;
    assert.deepEqual([months(undefined), months(3), months(12), months(0), months(13), months('6'), months(2.5)], [6, 3, 12, 6, 6, 6, 6]);
  });
});

describe('moving money from the emergency fund to a goal', () => {
  test('records a withdrawal and a saving; totals stay consistent', () => {
    const d = household();
    d.goals.push({ id: 'trip', name: 'Trip', target: 200_000, kind: 'goal', by: '2027-02-01' });
    d.transactions.push(tx('save', 80_000, '2026-10-12', { goalId: 'em', category: 'save' }));
    const [cash, safety] = [cashAvailable(d.transactions), safetyBalance(d)];
    moveToGoal(d, 'em', 'trip', 30_000, TODAY, () => `m${++n}`);
    assert.deepEqual(d.transactions.slice(-2).map((t) => [t.type, t.goalId, t.amount]), [['withdraw', 'em', 30_000], ['save', 'trip', 30_000]]);
    assert.deepEqual([goalSaved(d.transactions, 'em'), goalSaved(d.transactions, 'trip')], [50_000, 30_000]);
    assert.equal(cashAvailable(d.transactions), cash);
    assert.equal(safetyBalance(d), safety);
  });
});

describe('goal suggestions', () => {
  test('want bills first, then everyday extras, then a later date or a lower amount; never essentials', () => {
    const d = household();
    for (let i = 0; i < 6; i++) d.transactions.push(tx('in', 100_000, addDays(TODAY, -7 * i), { category: 'wages' }));
    d.transactions.push(tx('out', 40_000, '2026-10-20', { category: 'takeaway' }));
    const goal = { id: 'car', name: 'Car', target: 2_000_000, kind: 'goal', by: addDays(TODAY, 28) };
    d.goals.push(goal);
    const p = goalPlan(d, goal, TODAY);
    assert.equal(p.status, 'unrealistic');
    assert.equal(p.cuts[0].name, 'gym');
    assert.ok(p.cuts.slice(1).every((c) => c.category && !['food', 'rent'].includes(c.category)));
    assert.ok(p.alternatives.earliestFeasibleDate || p.alternatives.maxAffordable >= 0);
  });
});
