import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { allocate } from '../js/core/buckets.js';
import { CUTTABLE, ESSENTIAL } from '../js/core/categories.js';
import { assessMoney, cutBack, spendingConsequence } from '../js/core/coach.js';
import { addDays } from '../js/core/dates.js';
import { defaultIncome } from '../js/core/income.js';
import { emptyData } from '../js/core/schema.js';

const TODAY = '2026-10-24'; // a Saturday
let n = 0;
const tx = (type, amount, date, extra = {}) => ({ id: `t${++n}`, type, amount, date, category: 'other', note: '', ...extra });

/**
 * R1 000 every Tuesday since 1 Sep (careful income R4 000/month, next income Tue 27 Oct), rent
 * R1 500 due on the 26th and already set aside in Needs (as after tapping Apply), and R420 spent
 * in the last fortnight (R900/month): takeaway R200, outings R100, groceries R95, clothing R25.
 * Cash on hand R7 580. Most the cuts can find in a month: takeaway R100 + outings R50 + clothing R10.
 */
function base({ savePercent = 10, income = defaultIncome(), covered = true } = {}) {
  const d = emptyData('', '2026-09-01');
  d.settings.savePercent = savePercent;
  d.income = income;
  for (let date = '2026-09-01'; date <= TODAY; date = addDays(date, 7)) d.transactions.push(tx('in', 100_000, date, { category: 'wages' }));
  d.transactions.push(
    tx('out', 20_000, '2026-10-23', { category: 'takeaway' }),
    tx('out', 10_000, '2026-10-17', { category: 'outings' }),
    tx('out', 9_500, '2026-10-22', { category: 'food' }),
    tx('out', 2_500, '2026-10-21', { category: 'clothing' }),
  );
  if (covered) d.transactions.push(tx('needs', 150_000, '2026-10-20', { category: 'needs' }));
  d.bills = [{ id: 'rent', name: 'Rent', amount: 150_000, frequency: 'monthly', dueDay: 26, amountType: 'fixed', lastPaidDue: null }];
  d.goals = [{ id: 'em', name: 'Emergency fund', target: 100_000, kind: 'emergency' }];
  return d;
}

/** Leaves `cash` on hand by paying an older essential (outside the 14-day pace window). */
function withCash(d, cash) {
  d.transactions.push(tx('out', 758_000 - cash, '2026-10-01', { category: 'debt' }));
  return d;
}

const goal = (target, by, extra = {}) => ({ id: 'g', name: 'Holiday', target, kind: 'goal', by, ...extra });

describe('decision order: needs, then emergency fund, then goals', () => {
  test('nothing goes to saving while needs are uncovered', () => {
    const d = base({ covered: false });
    d.goals.push(goal(40_000, addDays(TODAY, 28)));
    d.transactions.push(tx('in', 100_000, TODAY, { category: 'gig' }));
    const a = allocate(d, 100_000, TODAY);
    assert.equal(a.needs, 100_000);
    assert.equal(a.earmarkEmergency, 0);
    assert.deepEqual(a.earmarkGoals, []);
  });

  test('the emergency earmark comes before goal earmarks, from what is left after bills', () => {
    const d = base({ covered: false });
    d.goals.push(goal(400_000, addDays(TODAY, 56), { plan: { cuts: [], perContribution: 10_000, acceptedAt: 1 } }));
    d.transactions.push(tx('in', 300_000, TODAY, { category: 'gig' }));
    const a = allocate(d, 300_000, TODAY);
    assert.equal(a.needs, 150_000);
    assert.equal(a.earmarkEmergency, 15_000); // 10% of the R1 500 left after bills
    // R433,34 a month for the goal; this income is three quarters of a careful month (R4 000)
    assert.deepEqual(a.earmarkGoals.map((g) => g.amount), [32_501]);
  });

  test('while bills are not covered, the emergency fund and goals wait: needs first', () => {
    const d = base({ covered: false });
    d.goals.push(goal(40_000, addDays(TODAY, 28)));
    const coach = assessMoney(d, TODAY);
    assert.equal(coach.emergency.canSave, false);
    assert.equal(coach.emergency.reason, 'needsFirst');
    assert.ok(coach.goals.every((g) => g.needsFirst));
  });
});

describe('peace of mind', () => {
  test('calm: bills covered for 30 days, with the earmark and months covered', () => {
    const d = base();
    d.earmarks.push({ id: 'e1', month: '2026-10', kind: 'emergency', amount: 30_000, incomeId: null });
    const p = assessMoney(d, TODAY).peace;
    assert.equal(p.status, 'calm');
    assert.equal(p.earmarked, 30_000);
    assert.deepEqual(p.actions, []);
  });

  test('act, not set aside: the money is there but a bill due before payday is not covered', () => {
    const p = assessMoney(base({ covered: false }), TODAY).peace;
    assert.deepEqual([p.status, p.reason, p.short, p.bill.name], ['act', 'notSetAside', 150_000, 'Rent']);
    assert.deepEqual(p.actions, [{ kind: 'setAside', amount: 150_000 }]);
  });

  test('act, short: names the bill and the amount short, with cuts sized to the days left', () => {
    const p = assessMoney(withCash(base(), 100_000), TODAY).peace;
    assert.deepEqual([p.status, p.reason], ['act', 'short']);
    assert.equal(p.short, 50_000);
    assert.deepEqual([p.bill.name, p.bill.due], ['Rent', '2026-10-26']);
    // 3 days left: a tenth of a month's takeaway (R20), cut by at most half
    assert.deepEqual(p.plan.cuts, [{ category: 'takeaway', current: 2_000, cut: 1_000, after: 1_000 }]);
    assert.equal(p.plan.covered, false);
  });

  test('watch: essential bills later in the 30 days still need money', () => {
    const d = base();
    d.bills.push({ id: 'school', name: 'School fees', amount: 50_000, frequency: 'monthly', dueDay: 10, amountType: 'fixed', lastPaidDue: null });
    const p = assessMoney(d, TODAY).peace;
    assert.deepEqual([p.status, p.reason, p.amount, p.horizon], ['watch', 'billsAhead', 50_000, '2026-11-23']);
  });

  test('watch: spending has eaten into the month-end earmark', () => {
    const d = withCash(base(), 160_000); // R100 above rent
    d.earmarks.push({ id: 'e1', month: '2026-10', kind: 'emergency', amount: 30_000, incomeId: null });
    const p = assessMoney(d, TODAY).peace;
    assert.deepEqual([p.status, p.reason, p.amount], ['watch', 'earmarkUsed', 20_000]);
  });
});

describe('emergency fund', () => {
  test('room to save: says how much and how many days it covers', () => {
    const e = assessMoney(base(), TODAY).emergency;
    assert.equal(e.canSave, true);
    assert.equal(e.monthly, 40_000);
    assert.equal(e.saved, 0);
  });

  test('NO because of spending: a reason, the impact in rand, and cuts that help', () => {
    const d = base();
    d.transactions.push(tx('out', 80_000, '2026-10-19', { category: 'food' })); // spending now R2 614 a month
    const e = assessMoney(d, TODAY).emergency;
    assert.equal(e.canSave, false);
    assert.equal(e.reason, 'noFreeMoney');
    assert.equal(e.impact.bill.name, 'Rent');
    assert.equal(e.impact.margin, 529_000); // R5 280 above rent, so a R5 290 surprise reaches rent money
    assert.deepEqual(e.plan.cuts.map((c) => c.category), ['takeaway', 'outings', 'clothing']);
    assert.equal(e.plan.covered, false);
  });

  test('a 0% savings rule is named as the reason, not a lack of money', () => {
    assert.equal(assessMoney(base({ savePercent: 0 }), TODAY).emergency.reason, 'noSavingsRule');
  });

  test('days of essentials covered', () => {
    const d = base();
    d.transactions.push(tx('save', 50_000, '2026-10-02', { goalId: 'em', category: 'save' }));
    assert.equal(assessMoney(d, TODAY).emergency.days, 10); // R500 / R50 a day of rent
  });
});

describe('goals', () => {
  const by = addDays(TODAY, 28); // 4 weekly contributions; R1 200 a month left for goals
  const planFor = (target, extra) => {
    const d = base();
    d.goals.push(goal(target, by, extra));
    return assessMoney(d, TODAY).goals[0].plan;
  };

  test('on track', () => assert.equal(planFor(80_000).status, 'onTrack'));

  test('stretch: not enough spendable money, closable with cuts to extras', () => {
    const p = planFor(120_000);
    assert.deepEqual([p.status, p.reason], ['stretch', 'notEnoughSpendable']);
    assert.deepEqual(p.cuts, [{ category: 'takeaway', current: 20_000, cut: 10_000, after: 10_000 }]);
  });

  test('unrealistic: not enough time, with a later date and a lower amount', () => {
    const p = planFor(200_000);
    assert.deepEqual([p.status, p.reason], ['unrealistic', 'notEnoughTime']);
    assert.ok(p.alternatives.earliestFeasibleDate > by);
    assert.ok(p.alternatives.maxAffordable > 0 && p.alternatives.maxAffordable < 200_000);
  });

  test('unknown with little history, but the amount is still shown', () => {
    const d = base();
    d.transactions = d.transactions.filter((t) => t.type !== 'in' || t.date >= '2026-10-13');
    d.goals.push(goal(80_000, by));
    const p = assessMoney(d, TODAY).goals[0].plan;
    assert.equal(p.status, 'unknown');
    assert.equal(p.perContribution, 20_000);
  });
});

describe('cuts', () => {
  test('essentials are never cut, even when they are the biggest spending', () => {
    const d = base();
    for (const category of ESSENTIAL) d.transactions.push(tx('out', 500_000, '2026-10-20', { category }));
    const { cuts } = cutBack(d, TODAY, 1_000_000);
    assert.ok(cuts.every((c) => c.category in CUTTABLE && !ESSENTIAL.includes(c.category)));
  });

  test('biggest first, capped, rounded to R10, and stops once covered', () => {
    const all = cutBack(base(), TODAY, 1_000_000);
    assert.deepEqual(all.cuts.map((c) => [c.category, c.cut]), [['takeaway', 10_000], ['outings', 5_000], ['clothing', 1_000]]);
    assert.equal(all.covered, false);
    for (const c of all.cuts) assert.ok(c.cut <= (c.current * CUTTABLE[c.category]) / 100);
    const some = cutBack(base(), TODAY, 10_500);
    assert.deepEqual(some.cuts.map((c) => [c.category, c.cut]), [['takeaway', 10_000], ['outings', 1_000]]);
    assert.equal(some.covered, true);
    assert.deepEqual(cutBack(base(), TODAY, 0), { cuts: [], total: 0, covered: true, gap: 0 });
  });
});

describe('consequences of money going out', () => {
  test('spending that reaches rent money names the bill and how short it would be', () => {
    const d = base();
    const c = spendingConsequence(d, 700_000, TODAY);
    assert.equal(c.fromBillMoney, 92_000);
    assert.deepEqual(c.affected, [{ name: 'Rent', due: '2026-10-26', planned: 150_000, short: 92_000 }]);
  });

  test('spending from free money has no consequence', () => {
    const c = spendingConsequence(base(), 100_000, TODAY);
    assert.equal(c.fromBillMoney, 0);
    assert.deepEqual(c.affected, []);
  });

  test('already short: reports the shortfall before and after', () => {
    const c = spendingConsequence(withCash(base(), 100_000), 10_000, TODAY);
    assert.deepEqual([c.shortBefore, c.shortAfter], [50_000, 60_000]);
  });
});

describe('edge cases', () => {
  test('zero income: needs come first and nothing is guessed', () => {
    const d = emptyData('', TODAY);
    d.bills = [{ id: 'rent', name: 'Rent', amount: 150_000, frequency: 'monthly', dueDay: 26, amountType: 'fixed', lastPaidDue: null }];
    const coach = assessMoney(d, TODAY);
    assert.equal(coach.history.enough, false);
    assert.equal(coach.peace.status, 'act');
    assert.equal(coach.emergency.reason, 'needsFirst');
  });

  test('a deadline today or past, and a goal already reached', () => {
    const d = base();
    d.goals.push(goal(40_000, TODAY), { id: 'done', name: 'Done', target: 10_000, kind: 'goal', by: addDays(TODAY, 30) });
    d.transactions.push(tx('save', 10_000, '2026-10-02', { goalId: 'done', category: 'save' }));
    const [due, done] = assessMoney(d, TODAY).goals.map((g) => g.plan.status);
    assert.deepEqual([due, done], ['pastDue', 'reached']);
  });

  test('every income pattern gives a verdict', () => {
    const patterns = {
      monthly: { pattern: 'monthly', payDay: 25 },
      biweekly: { pattern: 'biweekly', anchorDate: '2026-10-16' },
      weekly: { pattern: 'weekly', payWeekday: 2 },
      varies: {},
    };
    for (const [name, profile] of Object.entries(patterns)) {
      const d = base({ income: { ...defaultIncome(), ...profile } });
      d.goals.push(goal(80_000, addDays(TODAY, 56)));
      const coach = assessMoney(d, TODAY);
      assert.ok(['calm', 'watch', 'act'].includes(coach.peace.status), name);
      assert.ok(coach.peace.next >= TODAY, name);
      assert.equal(coach.goals[0].plan.unit, name === 'varies' ? 'week' : 'payday', name);
    }
  });
});

describe('essential bills and wants', () => {
  const want = (id, name, amount, dueDay = 5) => ({ id, name, amount, frequency: 'monthly', dueDay, amountType: 'fixed', kind: 'want', lastPaidDue: null });
  const withWants = () => {
    const d = base();
    d.bills.push(want('showmax', 'Showmax', 9_900), want('gym', 'Gym', 30_000));
    return d;
  };
  const named = (cuts) => cuts.map((c) => [c.name ?? c.category, c.cut]);

  test('wants come first, whole and largest first, stopping once the gap is covered', () => {
    assert.deepEqual(named(cutBack(withWants(), TODAY, 8_000).cuts), [['Gym', 30_000]]);
    assert.deepEqual(named(cutBack(withWants(), TODAY, 20_000).cuts), [['Gym', 30_000]]);
    assert.deepEqual(named(cutBack(withWants(), TODAY, 35_000).cuts), [['Gym', 30_000], ['Showmax', 9_900]]);
  });

  test('then everyday extras for the rest; essential bills are never suggested', () => {
    const d = withWants();
    d.bills.push({ id: 'school', name: 'School fees', amount: 900_000, frequency: 'monthly', dueDay: 2, amountType: 'fixed', kind: 'essential', lastPaidDue: null });
    const { cuts } = cutBack(d, TODAY, 50_000);
    assert.deepEqual(named(cuts), [['Gym', 30_000], ['Showmax', 9_900], ['takeaway', 10_000], ['outings', 1_000]]);
    assert.ok(!cuts.some((c) => c.name === 'Rent' || c.name === 'School fees'));
  });

  test('cancelling a want is not offered for the days before payday', () => {
    assert.ok(cutBack(withWants(), TODAY, 8_000, 0.1).cuts.every((c) => c.category));
  });

  test('a want bill left short is a suggestion to pause it, never an alarm', () => {
    const d = withCash(base(), 160_000); // rent R1 500 covered, R100 left
    d.bills.push(want('showmax', 'Showmax', 20_000, 26));
    const p = assessMoney(d, TODAY).peace;
    assert.notEqual(p.status, 'act');
    assert.deepEqual(p.actions[0], { kind: 'pauseWant', name: 'Showmax', amount: 20_000, due: '2026-10-26' });
  });

  test('when an essential is short, pausing a want due before payday is suggested first', () => {
    const d = withCash(base(), 100_000);
    d.bills.push(want('showmax', 'Showmax', 9_900, 26));
    const p = assessMoney(d, TODAY).peace;
    assert.equal(p.status, 'act');
    assert.equal(p.bill.name, 'Rent');
    assert.equal(p.actions[0].kind, 'pauseWant');
  });

  test('the spending check counts only essentials as short, and lists wants separately', () => {
    const d = base();
    d.bills.push(want('showmax', 'Showmax', 20_000, 26));
    const c = spendingConsequence(d, 600_000, TODAY); // leaves R1 580: rent covered, Showmax R120 short
    assert.deepEqual(c.affected, []);
    assert.deepEqual(c.wants.map((w) => [w.name, w.short]), [['Showmax', 12_000]]);
    assert.ok(c.fromBillMoney > 0);
  });
});
