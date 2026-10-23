import { cashAvailable, goalSaved, summarize } from '../core/budget.js';
import { todayISO } from '../core/dates.js';
import { parseAmount } from '../core/money.js';
import { h } from '../dom.js';
import { list, t } from '../i18n.js';
import {
  amountInput, bulletList, card, field, formError, money, newId, pageTitle, select, showError, stat,
} from './ui.js';

const PERCENTS = [0, 5, 10, 15, 20, 25, 30];
const STARTER_TARGET = 100_000; // R1 000

export function render(ctx) {
  const d = ctx.data;
  const cash = cashAvailable(d.transactions);
  const goals = d.goals.map((g) => ({ ...g, saved: goalSaved(d.transactions, g.id) }));
  const total = goals.reduce((a, g) => a + g.saved, 0);

  return h('div', { class: 'stack' },
    pageTitle(t('save.title'), t('save.lead')),
    h('div', { class: 'card stats' }, stat(t('save.total'), money(total), 'pos'), stat(t('save.cash'), money(cash))),
    ruleCard(ctx),
    goals.map((g) => goalCard(ctx, g, cash)),
    !goals.length && starterCard(ctx),
    newGoalCard(ctx),
    card(t('save.tipsTitle'), bulletList(list('tips.save'))));
}

function ruleCard(ctx) {
  const sel = select(PERCENTS.map((p) => [p, `${p}%`]), ctx.data.settings.savePercent, {
    id: 'save-pct',
    on: { change: () => ctx.commit((d) => { d.settings.savePercent = Number(sel.value); }, t('save.ruleSaved')) },
  });
  return card(t('save.ruleTitle'), h('p', { text: t('save.ruleBody') }), field(t('save.ruleLabel'), sel));
}

function goalCard(ctx, g, cash) {
  const hid = `goal-${g.id}`;
  const amount = amountInput({ id: `amt-${g.id}` });
  const err = formError();
  const pct = Math.min(100, Math.floor((g.saved * 100) / g.target));

  async function move(kind) {
    const cents = parseAmount(amount.value);
    if (!cents) return showError(err, t('err.amount'), amount);
    if (kind === 'save' && cents > cash) return showError(err, t('err.notEnoughCash', { amount: money(Math.max(0, cash)) }), amount);
    if (kind === 'withdraw' && cents > g.saved) return showError(err, t('err.notEnoughSaved', { amount: money(g.saved) }), amount);
    await ctx.commit((d) => {
      d.transactions.push({ id: newId(), type: kind, amount: cents, goalId: g.id, category: kind, note: '', date: todayISO() });
    }, t(kind === 'save' ? 'save.added' : 'save.withdrawn', { goal: g.name }));
  }

  async function remove() {
    const msg = g.saved > 0 ? t('save.confirmDeleteMoney', { goal: g.name, amount: money(g.saved) }) : t('save.confirmDelete', { goal: g.name });
    if (!(await ctx.confirm(msg, { danger: true, ok: t('action.delete') }))) return;
    ctx.commit((d) => {
      if (g.saved > 0) d.transactions.push({ id: newId(), type: 'withdraw', amount: g.saved, goalId: g.id, category: 'withdraw', note: g.name, date: todayISO() });
      d.goals = d.goals.filter((x) => x.id !== g.id);
    }, t('save.deleted'));
  }

  return h('form', { class: 'card goal', novalidate: true, 'aria-labelledby': hid, on: { submit: (e) => { e.preventDefault(); move('save'); } } },
    h('div', { class: 'row-between' },
      h('h2', { id: hid, text: g.name }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('save.delete', { goal: g.name }), on: { click: remove } },
        h('span', { 'aria-hidden': 'true', text: '🗑️' }))),
    h('progress', { max: g.target, value: Math.min(g.saved, g.target), 'aria-label': t('save.progress', { pct }) }),
    h('p', { text: t('save.ofTarget', { saved: money(g.saved), target: money(g.target), pct }) }),
    g.saved >= g.target && h('p', { class: 'alert ok', text: t('save.reached') }),
    field(t('save.amount'), amount),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'submit' }, t('save.add')),
      g.saved > 0 && h('button', { class: 'btn secondary', type: 'button', on: { click: () => move('withdraw') } }, t('save.withdraw'))));
}

function starterCard(ctx) {
  const s = summarize(ctx.data, todayISO());
  const target = Math.max(STARTER_TARGET, s.billsTotal);
  const start = () => ctx.commit((d) => { d.goals.push({ id: newId(), name: t('save.emergencyName'), target }); }, t('save.created'));
  return h('section', { class: 'card highlight' },
    h('h2', { text: t('save.starterTitle') }),
    h('p', { text: t('save.starterBody', { amount: money(target) }) }),
    h('button', { class: 'btn', type: 'button', on: { click: start } }, t('save.starterBtn')));
}

function newGoalCard(ctx) {
  const name = h('input', { type: 'text', id: 'goal-name', maxlength: 40, autocomplete: 'off' });
  const target = amountInput({ id: 'goal-target' });
  const err = formError();

  async function onSubmit(e) {
    e.preventDefault();
    const n = name.value.trim();
    const cents = parseAmount(target.value);
    if (!n) return showError(err, t('err.name'), name);
    if (!cents) return showError(err, t('err.amount'), target);
    await ctx.commit((d) => { d.goals.push({ id: newId(), name: n.slice(0, 40), target: cents }); }, t('save.created'));
  }

  return h('section', { class: 'card' },
    h('details', {},
      h('summary', { text: t('save.newTitle') }),
      h('form', { novalidate: true, on: { submit: onSubmit } },
        field(t('save.goalName'), name, t('save.goalNameHint')),
        field(t('save.goalTarget'), target),
        err,
        h('button', { class: 'btn', type: 'submit' }, t('save.create')))));
}
