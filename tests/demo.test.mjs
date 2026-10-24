import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from '../js/core/budget.js';
import { pendingReleases } from '../js/core/buckets.js';
import { generateDemo } from '../js/core/demo.js';
import { normalize } from '../js/core/schema.js';

const names = { rent: 'Rent', data: 'Data', taxi: 'Taxi', registration: 'Fee', emergency: 'Emergency fund', releaseReason: 'Airtime' };
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
  });
}

test('example data is the same every time for the same day', () => {
  assert.deepEqual(make('2026-10-24'), make('2026-10-24'));
});
