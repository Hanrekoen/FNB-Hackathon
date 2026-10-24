import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCAM_LOG_MAX, SCHEMA_VERSION, normalize } from '../js/core/schema.js';

const TODAY = '2026-10-24';

const v1 = {
  v: 1,
  profile: { name: 'Sipho' },
  settings: { savePercent: 15 },
  transactions: [
    { id: 'a', type: 'in', amount: 500_000, date: '2026-10-01', category: 'gig', note: 'Uber' },
    { id: 'b', type: 'out', amount: 120_000, date: '2026-10-02', category: 'bills', note: 'Rent', billId: 'rent' },
    { id: 'c', type: 'save', amount: 10_000, date: '2026-10-02', category: 'save', note: '', goalId: 'g' },
  ],
  bills: [{ id: 'rent', name: 'Rent', amount: 120_000, dueDay: 1, lastPaidDue: '2026-10-01' }],
  goals: [{ id: 'g', name: 'Emergency fund', target: 100_000 }],
  nextIncome: '2026-10-30',
  createdAt: '2026-09-01',
};

test('v1 data migrates to the current version without losing anything', () => {
  const d = normalize(structuredClone(v1), TODAY);
  assert.equal(d.v, SCHEMA_VERSION);
  assert.equal(d.profile.name, 'Sipho');
  assert.equal(d.settings.savePercent, 15);
  assert.deepEqual(d.transactions.map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(d.bills, [{ id: 'rent', name: 'Rent', amount: 120_000, frequency: 'monthly', amountType: 'fixed', kind: 'essential', lastPaidDue: '2026-10-01', dueDay: 1 }]);
  assert.equal(d.goals[0].kind, 'goal');
  assert.deepEqual(d.income, { pattern: 'varies', payDay: null, payWeekday: null, anchorDate: null, nudgeSnoozedUntil: null });
  assert.deepEqual(d.releases, []);
  assert.equal(d.demo, false);
  assert.equal(d.nextIncome, '2026-10-30');
  assert.equal(d.createdAt, '2026-09-01');
});

test('normalising v2 data is a no-op', () => {
  const once = normalize(structuredClone(v1), TODAY);
  assert.deepEqual(normalize(structuredClone(once), TODAY), once);
});

test('malformed fields are dropped or reset', () => {
  const d = normalize({
    ...structuredClone(v1),
    settings: { savePercent: 99 },
    income: { pattern: 'monthly', payDay: 40, payWeekday: 9, anchorDate: 'nope' },
    transactions: [
      { id: 'x', type: 'steal', amount: 100, date: '2026-10-01' },
      { id: 'y', type: 'needs', amount: 5_000, date: '2026-10-01' },
      { id: 'z', type: 'out', amount: 1_000, date: '2026-10-01', fromNeeds: 9_999 },
      { id: 'w', type: 'out', amount: -5, date: '2026-10-01' },
    ],
    bills: [
      { id: '1', name: 'Taxi', amount: 15_000, frequency: 'weekly' },
      { id: '2', name: 'Fuel', amount: 30_000, frequency: 'weekly', weekday: 1, amountType: 'varies' },
      { id: '3', name: 'Fee', amount: 25_000, frequency: 'once', dueDate: '2026-11-01', amountType: 'varies', linkedCategory: 'school' },
      { id: '4', name: 'Odd', amount: 1_000, frequency: 'yearly', dueDay: 5 },
    ],
    releases: [
      { id: 'r1', amount: 5_000, requestedAt: 1, availableAt: 2, status: 'pending', reason: 'x'.repeat(200) },
      { id: 'r2', amount: 5_000, requestedAt: 1, availableAt: 2, status: 'hacked' },
      { id: 'r3', amount: 0, requestedAt: 1, availableAt: 2, status: 'pending' },
    ],
    demo: 'yes',
  }, TODAY);
  assert.equal(d.settings.savePercent, 10);
  assert.deepEqual(d.income, { pattern: 'monthly', payDay: null, payWeekday: null, anchorDate: null, nudgeSnoozedUntil: null });
  assert.deepEqual(d.transactions.map((t) => t.id), ['y', 'z']);
  assert.ok(!('fromNeeds' in d.transactions[1]));
  assert.deepEqual(d.bills.map((b) => [b.id, b.frequency, b.amountType]), [['2', 'weekly', 'fixed'], ['3', 'once', 'fixed'], ['4', 'monthly', 'fixed']]);
  assert.deepEqual(d.releases.map((r) => r.id), ['r1']);
  assert.equal(d.releases[0].reason.length, 80);
  assert.equal(d.demo, false);
});

test('goals keep a valid deadline and plan; old goals without one still load', () => {
  const plan = { cuts: [{ category: 'fun', current: 40_000, cut: 12_000 }], perContribution: 65_000, acceptedAt: 1_700_000_000_000 };
  const d = normalize({
    goals: [
      { id: 'old', name: 'Shoes', target: 50_000 },
      { id: 'hol', name: 'Holiday', target: 300_000, by: '2026-12-15', plan },
      { id: 'past', name: 'Past', target: 10_000, by: '2020-01-01' },
      { id: 'bad', name: 'Bad', target: 10_000, by: '15/12/2026', plan },
      { id: 'em', name: 'Emergency', target: 100_000, kind: 'emergency', by: '2026-12-15' },
      { id: 'junk', name: 'Junk plan', target: 10_000, by: '2026-12-15', plan: { cuts: [{ category: 'rent', current: 1, cut: 1 }, { category: 'fun', cut: -1 }], perContribution: 5_000, acceptedAt: 1 } },
      { id: 'noplan', name: 'No plan', target: 10_000, by: '2026-12-15', plan: { cuts: [], perContribution: 0, acceptedAt: 1 } },
    ],
  }, TODAY);
  const byId = Object.fromEntries(d.goals.map((g) => [g.id, g]));
  assert.ok(!('by' in byId.old) && !('plan' in byId.old));
  assert.equal(byId.hol.by, '2026-12-15');
  assert.deepEqual(byId.hol.plan, plan);
  assert.equal(byId.past.by, '2020-01-01');
  assert.ok(!('by' in byId.bad) && !('plan' in byId.bad));
  assert.ok(!('by' in byId.em), 'the emergency fund never has a deadline');
  assert.deepEqual(byId.junk.plan.cuts, []);
  assert.ok(!('plan' in byId.noplan));
});

test('garbage input becomes empty data', () => {
  for (const bad of [null, 42, 'text', { transactions: 'nope', bills: [null, 1] }]) {
    const d = normalize(bad, TODAY);
    assert.equal(d.v, SCHEMA_VERSION);
    assert.deepEqual([d.transactions, d.bills, d.goals, d.releases], [[], [], [], []]);
  }
});

test('saved scam checks and income links are validated', () => {
  const ok = { id: 's1', date: '2026-10-20', level: 'high', matches: ['secret', 42], text: 'x'.repeat(900), wrong: 'yes' };
  const d = normalize({
    transactions: [
      { id: 'n', type: 'needs', amount: 100, date: TODAY, category: 'needs', fromIncome: 'pay' },
      { id: 'r', type: 'release', amount: 100, date: TODAY, category: 'release', correction: 'true', fromIncome: 7 },
    ],
    scamLog: [ok, { ...ok, level: 'scary' }, { ...ok, date: 'yesterday' }, { ...ok, text: null }, ...Array(40).fill(ok)],
  }, TODAY);
  assert.equal(d.transactions[0].fromIncome, 'pay');
  assert.ok(!('fromIncome' in d.transactions[1]));
  assert.ok(!('correction' in d.transactions[1]));
  assert.equal(d.scamLog.length, SCAM_LOG_MAX);
  assert.deepEqual(d.scamLog[0].matches, ['secret']);
  assert.equal(d.scamLog[0].text.length, 500);
  assert.equal(d.scamLog[0].wrong, false);
  assert.deepEqual(normalize({ v: 2 }, TODAY).scamLog, []);
});

test('bills are essential unless marked as a want', () => {
  const bill = (id, kind) => ({ id, name: id, amount: 1_000, frequency: 'monthly', dueDay: 1, kind });
  const d = normalize({ bills: [bill('a', 'want'), bill('b', 'essential'), bill('c', 'luxury'), bill('d')] }, TODAY);
  assert.deepEqual(d.bills.map((b) => b.kind), ['want', 'essential', 'essential', 'essential']);
  const plan = { cuts: [{ billId: 'a', name: 'Gym', current: 30_000, cut: 30_000 }, { category: 'rent', current: 1, cut: 1 }], perContribution: 5_000, acceptedAt: 1 };
  const goal = normalize({ goals: [{ id: 'g', name: 'G', target: 10_000, by: '2026-12-01', plan }] }, TODAY).goals[0];
  assert.deepEqual(goal.plan.cuts, [{ billId: 'a', name: 'Gym', current: 30_000, cut: 30_000 }]);
});
