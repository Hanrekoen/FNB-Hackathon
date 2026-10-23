import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  billNextDue, cashAvailable, goalSaved, incomeGapDays, monthlyIncomeEstimate, nextDueDate, nextIncome,
  spendingByCategory, splitIncome, summarize,
} from '../js/core/budget.js';
import { assessLoan, effectiveAnnualRate, loanCost } from '../js/core/credit.js';
import { addDays, daysBetween, isISODate } from '../js/core/dates.js';
import { formatMoney, parseAmount, parseOptionalAmount, parsePercent } from '../js/core/money.js';
import { checkMessage } from '../js/core/scam.js';
import { checkBackupPassword, checkNewSecret } from '../js/core/security.js';

const tx = (type, amount, date, extra = {}) => ({ id: Math.random().toString(36), type, amount, date, category: 'other', ...extra });
const data = (over = {}) => ({ transactions: [], bills: [], goals: [], nextIncome: null, settings: { savePercent: 10 }, ...over });

describe('money', () => {
  test('parses common South African formats into cents', () => {
    assert.equal(parseAmount('150'), 15000);
    assert.equal(parseAmount('150.5'), 15050);
    assert.equal(parseAmount('150,50'), 15050);
    assert.equal(parseAmount('R 1 234,56'), 123456);
    assert.equal(parseAmount('1,234.56'), 123456);
    assert.equal(parseAmount('1,234'), 123400);
  });

  test('rejects invalid, zero, negative and absurd amounts', () => {
    for (const bad of ['', 'abc', '-5', '0', '0.00', '1.234', '1e5', '12..3', '99999999999', null, 5]) {
      assert.equal(parseAmount(bad), null, String(bad));
    }
  });

  test('optional amounts treat blank as zero', () => {
    assert.equal(parseOptionalAmount('  '), 0);
    assert.equal(parseOptionalAmount('x'), null);
  });

  test('percent parsing', () => {
    assert.equal(parsePercent('27,5'), 27.5);
    assert.equal(parsePercent('24%'), 24);
    assert.equal(parsePercent('0'), 0);
    assert.equal(parsePercent('-1'), null);
    assert.equal(parsePercent('abc'), null);
  });

  test('formats rand', () => {
    assert.match(formatMoney(123456), /1.234,56|1.234\.56/);
  });
});

describe('dates', () => {
  test('validates and does arithmetic across month and year ends', () => {
    assert.ok(isISODate('2024-02-29'));
    assert.ok(!isISODate('2023-02-29'));
    assert.ok(!isISODate('2024-13-01'));
    assert.equal(addDays('2024-12-30', 3), '2025-01-02');
    assert.equal(daysBetween('2024-02-27', '2024-03-01'), 3);
  });
});

describe('budget', () => {
  test('cash counts savings moves', () => {
    const txs = [tx('in', 10000, '2025-01-01'), tx('out', 2500, '2025-01-02'), tx('save', 1000, '2025-01-02', { goalId: 'g' }), tx('withdraw', 400, '2025-01-03', { goalId: 'g' })];
    assert.equal(cashAvailable(txs), 6900);
    assert.equal(goalSaved(txs, 'g'), 600);
  });

  test('learns typical gap between irregular incomes', () => {
    const txs = ['2025-01-01', '2025-01-08', '2025-01-16', '2025-01-22'].map((d) => tx('in', 1000, d));
    assert.equal(incomeGapDays(txs), 7);
    assert.equal(incomeGapDays([tx('in', 1, '2025-01-01')]), null);
  });

  test('next income: user date, then estimate, then late, then default', () => {
    const incomes = [tx('in', 1000, '2025-01-01'), tx('in', 1000, '2025-01-11')];
    assert.deepEqual(nextIncome(data({ nextIncome: '2025-01-15', transactions: incomes }), '2025-01-12'), { date: '2025-01-15', source: 'user' });
    assert.equal(nextIncome(data({ transactions: incomes }), '2025-01-12').date, '2025-01-21');
    assert.equal(nextIncome(data({ transactions: incomes }), '2025-01-25').source, 'late');
    assert.equal(nextIncome(data(), '2025-01-12').date, '2025-01-26');
  });

  test('bill due dates handle short months and paid bills', () => {
    assert.equal(nextDueDate(31, '2025-02-10'), '2025-02-28');
    assert.equal(nextDueDate(5, '2025-12-20'), '2026-01-05');
    assert.equal(nextDueDate(20, '2025-12-20'), '2025-12-20');
    assert.equal(billNextDue({ dueDay: 20, lastPaidDue: '2025-12-20' }, '2025-12-18'), '2026-01-20');
  });

  test('safe daily amount sets aside bills before next income', () => {
    const d = data({
      nextIncome: '2025-03-11',
      transactions: [tx('in', 100000, '2025-03-01'), tx('out', 5000, '2025-03-01')],
      bills: [{ id: 'b', name: 'Rent', amount: 45000, dueDay: 5, lastPaidDue: null }],
    });
    const s = summarize(d, '2025-03-01');
    // cash 95 000 at end of day; start of day 100 000; minus rent 45 000 = 55 000 over 10 days
    assert.equal(s.cash, 95000);
    assert.equal(s.perDay, 5500);
    assert.equal(s.spentToday, 5000);
    assert.equal(s.leftToday, 500);
    assert.equal(s.billsTotal, 45000);
    assert.equal(s.shortfall, 0);
  });

  test('bill payments do not count as daily spending; overspend goes negative', () => {
    const d = data({
      nextIncome: '2025-03-03',
      transactions: [tx('in', 10000, '2025-03-01'), tx('out', 3000, '2025-03-01', { billId: 'b' }), tx('out', 4000, '2025-03-01')],
    });
    const s = summarize(d, '2025-03-01');
    assert.equal(s.spentToday, 4000);
    assert.equal(s.perDay, 3500); // (10000-3000)/2
    assert.equal(s.leftToday, -500);
  });

  test('reports a shortfall when bills exceed cash', () => {
    const d = data({ nextIncome: '2025-03-20', transactions: [tx('in', 1000, '2025-03-01')], bills: [{ id: 'b', amount: 5000, dueDay: 10 }] });
    const s = summarize(d, '2025-03-01');
    assert.equal(s.shortfall, 4000);
    assert.equal(s.perDay, 0);
  });

  test('monthly helpers', () => {
    const txs = [tx('out', 300, '2025-03-02', { category: 'food' }), tx('out', 500, '2025-03-03', { category: 'rent' }), tx('out', 200, '2025-03-04', { category: 'food' }), tx('out', 999, '2025-02-01', { category: 'food' })];
    assert.deepEqual(spendingByCategory(txs, '2025-03'), [{ category: 'food', amount: 500 }, { category: 'rent', amount: 500 }]);
    assert.equal(monthlyIncomeEstimate([tx('in', 30000, '2025-03-01'), tx('in', 30000, '2024-01-01')], '2025-03-10'), 10000);
  });

  test('income split covers uncovered bills, then savings', () => {
    assert.deepEqual(splitIncome(10000, 10, 4000), { bills: 4000, save: 600, spend: 5400, pct: 10 });
    assert.deepEqual(splitIncome(1000, 10, 4000), { bills: 1000, save: 0, spend: 0, pct: 10 });
  });
});

describe('credit', () => {
  test('standard amortised loan', () => {
    // R10 000 at 24% for 12 months: instalment ~ R945.60
    const r = loanCost({ principal: 1_000_000, annualRate: 24, months: 12 });
    assert.equal(r.monthly, 94560);
    assert.equal(r.total, 94560 * 12);
    assert.ok(Math.abs(r.effectiveRate - 26.82) < 0.05, `effective ${r.effectiveRate}`);
  });

  test('zero interest and fees', () => {
    const r = loanCost({ principal: 120_000, annualRate: 0, months: 12, monthlyFee: 6_900 });
    assert.equal(r.monthly, 16_900);
    assert.equal(r.cost, 6_900 * 12);
    assert.equal(effectiveAnnualRate(100, 10, 10), 0);
  });

  test('flags illegal rates, unaffordable loans and very costly credit', () => {
    const p = 500_000;
    const r = loanCost({ principal: p, annualRate: 120, months: 24 });
    const a = assessLoan(r, p, 120, 600_000);
    assert.equal(a.level, 'danger');
    const keys = a.reasons.map((x) => x.key);
    assert.ok(keys.includes('credit.r.illegal'));
    assert.ok(keys.includes('credit.r.double'));
  });

  test('a modest loan within budget is ok', () => {
    const p = 300_000;
    const r = loanCost({ principal: p, annualRate: 18, months: 12 });
    const a = assessLoan(r, p, 18, 1_500_000);
    assert.equal(a.level, 'ok');
  });

  test('unknown income is a caution', () => {
    const r = loanCost({ principal: 100_000, annualRate: 10, months: 6 });
    assert.equal(assessLoan(r, 100_000, 10, 0).level, 'caution');
  });
});

describe('scam checker', () => {
  test('classic prize + fee + link scam is high risk', () => {
    const r = checkMessage('CONGRATULATIONS! You have won R50 000. Pay the R500 release fee urgently to claim: http://bit.ly/abc');
    assert.equal(r.level, 'high');
    for (const id of ['prize', 'upfront', 'urgent', 'shortLink']) assert.ok(r.matches.includes(id), id);
  });

  test('requests for OTP are flagged; genuine "never share" notices are not', () => {
    assert.ok(checkMessage('Bank security: please send us the OTP you just received to verify your account').matches.includes('secret'));
    assert.equal(checkMessage('Your OTP is 482913. Never share it with anyone.').level, 'none');
  });

  test('remote access, mule and new-number scams', () => {
    assert.ok(checkMessage('Install AnyDesk so our agent can fix your banking').matches.includes('remote'));
    assert.ok(checkMessage('You will receive money in your account, then send it to my cousin').matches.includes('mule'));
    assert.equal(checkMessage('Hi mom, I lost my phone, this is my new number. Please send R800 urgently, don\'t tell dad').level, 'high');
  });

  test('ordinary messages are not flagged', () => {
    for (const msg of ['Hi, I will be home at 6. Please buy bread.', 'Meeting moved to Tuesday 10am at the church hall.']) {
      assert.equal(checkMessage(msg).level, 'none', msg);
    }
  });

  test('handles huge and odd input quickly', () => {
    const t0 = performance.now();
    checkMessage('a'.repeat(1_000_000));
    checkMessage(`send ${' '.repeat(5000)} otp`);
    assert.ok(performance.now() - t0 < 500);
  });
});

describe('PIN rules', () => {
  test('rejects short, repeated, sequential and common PINs', () => {
    assert.equal(checkNewSecret('12345', '12345'), 'err.pinShort');
    for (const weak of ['111111', '123456', '987654', '121212', '123123', 'password']) {
      assert.equal(checkNewSecret(weak, weak), 'err.pinWeak', weak);
    }
    assert.equal(checkNewSecret('583920', '583921'), 'err.pinMatch');
    assert.equal(checkNewSecret('583920', '583920'), null);
  });

  test('backup passwords must be longer and not just digits', () => {
    assert.equal(checkBackupPassword('short', 'short'), 'err.backupShort');
    assert.equal(checkBackupPassword('1234567890', '1234567890'), 'err.pinWeak');
    assert.equal(checkBackupPassword('blue-taxi-rank-42', 'blue-taxi-rank-42'), null);
  });
});
