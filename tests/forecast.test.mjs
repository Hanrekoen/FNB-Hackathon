import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { billOccurrences, summarize } from '../js/core/budget.js';
import { addDays } from '../js/core/dates.js';
import { monthlyEquivalent, runOutForecast, spendingPace, variableEstimate, weekdayInsight } from '../js/core/forecast.js';
import { emptyData } from '../js/core/schema.js';

const TODAY = '2026-10-24'; // a Saturday
const out = (date, amount, category = 'food', extra = {}) => ({ id: `${date}-${amount}`, type: 'out', amount, date, category, ...extra });
const fuel = (over) => ({ id: 'f', name: 'Fuel', amount: 30_000, frequency: 'weekly', weekday: 1, amountType: 'varies', linkedCategory: 'transport', lastPaidDue: null, ...over });

describe('variable bill estimate', () => {
  test('falls back to the entered amount with little history', () => {
    const txs = [out('2026-10-20', 15_000, 'transport'), out('2026-10-13', 15_000, 'transport')];
    assert.deepEqual(variableEstimate(fuel(), txs, TODAY), { amount: 30_000, estimated: false });
  });

  test('uses the last 6 weeks of linked spending, rounded up to R10', () => {
    const txs = [0, 7, 14, 21, 28, 35].map((d) => out(addDays(TODAY, -d), 15_000, 'transport'));
    txs.push(out(addDays(TODAY, -50), 99_999, 'transport'), out(TODAY, 77_700, 'food'));
    assert.equal(variableEstimate(fuel(), txs, TODAY).amount, 15_000);
    // R1 500 over 6 weeks, monthly: 250 * 52 / 12 = 1 083.33 -> R1 090
    const monthly = fuel({ frequency: 'monthly', dueDay: 1, weekday: undefined });
    assert.equal(variableEstimate(monthly, txs.slice(0, 6).map((t) => ({ ...t, amount: 25_000 })), TODAY).amount, 109_000);
  });

  test('monthly equivalents ignore once-off bills', () => {
    assert.equal(monthlyEquivalent({ frequency: 'weekly', amount: 12_000, amountType: 'fixed' }, [], TODAY), 52_000);
    assert.equal(monthlyEquivalent({ frequency: 'once', amount: 12_000, amountType: 'fixed' }, [], TODAY), 0);
  });
});

describe('weekly bills', () => {
  test('count once for every occurrence before the next income', () => {
    const taxi = { frequency: 'weekly', weekday: 1, lastPaidDue: null };
    assert.deepEqual(billOccurrences(taxi, TODAY, addDays(TODAY, 14)), ['2026-10-26', '2026-11-02']);
    assert.deepEqual(billOccurrences({ ...taxi, lastPaidDue: '2026-10-26' }, TODAY, addDays(TODAY, 14)), ['2026-11-02']);
    const d = emptyData('', TODAY);
    d.nextIncome = addDays(TODAY, 14);
    d.bills = [{ id: 't', name: 'Taxi', amount: 15_000, ...taxi, amountType: 'fixed' }];
    assert.equal(summarize(d, TODAY).billsTotal, 30_000);
  });
});

describe('run-out forecast', () => {
  test('pace excludes bill payments', () => {
    const txs = [out(TODAY, 14_000), out('2026-10-20', 14_000), out('2026-10-20', 50_000, 'bills', { billId: 'b' }), out('2026-10-01', 90_000)];
    assert.deepEqual(spendingPace(txs, TODAY), { perDay: 2_000, spent: 28_000, days: 14 });
  });

  test('warns when free money runs out before the next income', () => {
    const pace = { perDay: 10_000, spent: 140_000, days: 14 };
    assert.deepEqual(runOutForecast(50_000, pace, TODAY, addDays(TODAY, 10)), { onTrack: false, pace, date: '2026-10-29', gap: 5 });
    assert.equal(runOutForecast(150_000, pace, TODAY, addDays(TODAY, 10)).onTrack, true);
    assert.equal(runOutForecast(0, { perDay: 0, spent: 0, days: 14 }, TODAY, addDays(TODAY, 10)).onTrack, true);
  });
});

describe('weekday insight', () => {
  test('needs 3 weeks of data', () => {
    assert.equal(weekdayInsight([out('2026-10-10', 1_000)], TODAY), null);
  });

  test('finds the highest-spending weekday with the numbers behind it', () => {
    const txs = [];
    for (let d = 0; d < 35; d++) {
      const date = addDays(TODAY, -d);
      txs.push(out(date, new Date(`${date}T12:00`).getDay() === 5 ? 18_000 : 3_000));
    }
    const r = weekdayInsight(txs, TODAY);
    assert.equal(r.weekday, 5);
    assert.equal(r.average, 18_000);
    assert.equal(r.total, 18_000 * r.count);
  });
});
