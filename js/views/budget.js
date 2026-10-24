// "Money" tab: record money in/out, expected income date, bills, monthly overview, history.

import { billNextDue, cashAvailable, monthTotals, spendingByCategory, summarize } from '../core/budget.js';
import { NOTICE_DAYS, allocate, applyAllocation, payBill } from '../core/buckets.js';
import { IN_CATS, OUT_CATS } from '../core/categories.js';
import { daysBetween, isISODate, todayISO } from '../core/dates.js';
import { variableEstimate } from '../core/forecast.js';
import { centsToInput, parseAmount, parseOptionalAmount } from '../core/money.js';
import { paymentNeedsCheck } from '../core/scam-advice.js';
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { profileSummary } from './profile.js';
import {
  amountInput, checkRow, confirmConsequence, daysText, field, fmtDate, formError, money, newId, pageTitle, select, showError, sortTx, stat, txList,
  trashIcon, weekdayName,
} from './ui.js';

const HISTORY_LIMIT = 100;
const FREQUENCIES = ['monthly', 'weekly', 'once'];
const KINDS = ['essential', 'want'];

export function render(ctx, [preset]) {
  const today = todayISO();
  const alloc = ctx.flash.alloc;
  delete ctx.flash.alloc;

  return h('div', { class: 'stack' },
    pageTitle(t('money.title'), t('money.lead')),
    alloc && allocationCard(ctx, alloc, today),
    addForm(ctx, preset === 'in' ? 'in' : 'out'),
    nextIncomeCard(ctx, summarize(ctx.data, today), today),
    billsCard(ctx, today),
    monthCard(ctx.data, today),
    historyCard(ctx));
}

function addForm(ctx, initialType) {
  let type = initialType;
  const err = formError();
  const amount = amountInput({ id: 'tx-amount' });
  const cat = h('select', { id: 'tx-cat' });
  const date = h('input', { id: 'tx-date', type: 'date', value: todayISO(), max: todayISO() });
  const note = h('input', { id: 'tx-note', type: 'text', maxlength: 80, autocomplete: 'off' });
  const submit = h('button', { class: 'btn', type: 'submit' });
  const sync = () => {
    cat.replaceChildren(...(type === 'in' ? IN_CATS : OUT_CATS).map((c) => h('option', { value: c }, t(`cat.${c}`))));
    submit.textContent = t(type === 'in' ? 'money.addIn' : 'money.addOut');
  };
  sync();

  const radios = ['out', 'in'].map((v) => h('label', { class: 'seg-opt' },
    h('input', { type: 'radio', name: 'tx-type', value: v, checked: v === type, on: { change: () => { type = v; sync(); } } }),
    h('span', { text: t(`money.type.${v}`) })));

  async function onSubmit(e) {
    e.preventDefault();
    const cents = parseAmount(amount.value);
    if (!cents) return showError(err, t('err.amount'), amount);
    if (!isISODate(date.value) || date.value > todayISO()) return showError(err, t('err.date'), date);
    const categories = type === 'in' ? IN_CATS : OUT_CATS;
    if (!categories.includes(cat.value)) return showError(err, t('err.category'), cat);
    // Big or unusual payments are often the end of a scam: offer a check before saving.
    // Needs come first: say plainly which bills this would leave short before it's saved.
    if (type === 'out' && !(await confirmConsequence(ctx, cents))) return;
    if (type === 'out' && paymentNeedsCheck(cents, cat.value, cashAvailable(ctx.data.transactions))) {
      const choice = await ctx.choose(t('pay.checkBody', { amount: money(cents) }), [
        { value: 'scams', label: t('pay.checkFirst'), secondary: true },
        { value: 'save', label: t('pay.saveAnyway') },
      ]);
      if (choice === 'scams') location.hash = '#/scams';
      if (choice !== 'save') return;
    }
    const tx = { id: newId(), type, amount: cents, category: cat.value, note: note.value.trim().slice(0, 80), date: date.value };
    await ctx.commit((d) => {
      d.transactions.push(tx);
      // Plan the new money against the next income as it looks *after* this payment.
      if (type === 'in') ctx.flash.alloc = allocate(d, cents, todayISO(), tx.id);
    }, t(type === 'in' ? 'money.addedIn' : 'money.addedOut'), type === 'in' ? '#alloc' : null);
  }

  return h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'add-h', on: { submit: onSubmit } },
    h('h2', { id: 'add-h', text: t('money.addTitle') }),
    h('fieldset', { class: 'seg' }, h('legend', { class: 'sr-only', text: t('money.type') }), radios),
    field(t('money.amount'), amount),
    field(t('money.category'), cat),
    field(t('money.date'), date),
    field(t('money.note'), note, t('money.noteHint')),
    err,
    submit);
}

/** What the plan would leave per day, worked out on a copy so nothing is saved until Apply. */
function perDayAfter(data, alloc, today) {
  const copy = structuredClone(data);
  applyAllocation(copy, alloc, today, '', () => 'preview');
  return summarize(copy, today);
}

function allocationCard(ctx, alloc, today) {
  const after = perDayAfter(ctx.data, alloc, today);
  const billNames = [...new Set(alloc.bills.map((b) => b.name))].join(', ');
  const row = (label, amount, cls) => h('li', { class: 'row-between' },
    h('span', {}, h('span', { class: `swatch seg-${cls}`, 'aria-hidden': 'true' }), label),
    h('strong', { text: money(amount) }));
  const apply = (plan) => ctx.commit(
    (d) => applyAllocation(d, plan, today, t('save.emergencyName'), newId),
    t('alloc.applied', { amount: money(plan.needs) }),
  );

  const needsIn = amountInput({ id: 'alloc-needs', value: centsToInput(alloc.needs) });
  const safetyIn = amountInput({ id: 'alloc-safety', value: centsToInput(alloc.safety) });
  const goalIns = alloc.goals.map((g) => [g, amountInput({ value: centsToInput(g.amount) })]);
  const err = formError();
  function onAdjust(e) {
    e.preventDefault();
    const parsed = [[needsIn, parseOptionalAmount(needsIn.value)], [safetyIn, parseOptionalAmount(safetyIn.value)],
      ...goalIns.map(([, input]) => [input, parseOptionalAmount(input.value)])];
    const bad = parsed.find(([, v]) => v === null);
    if (bad) return showError(err, t('err.amount'), bad[0]);
    const [needs, safety, ...goalAmounts] = parsed.map(([, v]) => v);
    if (needs + safety + goalAmounts.reduce((a, b) => a + b, 0) > alloc.amount) {
      return showError(err, t('err.allocTooMuch', { amount: money(alloc.amount) }), safetyIn);
    }
    apply({ ...alloc, needs, safety, goals: goalIns.map(([g], i) => ({ ...g, amount: goalAmounts[i] })) });
  }

  return h('section', { class: 'card highlight', id: 'alloc', tabindex: -1, 'aria-labelledby': 'alloc-h' },
    h('h2', { id: 'alloc-h', text: t('split.title') }),
    h('p', { text: t('alloc.lead', { amount: money(alloc.amount) }) }),
    h('ul', { class: 'plain' },
      row(t('split.bills'), alloc.needs, 'needs'),
      alloc.needs > 0 && billNames && h('li', { class: 'hint', text: t('alloc.billsFor', { bills: billNames }) }),
      row(t('split.save', { pct: alloc.pct }), alloc.safety, 'safety'),
      alloc.goals.map((g) => row(t('alloc.goal', { goal: g.name }), g.amount, 'safety')),
      row(t('split.spend'), alloc.free, 'free')),
    h('p', { class: 'big-fact', text: t('alloc.perDay', { amount: money(after.perDay), n: after.daysLeft }) }),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', on: { click: () => apply(alloc) } }, t('alloc.apply'))),
    h('details', {},
      h('summary', { text: t('alloc.adjust') }),
      h('form', { novalidate: true, on: { submit: onAdjust } },
        field(t('split.bills'), needsIn),
        field(t('alloc.safetyLabel'), safetyIn),
        goalIns.map(([g, input]) => field(t('alloc.goal', { goal: g.name }), input)),
        err,
        h('button', { class: 'btn secondary', type: 'submit' }, t('alloc.applyAdjusted')))),
    h('p', { class: 'hint', text: t('alloc.hint', { n: NOTICE_DAYS }) }));
}

function nextIncomeCard(ctx, s, today) {
  const input = h('input', { type: 'date', id: 'next-date', min: today, value: ctx.data.nextIncome ?? '' });
  const err = formError();
  const status = {
    user: () => t('next.user', { date: fmtDate(s.next.date) }),
    payday: () => t('next.payday', { date: fmtDate(s.next.date) }),
    estimate: () => t('next.estimate', { date: fmtDate(s.next.date), gap: s.next.gap }),
    late: () => t('next.late', { gap: s.next.gap }),
    default: () => t('next.unknown'),
  }[s.next.source]();

  async function onSubmit(e) {
    e.preventDefault();
    if (!isISODate(input.value) || input.value < today) return showError(err, t('err.futureDate'), input);
    await ctx.commit((d) => { d.nextIncome = input.value; }, t('next.saved'));
  }

  return h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'next-h', on: { submit: onSubmit } },
    h('h2', { id: 'next-h', text: t('next.title') }),
    h('p', { text: status }),
    h('p', { class: 'row-between' },
      h('span', { text: profileSummary(ctx.data.income) }),
      h('a', { class: 'link', href: '#/profile' }, t('income.change'))),
    field(t('next.label'), input, t('next.hint')),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'submit' }, t('action.save')),
      ctx.data.nextIncome && h('button', {
        class: 'btn secondary', type: 'button', on: { click: () => ctx.commit((d) => { d.nextIncome = null; }, t('next.cleared')) },
      }, t('next.clear'))));
}

function billsCard(ctx, today) {
  const bills = ctx.data.bills
    .map((b) => ({ ...b, due: billNextDue(b, today), estimate: b.amountType === 'varies' ? variableEstimate(b, ctx.data.transactions, today) : null }))
    .sort((a, b) => a.due.localeCompare(b.due));

  return h('section', { class: 'card', 'aria-labelledby': 'bills-h' },
    h('h2', { id: 'bills-h', text: t('bills.title') }),
    h('p', { class: 'hint', text: t('bills.lead') }),
    bills.length ? h('ul', { class: 'plain' }, bills.map((b) => billRow(ctx, b, today))) : h('p', { text: t('bills.none') }),
    h('details', { open: !bills.length },
      h('summary', { text: t('bills.addTitle') }),
      billForm(ctx, today)));
}

function billForm(ctx, today) {
  const name = h('input', { type: 'text', id: 'bill-name', maxlength: 40, autocomplete: 'off' });
  const amount = amountInput({ id: 'bill-amount' });
  const freq = select(FREQUENCIES.map((f) => [f, t(`bills.freq.${f}`)]), 'monthly', { id: 'bill-freq' });
  const kind = select(KINDS.map((k) => [k, t(`bills.kind.${k}`)]), 'essential', { id: 'bill-kind' });
  const day = h('input', { type: 'number', id: 'bill-day', min: 1, max: 31, inputmode: 'numeric' });
  const weekday = select([1, 2, 3, 4, 5, 6, 0].map((n) => [n, weekdayName(n)]), 1, { id: 'bill-weekday' });
  const date = h('input', { type: 'date', id: 'bill-date', min: today });
  const varies = h('input', { type: 'checkbox', id: 'bill-varies' });
  const linked = select(OUT_CATS.map((c) => [c, t(`cat.${c}`)]), 'transport', { id: 'bill-cat' });
  const err = formError();

  const dayField = field(t('bills.day'), day, t('bills.dayHint'));
  const weekdayField = field(t('bills.weekday'), weekday);
  const dateField = field(t('bills.date'), date);
  const variesRow = checkRow(varies, t('bills.varies'));
  const linkedField = field(t('bills.linked'), linked, t('bills.linkedHint'));
  const sync = () => {
    dayField.hidden = freq.value !== 'monthly';
    weekdayField.hidden = freq.value !== 'weekly';
    dateField.hidden = freq.value !== 'once';
    variesRow.hidden = freq.value === 'once';
    linkedField.hidden = freq.value === 'once' || !varies.checked;
  };
  freq.addEventListener('change', sync);
  varies.addEventListener('change', sync);
  sync();

  async function onAdd(e) {
    e.preventDefault();
    const n = name.value.trim();
    const cents = parseAmount(amount.value);
    if (!n) return showError(err, t('err.name'), name);
    if (!cents) return showError(err, t('err.amount'), amount);
    if (!KINDS.includes(kind.value)) return showError(err, t('err.category'), kind);
    const bill = { id: newId(), name: n.slice(0, 40), amount: cents, frequency: freq.value, amountType: 'fixed', kind: kind.value, lastPaidDue: null };
    if (bill.frequency === 'monthly') {
      const dueDay = Number(day.value);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return showError(err, t('err.day'), day);
      bill.dueDay = dueDay;
    } else if (bill.frequency === 'weekly') {
      bill.weekday = Number(weekday.value);
    } else {
      if (!isISODate(date.value) || date.value < today) return showError(err, t('err.futureDate'), date);
      bill.dueDate = date.value;
    }
    if (bill.frequency !== 'once' && varies.checked) {
      if (!OUT_CATS.includes(linked.value)) return showError(err, t('err.category'), linked);
      bill.amountType = 'varies';
      bill.linkedCategory = linked.value;
    }
    await ctx.commit((d) => { d.bills.push(bill); }, t('bills.added'));
  }

  return h('form', { novalidate: true, on: { submit: onAdd } },
    field(t('bills.name'), name, t('bills.nameHint')),
    field(t('bills.amount'), amount, t('bills.amountHint')),
    field(t('bills.kindLabel'), kind, t('bills.kindHint')),
    field(t('bills.frequency'), freq),
    dayField,
    weekdayField,
    dateField,
    variesRow,
    linkedField,
    err,
    h('button', { class: 'btn', type: 'submit' }, t('bills.add')));
}

function billSchedule(b) {
  if (b.frequency === 'weekly') return t('bills.everyWeek', { day: weekdayName(b.weekday) });
  if (b.frequency === 'once') return t('bills.once');
  return t('bills.everyMonth');
}

function billRow(ctx, b, today) {
  const planned = b.estimate?.amount ?? b.amount;
  const amountText = b.estimate?.estimated ? t('bills.about', { amount: money(planned) }) : money(planned);
  const overdue = b.due < today;
  const when = overdue ? t('bills.overdue') : daysText(daysBetween(today, b.due));
  const paidAmount = b.amountType === 'varies' ? amountInput({ value: centsToInput(planned), 'aria-label': t('bills.paidAmount', { name: b.name }) }) : null;
  const err = formError();

  const pay = () => {
    const cents = paidAmount ? parseAmount(paidAmount.value) : b.amount;
    if (!cents) return showError(err, t('err.amount'), paidAmount);
    ctx.commit((d) => payBill(d, b.id, b.due, cents, today, newId), t('bills.paidMsg', { name: b.name }));
  };

  const remove = async () => {
    if (await ctx.confirm(t('bills.confirmDelete', { name: b.name }), { danger: true, ok: t('action.delete') })) {
      ctx.commit((d) => { d.bills = d.bills.filter((x) => x.id !== b.id); }, t('bills.deleted'));
    }
  };

  return h('li', { class: 'bill' },
    h('div', { class: 'bill-main' },
      h('strong', {}, b.name, ' ', h('span', { class: `tag ${b.kind === 'want' ? 'want' : 'essential'}`, text: t(b.kind === 'want' ? 'bills.tag.want' : 'bills.tag.essential') })),
      h('span', { class: 'tx-meta', text: `${amountText} · ${billSchedule(b)}` }),
      h('span', { class: `tx-meta ${overdue ? 'neg' : ''}`, text: t('bills.due', { date: fmtDate(b.due), when }) }),
      b.estimate?.estimated && h('span', { class: 'tx-meta', text: t('bills.estimateBasis', { n: b.estimate.count }) })),
    h('div', { class: 'row' },
      paidAmount && h('div', { class: 'pay-amount' }, paidAmount),
      h('button', { type: 'button', class: 'btn small', 'aria-label': t('bills.paidLabel', { name: b.name }), on: { click: pay } }, t('bills.paid')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('bills.delete', { name: b.name }), on: { click: remove } },
        trashIcon())),
    err);
}

function monthCard(d, today) {
  const month = today.slice(0, 7);
  const { income, spent } = monthTotals(d.transactions, month);
  const cats = spendingByCategory(d.transactions, month);
  return h('section', { class: 'card', 'aria-labelledby': 'month-h' },
    h('h2', { id: 'month-h', text: t('month.title') }),
    h('div', { class: 'stats' }, stat(t('month.in'), money(income), 'pos'), stat(t('month.out'), money(spent), 'neg')),
    cats.length
      ? h('ul', { class: 'plain bars' }, cats.map((c) => h('li', {},
        h('div', { class: 'row-between' }, h('span', { text: t(`cat.${c.category}`) }), h('span', { text: money(c.amount) })),
        h('progress', { max: spent, value: c.amount, 'aria-label': `${t(`cat.${c.category}`)} ${Math.round((c.amount / spent) * 100)}%` }))))
      : h('p', { class: 'hint', text: t('month.empty') }));
}

function historyCard(ctx) {
  const txs = sortTx(ctx.data.transactions);
  if (!txs.length) return null;
  return h('section', { class: 'card' },
    h('details', {},
      h('summary', { text: t('history.title', { n: txs.length }) }),
      txList(ctx, txs.slice(0, HISTORY_LIMIT), true),
      txs.length > HISTORY_LIMIT && h('p', { class: 'hint', text: t('history.more', { n: HISTORY_LIMIT }) })));
}
