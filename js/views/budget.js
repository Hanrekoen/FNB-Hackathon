// "Money" tab: record money in/out, expected income date, bills, monthly overview, history.

import { billNextDue, monthTotals, spendingByCategory, splitIncome, summarize } from '../core/budget.js';
import { IN_CATS, OUT_CATS } from '../core/categories.js';
import { daysBetween, isISODate, todayISO } from '../core/dates.js';
import { parseAmount } from '../core/money.js';
import { h } from '../dom.js';
import { t } from '../i18n.js';
import {
  amountInput, daysText, field, fmtDate, formError, money, newId, pageTitle, showError, sortTx, stat, txList,
} from './ui.js';

const HISTORY_LIMIT = 100;

export function render(ctx, [preset]) {
  const today = todayISO();
  const s = summarize(ctx.data, today);
  const split = ctx.flash.split;
  delete ctx.flash.split;

  return h('div', { class: 'stack' },
    pageTitle(t('money.title'), t('money.lead')),
    split && splitCard(split),
    addForm(ctx, preset === 'in' ? 'in' : 'out', s),
    nextIncomeCard(ctx, s, today),
    billsCard(ctx, today),
    monthCard(ctx.data, today),
    historyCard(ctx));
}

function addForm(ctx, initialType, s) {
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
    const tx = { id: newId(), type, amount: cents, category: cat.value, note: note.value.trim().slice(0, 80), date: date.value };
    if (type === 'in') ctx.flash.split = splitIncome(cents, ctx.data.settings.savePercent, s.shortfall);
    await ctx.commit((d) => { d.transactions.push(tx); }, t(type === 'in' ? 'money.addedIn' : 'money.addedOut'), type === 'in' ? '#split' : null);
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

function splitCard(sp) {
  const row = (label, amount) => h('li', { class: 'row-between' }, h('span', { text: label }), h('strong', { text: money(amount) }));
  return h('section', { class: 'card highlight', id: 'split', tabindex: -1, 'aria-labelledby': 'split-h' },
    h('h2', { id: 'split-h', text: t('split.title') }),
    h('ul', { class: 'plain' },
      sp.bills > 0 && row(t('split.bills'), sp.bills),
      sp.save > 0 && row(t('split.save', { pct: sp.pct }), sp.save),
      row(t('split.spend'), sp.spend)),
    h('p', { class: 'hint', text: t('split.hint') }),
    sp.save > 0 && h('a', { class: 'btn secondary', href: '#/save' }, t('split.go')));
}

function nextIncomeCard(ctx, s, today) {
  const input = h('input', { type: 'date', id: 'next-date', min: today, value: ctx.data.nextIncome ?? '' });
  const err = formError();
  const status = {
    user: () => t('next.user', { date: fmtDate(s.next.date) }),
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
    .map((b) => ({ ...b, due: billNextDue(b, today) }))
    .sort((a, b) => a.due.localeCompare(b.due));

  const name = h('input', { type: 'text', id: 'bill-name', maxlength: 40, autocomplete: 'off' });
  const amount = amountInput({ id: 'bill-amount' });
  const day = h('input', { type: 'number', id: 'bill-day', min: 1, max: 31, inputmode: 'numeric' });
  const err = formError();

  async function onAdd(e) {
    e.preventDefault();
    const n = name.value.trim();
    const cents = parseAmount(amount.value);
    const dueDay = Number(day.value);
    if (!n) return showError(err, t('err.name'), name);
    if (!cents) return showError(err, t('err.amount'), amount);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return showError(err, t('err.day'), day);
    await ctx.commit((d) => { d.bills.push({ id: newId(), name: n.slice(0, 40), amount: cents, dueDay, lastPaidDue: null }); }, t('bills.added'));
  }

  return h('section', { class: 'card', 'aria-labelledby': 'bills-h' },
    h('h2', { id: 'bills-h', text: t('bills.title') }),
    h('p', { class: 'hint', text: t('bills.lead') }),
    bills.length ? h('ul', { class: 'plain' }, bills.map((b) => billRow(ctx, b, today))) : h('p', { text: t('bills.none') }),
    h('details', { open: !bills.length },
      h('summary', { text: t('bills.addTitle') }),
      h('form', { novalidate: true, on: { submit: onAdd } },
        field(t('bills.name'), name, t('bills.nameHint')),
        field(t('money.amount'), amount),
        field(t('bills.day'), day, t('bills.dayHint')),
        err,
        h('button', { class: 'btn', type: 'submit' }, t('bills.add')))));
}

function billRow(ctx, b, today) {
  const pay = () => ctx.commit((d) => {
    const bill = d.bills.find((x) => x.id === b.id);
    if (bill) bill.lastPaidDue = b.due;
    d.transactions.push({ id: newId(), type: 'out', amount: b.amount, category: 'bills', note: b.name, date: today, billId: b.id });
  }, t('bills.paidMsg', { name: b.name }));

  const remove = async () => {
    if (await ctx.confirm(t('bills.confirmDelete', { name: b.name }), { danger: true, ok: t('action.delete') })) {
      ctx.commit((d) => { d.bills = d.bills.filter((x) => x.id !== b.id); }, t('bills.deleted'));
    }
  };

  return h('li', { class: 'bill' },
    h('div', { class: 'bill-main' },
      h('strong', { text: b.name }),
      h('span', { class: 'tx-meta', text: `${money(b.amount)} · ${t('bills.due', { date: fmtDate(b.due), when: daysText(daysBetween(today, b.due)) })}` })),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small', 'aria-label': t('bills.paidLabel', { name: b.name }), on: { click: pay } }, t('bills.paid')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('bills.delete', { name: b.name }), on: { click: remove } },
        h('span', { 'aria-hidden': 'true', text: '🗑️' }))));
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
