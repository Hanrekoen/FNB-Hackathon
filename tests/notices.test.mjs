import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { spendingNotices } from '../js/core/coach.js';
import { addDays } from '../js/core/dates.js';
import { emptyData, normalize } from '../js/core/schema.js';

const TODAY = '2026-10-24'; // a Saturday; month-end in 7 days, next income Tue 27 Oct
let n = 0;
const tx = (type, amount, date, extra = {}) => ({ id: `n${++n}`, type, amount, date, category: 'other', note: '', ...extra });

/**
 * R1 000 every Tuesday since 1 Sep (R8 000 in), rent R1 500 on the 26th already set aside, and
 * the same R50 of takeaways every week, so this week is a usual week. Cash on hand R7 720.
 */
function base() {
  const d = emptyData('', '2026-09-01');
  for (let date = '2026-09-01'; date <= '2026-10-20'; date = addDays(date, 7)) d.transactions.push(tx('in', 100_000, date, { category: 'wages' }));
  for (let k = 0; k < 5; k++) d.transactions.push(tx('out', 5_000, addDays('2026-10-23', -7 * k), { category: 'takeaway' }));
  d.transactions.push(tx('out', 3_000, '2026-10-20', { category: 'food' }), tx('needs', 150_000, '2026-10-20', { category: 'needs' }));
  d.bills = [{ id: 'rent', name: 'Rent', amount: 150_000, frequency: 'monthly', dueDay: 26, amountType: 'fixed', kind: 'essential', lastPaidDue: null }];
  d.goals = [{ id: 'em', name: 'Emergency fund', target: 100_000, kind: 'emergency' }];
  return d;
}

const earmark = (d, amount, extra = {}) => d.earmarks.push({ id: `k${++n}`, month: '2026-10', kind: 'emergency', amount, incomeId: null, ...extra });
/** Leaves `cash` on hand by paying an older essential (outside every spending window). */
const withCash = (d, cash) => d.transactions.push(tx('out', 772_000 - cash, '2026-10-01', { category: 'debt' }));

describe('spending notices', () => {
  test('nothing to say: no notice', () => {
    assert.equal(spendingNotices(base(), TODAY), null);
  });

  test('earmarkUsed: spending has already eaten into money set aside for saving', () => {
    const d = base();
    earmark(d, 50_000);
    withCash(d, 180_000); // rent R1 500 + only R300 of the R500 earmark left
    const notice = spendingNotices(d, TODAY);
    assert.equal(notice.id, 'earmarkUsed');
    assert.deepEqual(notice.vars, { used: 20_000, perDay: 100, date: '2026-10-31' }); // groceries: R30 in 30 days
    assert.equal(notice.action.kind, 'cut');
    assert.equal(notice.evidence.free, -20_000);
  });

  test('protectSaving: at this pace free money runs out before payday', () => {
    const d = base();
    earmark(d, 50_000);
    withCash(d, 201_000); // R10 free; spending about R9,29 a day for 3 days
    const notice = spendingNotices(d, TODAY);
    assert.equal(notice.id, 'protectSaving');
    assert.deepEqual(notice.vars, { earmarked: 50_000, goal: null, perDay: 333 });
    // R27,87 of spending until payday against R10 free: a R17,87 gap, rounded up to R20
    assert.deepEqual(notice.action, { kind: 'cut', category: 'takeaway', cut: 2_000 });
  });

  test('monthEndSoon: five days or fewer before month-end, with what will move', () => {
    const d = base();
    earmark(d, 50_000);
    d.goals.push({ id: 'trip', name: 'Trip', target: 300_000, kind: 'goal', by: '2027-02-01' });
    earmark(d, 20_000, { kind: 'goal', goalId: 'trip' });
    const notice = spendingNotices(d, '2026-10-27');
    assert.equal(notice.id, 'monthEndSoon');
    assert.deepEqual(notice.vars, { days: 4, emergency: 50_000, goalAmount: 20_000, goal: 'Trip', date: '2026-10-31' });
    assert.equal(spendingNotices(d, TODAY), null, 'not yet with 7 days to go');
  });

  test("overPace: this week's extras are 25%+ above a usual week", () => {
    const d = base();
    d.transactions.push(tx('out', 2_000, '2026-10-22', { category: 'outings' }), tx('out', 500, '2026-10-21', { category: 'takeaway' }));
    const notice = spendingNotices(d, TODAY);
    assert.equal(notice.id, 'overPace');
    assert.equal(notice.vars.category, 'takeaway');
    assert.deepEqual([notice.evidence.week, notice.evidence.usual], [7_500, 5_000]);
  });

  test('only the highest-priority notice is returned', () => {
    const d = base();
    earmark(d, 50_000);
    withCash(d, 180_000);
    d.transactions.push(tx('out', 9_000, '2026-10-22', { category: 'outings' }));
    assert.equal(spendingNotices(d, '2026-10-27').id, 'earmarkUsed');
  });

  test('"Got it" hides a notice for today only; a higher-priority one still shows', () => {
    const d = base();
    earmark(d, 50_000);
    withCash(d, 201_000);
    d.noticeDismissed = { id: 'protectSaving', date: TODAY };
    assert.equal(spendingNotices(d, TODAY), null);
    assert.equal(spendingNotices(d, '2026-10-25').id, 'protectSaving', 'back the next day');
    d.transactions.push(tx('out', 2_000, TODAY, { category: 'fun' })); // now into the earmark
    assert.equal(spendingNotices(d, TODAY).id, 'earmarkUsed');
  });

  test('a want bill is the suggested action when there is one', () => {
    const d = base();
    earmark(d, 50_000);
    withCash(d, 201_000);
    d.bills.push({ id: 'gym', name: 'Gym', amount: 30_000, frequency: 'monthly', dueDay: 10, amountType: 'fixed', kind: 'want', lastPaidDue: null });
    const notice = spendingNotices(d, TODAY);
    assert.ok(notice);
    assert.deepEqual(notice.action, { kind: 'pauseWant', name: 'Gym', amount: 30_000 });
  });

  test('noticeDismissed is validated', () => {
    assert.deepEqual(normalize({ noticeDismissed: { id: 'monthEndSoon', date: TODAY } }, TODAY).noticeDismissed, { id: 'monthEndSoon', date: TODAY });
    for (const bad of [{ id: '<script>', date: TODAY }, { id: 'x', date: 'today' }, 'x', null]) {
      assert.equal(normalize({ noticeDismissed: bad }, TODAY).noticeDismissed, null);
    }
  });
});
