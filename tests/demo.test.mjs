import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from '../js/core/budget.js';
import { pendingReleases } from '../js/core/buckets.js';
import { assessMoney } from '../js/core/coach.js';
import { generateDemo } from '../js/core/demo.js';
import { goalPlan } from '../js/core/goals.js';
import { normalize } from '../js/core/schema.js';

const names = { rent: 'Rent', data: 'Data', taxi: 'Taxi', registration: 'Fee', emergency: 'Emergency fund', releaseReason: 'Airtime', holiday: 'Holiday', streaming: 'Showmax' };
const coachCut = (d, today) => assessMoney(d, today).emergency.plan.cuts;
const make = (today) => generateDemo({ today, now: new Date(`${today}T12:00`).getTime(), names, profileName: 'Lerato' });

// A spread of days: month ends, a leap day, year end, and every weekday
const DAYS = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-12-31', '2028-02-29', '2027-01-01'];

for (const today of DAYS) {
  test(`example data for ${today} is complete and consistent`, () => {
    const d = make(today);
    assert.deepEqual(normalize(structuredClone(d), today), d, 'survives normalisation unchanged');
    assert.ok(d.transactions.every((t) => t.date <= today), 'no future transactions');
    assert.equal(d.demo, true);
    assert.equal(d.profile.name, 'Lerato');

    const s = summarize(d, today);
    assert.ok(s.needs > 0, 'needs');
    assert.ok(s.safety > 0, 'safety');
    assert.ok(s.free > 0, 'free');
    assert.ok(s.perDay > 0, 'safe to spend');
    assert.equal(s.unfunded, 0, 'bills before next income are covered');

    assert.equal(pendingReleases(d).length, 1);
    assert.deepEqual(new Set(d.bills.map((b) => b.frequency)), new Set(['monthly', 'weekly', 'once']));
    assert.ok(d.bills.some((b) => b.amountType === 'varies'));
    const spending = d.transactions.filter((t) => t.type === 'out' && !t.billId).length;
    assert.ok(spending >= 25 && spending <= 60, `${spending} expenses`);
    assert.equal(d.goals.filter((g) => g.kind === 'emergency').length, 1);

    const holiday = d.goals.find((g) => g.by);
    const plan = goalPlan(d, holiday, today);
    assert.equal(plan.status, 'stretch', `holiday goal is ${plan.status}`);
    assert.ok(plan.cuts.length > 0, 'shows cut suggestions');
    assert.equal(plan.reason, 'notEnoughSpendable');
    // A want comes first (cancel the subscription), then an everyday extra; never an essential.
    assert.equal(plan.cuts[0].name, 'Showmax');
    assert.equal(plan.cuts[0].cut, 9_900);
    assert.ok(plan.cuts.slice(1).every((c) => ['takeaway', 'outings', 'clothing', 'fun', 'other'].includes(c.category)), 'only extras after the want');
    assert.equal(coachCut(d, today)[0].name, 'Showmax', 'the emergency fund advice also starts with the want');

    // A moment worth showing: the emergency fund can't grow this month, with the reason and impact.
    const coach = assessMoney(d, today);
    assert.ok(d.bills.some((b) => b.kind === 'want') && d.bills.some((b) => b.kind === 'essential'));
    assert.equal(coach.emergency.canSave, false);
    assert.equal(coach.emergency.reason, 'noFreeMoney');
    assert.ok(coach.emergency.impact.bill && coach.emergency.plan.cuts.length > 0);
    assert.notEqual(coach.peace.status, 'act', 'the example never starts with a bill short');
    assert.ok(plan.saved > 0 && plan.saved <= 40_000, `saved ${plan.saved}`);
  });
}

test('example data is the same every time for the same day', () => {
  assert.deepEqual(make('2026-10-24'), make('2026-10-24'));
});
