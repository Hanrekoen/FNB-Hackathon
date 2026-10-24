import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextIncome } from '../js/core/budget.js';
import { defaultIncome, nextPayday, patternMismatch, percentile } from '../js/core/income.js';

const income = (over) => ({ ...defaultIncome(), ...over });
const pay = (date, amount = 100_000) => ({ id: date, type: 'in', amount, date, category: 'wages' });
const data = (over = {}) => ({ transactions: [], bills: [], goals: [], releases: [], nextIncome: null, income: defaultIncome(), settings: { savePercent: 10 }, ...over });

describe('next payday', () => {
  test('monthly payday on a weekday', () => {
    // 25 Nov 2026 is a Wednesday
    assert.equal(nextPayday(income({ pattern: 'monthly', payDay: 25 }), '2026-11-20'), '2026-11-25');
  });

  test('a weekend payday moves to the Friday before', () => {
    // 25 Oct 2026 is a Sunday
    assert.equal(nextPayday(income({ pattern: 'monthly', payDay: 25 }), '2026-10-20'), '2026-10-23');
  });

  test('day 31 means the last day of short months', () => {
    assert.equal(nextPayday(income({ pattern: 'monthly', payDay: 31 }), '2026-04-10'), '2026-04-30');
    // 28 Feb 2026 is a Saturday
    assert.equal(nextPayday(income({ pattern: 'monthly', payDay: 31 }), '2026-02-10'), '2026-02-27');
  });

  test('a payday already paid early is skipped', () => {
    const monthly = income({ pattern: 'monthly', payDay: 25 });
    assert.equal(nextPayday(monthly, '2026-11-24', '2026-11-24'), '2026-12-25');
    assert.equal(nextPayday(monthly, '2026-11-24', '2026-11-10'), '2026-11-25');
  });

  test('weekly and two-weekly', () => {
    // 24 Oct 2026 is a Saturday; payday Friday
    assert.equal(nextPayday(income({ pattern: 'weekly', payWeekday: 5 }), '2026-10-24'), '2026-10-30');
    assert.equal(nextPayday(income({ pattern: 'weekly', payWeekday: 6 }), '2026-10-24'), '2026-10-24');
    const biweekly = income({ pattern: 'biweekly', anchorDate: '2026-10-16' });
    assert.equal(nextPayday(biweekly, '2026-10-24'), '2026-10-30');
    assert.equal(nextPayday(biweekly, '2026-10-30', '2026-10-16'), '2026-10-30');
    assert.equal(nextPayday(biweekly, '2026-10-31'), '2026-11-13');
  });

  test('incomplete profiles have no payday', () => {
    assert.equal(nextPayday(income({ pattern: 'monthly' }), '2026-10-24'), null);
    assert.equal(nextPayday(income({ pattern: 'varies' }), '2026-10-24'), null);
  });
});

describe('next income resolution', () => {
  const history = ['2026-01-01', '2026-01-05', '2026-01-11', '2026-01-21', '2026-02-02'].map((d) => pay(d));

  test('a user-entered date wins, then the payday', () => {
    const d = data({ income: income({ pattern: 'monthly', payDay: 25 }), transactions: history });
    assert.deepEqual(nextIncome(d, '2026-11-20'), { date: '2026-11-25', source: 'payday' });
    assert.equal(nextIncome({ ...d, nextIncome: '2026-11-22' }, '2026-11-20').source, 'user');
  });

  test('"It varies" plans from the longer 75th-percentile gap', () => {
    // gaps 4, 6, 10, 12: median 8, 75th percentile 10
    assert.deepEqual(nextIncome(data({ transactions: history }), '2026-02-03'), { date: '2026-02-12', source: 'estimate', gap: 10 });
  });

  test('a stated pattern without its detail falls back to the median gap', () => {
    const d = data({ income: income({ pattern: 'monthly' }), transactions: history });
    assert.equal(nextIncome(d, '2026-02-03').date, '2026-02-10');
  });

  test('no history uses the 14-day default', () => {
    assert.deepEqual(nextIncome(data(), '2026-10-24'), { date: '2026-11-07', source: 'default' });
  });
});

describe('percentiles', () => {
  test('nearest rank, always a real value', () => {
    assert.equal(percentile([12, 7, 9, 9], 75), 9);
    assert.equal(percentile([3, 5, 7, 9, 11], 75), 9);
    assert.equal(percentile([3, 5, 7, 9, 11], 25), 5);
    assert.equal(percentile([], 50), null);
  });
});

describe('pattern mismatch nudge', () => {
  const tenDays = ['2026-09-01', '2026-09-11', '2026-09-21', '2026-10-01'].map((d) => pay(d));

  test('nudges when money comes much more often than stated', () => {
    assert.deepEqual(patternMismatch(income({ pattern: 'monthly', payDay: 25 }), tenDays, '2026-10-02'), { stated: 30, learned: 10 });
  });

  test('needs at least 3 incomes, a real difference, and respects snoozing', () => {
    const monthly = income({ pattern: 'monthly', payDay: 25 });
    assert.equal(patternMismatch(monthly, tenDays.slice(0, 2), '2026-10-02'), null);
    assert.equal(patternMismatch(income({ pattern: 'weekly', payWeekday: 5 }), ['2026-09-01', '2026-09-09', '2026-09-17'].map((d) => pay(d)), '2026-09-18'), null);
    assert.equal(patternMismatch({ ...monthly, nudgeSnoozedUntil: '2026-10-10' }, tenDays, '2026-10-02'), null);
    assert.ok(patternMismatch({ ...monthly, nudgeSnoozedUntil: '2026-10-02' }, tenDays, '2026-10-02'));
    assert.equal(patternMismatch(income(), tenDays, '2026-10-02'), null);
  });
});
