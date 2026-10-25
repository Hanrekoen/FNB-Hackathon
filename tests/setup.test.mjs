import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateDemo } from '../js/core/demo.js';
import { emptyData, normalize } from '../js/core/schema.js';
import { SETUP_STEPS, billTotals, canLeaveBills, finishSetup, nextStep, prevStep, restartSetup, stepNumber } from '../js/core/setup.js';

const TODAY = '2026-10-25';
const bill = (id, amount, extra = {}) => ({ id, name: id, amount, frequency: 'monthly', dueDay: 1, amountType: 'fixed', kind: 'essential', ...extra });

describe('setup state in the vault', () => {
  test('a new vault starts at the welcome step', () => {
    assert.deepEqual(normalize(emptyData('', TODAY), TODAY).setup, { done: false, step: 'welcome' });
  });

  test('older data with money in it skips setup', () => {
    const d = emptyData('', TODAY);
    delete d.setup;
    d.bills.push(bill('rent', 300_000));
    assert.equal(normalize(d, TODAY).setup.done, true);
  });

  test('older data with nothing in it, or a broken setup value, starts at welcome', () => {
    const d = emptyData('', TODAY);
    d.setup = { done: 'yes', step: 'nowhere' };
    assert.deepEqual(normalize(d, TODAY).setup, { done: false, step: 'welcome' });
  });

  test('a saved step survives a reload, so setup resumes there', () => {
    const d = emptyData('', TODAY);
    d.setup = { done: false, step: 'safety' };
    const reloaded = normalize(JSON.parse(JSON.stringify(d)), TODAY);
    assert.deepEqual(reloaded.setup, { done: false, step: 'safety' });
  });

  test('example data counts as set up', () => {
    const names = { rent: 'Rent', data: 'Data', taxi: 'Taxi', registration: 'Fee', emergency: 'Emergency fund', releaseReason: 'Airtime', holiday: 'Holiday', streaming: 'Showmax', savings: 'Savings' };
    const d = generateDemo({ today: TODAY, now: new Date(`${TODAY}T12:00`).getTime(), names, profileName: 'Lerato' });
    assert.equal(normalize(d, TODAY).setup.done, true);
  });

  test('run again and finish', () => {
    const d = emptyData('', TODAY);
    finishSetup(d);
    assert.deepEqual(d.setup, { done: true, step: 'summary' });
    restartSetup(d);
    assert.deepEqual(d.setup, { done: false, step: 'welcome' });
  });
});

describe('setup steps', () => {
  test('order, numbering and the ends', () => {
    assert.deepEqual(SETUP_STEPS, ['welcome', 'pay', 'bills', 'safety', 'goal', 'summary']);
    assert.equal(stepNumber('bills'), 3);
    assert.equal(nextStep('bills'), 'safety');
    assert.equal(prevStep('bills'), 'pay');
    assert.equal(prevStep('welcome'), 'welcome');
    assert.equal(nextStep('summary'), 'summary');
  });

  test('bills step needs a bill or "no bills right now"', () => {
    const d = emptyData('', TODAY);
    assert.equal(canLeaveBills(d), false);
    assert.equal(canLeaveBills(d, true), true);
    d.bills.push(bill('rent', 300_000));
    assert.equal(canLeaveBills(d), true);
  });

  test('running total splits essentials and wants, leaving out once-off bills', () => {
    const d = emptyData('', TODAY);
    d.bills.push(bill('rent', 300_000), bill('gym', 45_000, { kind: 'want' }),
      bill('fee', 50_000, { frequency: 'once', dueDate: '2026-11-10', dueDay: undefined }));
    assert.deepEqual(billTotals(d, TODAY), { essential: 300_000, want: 45_000, total: 345_000 });
  });
});
