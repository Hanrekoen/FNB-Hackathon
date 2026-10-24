import { cashAvailable, goalSaved, needsBalance, summarize } from '../core/budget.js';
import {
  DAY_MS, EMERGENCY_STARTER, NOTICE_DAYS, cancelRelease, checkRelease, needsAvailable, pendingReleases, releaseWarning, requestRelease,
  safetyConsequence, setAside,
} from '../core/buckets.js';
import { todayISO } from '../core/dates.js';
import { parseAmount } from '../core/money.js';
import { SAVE_PERCENTS } from '../core/schema.js';
import { h } from '../dom.js';
import { list, t } from '../i18n.js';
import {
  amountInput, bucketBar, bulletList, card, field, fmtDate, fmtDateTime, formError, money, newId, pageTitle, select, showError, stat,
} from './ui.js';

export function render(ctx) {
  const d = ctx.data;
  const today = todayISO();
  const s = summarize(d, today);
  const cash = cashAvailable(d.transactions);
  const goals = d.goals.map((g) => ({ ...g, saved: goalSaved(d.transactions, g.id) }));

  return h('div', { class: 'stack' },
    pageTitle(t('save.title'), t('save.lead')),
    h('section', { class: 'card' }, bucketBar(s)),
    needsCard(ctx, s, today),
    h('div', { class: 'card stats' }, stat(t('save.total'), money(s.safety), 'pos'), stat(t('save.cash'), money(cash))),
    ruleCard(ctx),
    goals.map((g) => goalCard(ctx, g, cash, today)),
    !goals.length && starterCard(ctx, s),
    newGoalCard(ctx),
    card(t('save.tipsTitle'), bulletList(list('tips.save'))));
}

function needsCard(ctx, s, today) {
  const d = ctx.data;
  const pending = pendingReleases(d).sort((a, b) => a.availableAt - b.availableAt);
  const available = needsAvailable(d);
  const amount = amountInput({ id: 'needs-amount' });
  const reason = h('input', { type: 'text', id: 'needs-reason', maxlength: 80, autocomplete: 'off' });
  const err = formError();

  async function release() {
    const cents = parseAmount(amount.value);
    const problem = cents ? checkRelease(d, cents) : 'err.amount';
    if (problem) return showError(err, t(problem, { amount: money(available) }), amount);
    const now = Date.now();
    const warn = releaseWarning(d, cents, today, now);
    const message = [
      warn && t('needs.warn', { name: warn.bill.name, amount: money(warn.bill.planned), date: fmtDate(warn.bill.due), short: money(warn.short) }),
      t('needs.confirmRelease', { amount: money(cents), n: NOTICE_DAYS, date: fmtDateTime(now + NOTICE_DAYS * DAY_MS) }),
    ].filter(Boolean).join('\n\n');
    if (!(await ctx.confirm(message, { ok: t('needs.release'), danger: !!warn }))) return;
    ctx.commit((x) => { requestRelease(x, cents, reason.value.trim(), now, newId); }, t('needs.requested'));
  }

  async function add() {
    const cents = parseAmount(amount.value);
    if (!cents) return showError(err, t('err.amount'), amount);
    const room = Math.max(0, s.free);
    if (cents > room) return showError(err, t('err.notEnoughCash', { amount: money(room) }), amount);
    ctx.commit((x) => setAside(x, cents, today, newId), t('needs.added', { amount: money(cents) }));
  }

  const cancel = (r) => ctx.commit((x) => cancelRelease(x, r.id), t('needs.cancelled', { amount: money(r.amount) }));

  return h('section', { class: 'card needs', 'aria-labelledby': 'needs-h' },
    h('h2', { id: 'needs-h' }, h('span', { class: 'swatch seg-needs', 'aria-hidden': 'true' }), t('bucket.needs')),
    h('p', { class: 'big-fact', text: t('bucket.guarding', { amount: money(needsBalance(d.transactions)) }) }),
    h('p', { class: 'hint', text: t('needs.lead', { n: NOTICE_DAYS }) }),
    pending.length > 0 && h('ul', { class: 'plain' }, pending.map((r) => h('li', { class: 'bill' },
      h('div', { class: 'bill-main' },
        h('strong', { text: t('needs.pending', { amount: money(r.amount), date: fmtDateTime(r.availableAt) }) }),
        r.reason && h('span', { class: 'tx-meta', text: r.reason })),
      h('button', { class: 'btn small secondary', type: 'button', on: { click: () => cancel(r) } }, t('needs.cancel'))))),
    h('details', {},
      h('summary', { text: t('needs.manage') }),
      h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); add(); } } },
        field(t('save.amount'), amount, t('needs.available', { amount: money(available) })),
        field(t('needs.reason'), reason, t('needs.reasonHint')),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'submit' }, t('needs.add')),
          h('button', { class: 'btn secondary', type: 'button', on: { click: release } }, t('needs.release'))))));
}

function ruleCard(ctx) {
  const sel = select(SAVE_PERCENTS.map((p) => [p, `${p}%`]), ctx.data.settings.savePercent, {
    id: 'save-pct',
    on: { change: () => ctx.commit((d) => { d.settings.savePercent = Number(sel.value); }, t('save.ruleSaved')) },
  });
  return card(t('save.ruleTitle'), h('p', { text: t('save.ruleBody') }), field(t('save.ruleLabel'), sel));
}

/** Taking money out of Safety is allowed instantly, but only after seeing what it means. */
async function confirmWithdraw(ctx, amount, today) {
  const c = safetyConsequence(ctx.data, amount, today);
  const lines = [t('safety.consequence', { before: money(c.before), after: money(c.after) })];
  if (c.daysBefore !== null) lines.push(t('safety.days', { after: c.daysAfter, before: c.daysBefore }));
  lines.push(t('safety.sure'));
  return ctx.confirm(lines.join('\n\n'), { ok: t('safety.withdraw'), cancel: t('safety.keep') });
}

function goalCard(ctx, g, cash, today) {
  const hid = `goal-${g.id}`;
  const amount = amountInput({ id: `amt-${g.id}` });
  const err = formError();
  const pct = Math.min(100, Math.floor((g.saved * 100) / g.target));

  async function move(kind) {
    const cents = parseAmount(amount.value);
    if (!cents) return showError(err, t('err.amount'), amount);
    if (kind === 'save' && cents > cash) return showError(err, t('err.notEnoughCash', { amount: money(Math.max(0, cash)) }), amount);
    if (kind === 'withdraw' && cents > g.saved) return showError(err, t('err.notEnoughSaved', { amount: money(g.saved) }), amount);
    if (kind === 'withdraw' && !(await confirmWithdraw(ctx, cents, today))) return;
    await ctx.commit((d) => {
      d.transactions.push({ id: newId(), type: kind, amount: cents, goalId: g.id, category: kind, note: '', date: today });
    }, t(kind === 'save' ? 'save.added' : 'save.withdrawn', { goal: g.name }));
  }

  async function remove() {
    const msg = g.saved > 0 ? t('save.confirmDeleteMoney', { goal: g.name, amount: money(g.saved) }) : t('save.confirmDelete', { goal: g.name });
    if (!(await ctx.confirm(msg, { danger: true, ok: t('action.delete') }))) return;
    ctx.commit((d) => {
      if (g.saved > 0) d.transactions.push({ id: newId(), type: 'withdraw', amount: g.saved, goalId: g.id, category: 'withdraw', note: g.name, date: today });
      d.goals = d.goals.filter((x) => x.id !== g.id);
    }, t('save.deleted'));
  }

  return h('form', { class: 'card goal', novalidate: true, 'aria-labelledby': hid, on: { submit: (e) => { e.preventDefault(); move('save'); } } },
    h('div', { class: 'row-between' },
      h('h2', { id: hid }, h('span', { class: 'swatch seg-safety', 'aria-hidden': 'true' }), g.name),
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

function starterCard(ctx, s) {
  const target = Math.max(EMERGENCY_STARTER, s.billsTotal);
  const start = () => ctx.commit((d) => { d.goals.push({ id: newId(), name: t('save.emergencyName'), target, kind: 'emergency' }); }, t('save.created'));
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
    await ctx.commit((d) => { d.goals.push({ id: newId(), name: n.slice(0, 40), target: cents, kind: 'goal' }); }, t('save.created'));
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
