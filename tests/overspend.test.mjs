import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { overspendOf, summarize } from '../js/core/budget.js';
import { allocate, applyAllocation, payBill } from '../js/core/buckets.js';
import { emptyData } from '../js/core/schema.js';

let n = 0;
const id = () => `id-${++n}`;
const TODAY = '2026-10-25';

/** R2 000 in, the split applied (rent R1 200 set aside), optionally with rent already paid. */
function month({ rentPaid }) {
  const d = emptyData('', TODAY);
  d.bills = [{ id: 'rent', name: 'Rent', amount: 120_000, frequency: 'monthly', dueDay: 28, amountType: 'fixed', lastPaidDue: null }];
  d.transactions.push({ id: 'pay', type: 'in', amount: 200_000, category: 'wages', note: '', date: TODAY });
  applyAllocation(d, allocate(d, 200_000, TODAY, 'pay'), TODAY, id);
  if (rentPaid) payBill(d, 'rent', '2026-10-28', 120_000, TODAY, id);
  return d;
}
const spend = (d, amount) => d.transactions.push({ id: id(), type: 'out', amount, category: 'clothing', note: '', date: TODAY });

describe('overspending', () => {
  test('nothing is overspent while free money is not negative', () => {
    assert.deepEqual(overspendOf({ cash: 50_000, needs: 20_000, earmarked: 5_000, free: 25_000 }), { overspent: 0, fromSaving: 0, fromNeeds: 0, behind: 0 });
    assert.equal(summarize(month({ rentPaid: true }), TODAY).overspend.overspent, 0);
  });

  test('the extra comes from saving first, then bill money, then money that is not there', () => {
    assert.deepEqual(overspendOf({ cash: 10_000, needs: 20_000, earmarked: 5_000, free: -15_000 }), { overspent: 15_000, fromSaving: 5_000, fromNeeds: 10_000, behind: 0 });
    assert.deepEqual(overspendOf({ cash: -3_000, needs: 0, earmarked: 5_000, free: -8_000 }), { overspent: 8_000, fromSaving: 5_000, fromNeeds: 0, behind: 3_000 });
  });

  test('bills already paid: spending R200 past free money shows R200 overspent, none of it bill money', () => {
    const d = month({ rentPaid: true });
    const { free, earmarked } = summarize(d, TODAY);
    spend(d, free + 20_000);
    const s = summarize(d, TODAY);
    assert.equal(s.overspend.overspent, 20_000);
    assert.equal(s.overspend.fromNeeds, 0);
    assert.equal(s.overspend.fromSaving, Math.min(earmarked, 20_000));
    assert.equal(s.overspend.behind, 20_000 - s.overspend.fromSaving);
    assert.equal(s.overspend.behind, Math.max(0, -s.cash));
  });

  test('bills not paid yet: spending past free money uses bill money but nobody is behind', () => {
    const d = month({ rentPaid: false });
    const { free, earmarked } = summarize(d, TODAY);
    spend(d, free + 30_000);
    const s = summarize(d, TODAY);
    assert.equal(s.overspend.overspent, 30_000);
    assert.equal(s.overspend.fromNeeds, 30_000 - Math.min(earmarked, 30_000));
    assert.equal(s.overspend.behind, 0);
  });
});
