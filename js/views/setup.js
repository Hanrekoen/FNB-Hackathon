// Guided setup before Home: how you're paid, bills, safety net, a goal, then a summary. Each
// step is saved in the vault, so locking or reloading resumes it. Example data skips it all.

import { goalSaved } from '../core/budget.js';
import { EMERGENCY_STARTER } from '../core/buckets.js';
import { todayISO } from '../core/dates.js';
import { goalTarget } from '../core/goals.js';
import { SETUP_STEPS, billTotals, canLeaveBills, finishSetup, nextStep, prevStep, stepNumber } from '../core/setup.js';
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { billForm } from './budget.js';
import { loadExample } from './example.js';
import { incomeForm } from './profile.js';
import { goalForm } from './savings.js';
import { checkRow, field, formError, money, newId, pageTitle, select, showError, trashIcon } from './ui.js';

/** Moves to a step and puts focus on its heading, so screen readers announce it. */
const go = (ctx, step) => ctx.commit((d) => { d.setup.step = step; }, null, 'main h1');

function nav(ctx, step, { next = null, nextLabel = t('setup.next'), extra = [] } = {}) {
  return h('div', { class: 'row setup-nav' },
    step !== SETUP_STEPS[0] && h('button', { class: 'btn secondary', type: 'button', on: { click: () => go(ctx, prevStep(step)) } }, t('setup.back')),
    next && h('button', { class: 'btn', type: 'button', on: { click: next } }, nextLabel),
    extra);
}

function frame(step, title, lead, ...content) {
  return h('div', { class: 'stack setup' },
    h('p', { class: 'hint', text: t('setup.step', { n: stepNumber(step), total: SETUP_STEPS.length }) }),
    pageTitle(title, lead),
    content);
}

function welcome(ctx) {
  return frame('welcome', t('setup.title.welcome'), t('setup.lead.welcome'),
    h('section', { class: 'card' },
      h('button', { class: 'btn block', type: 'button', on: { click: () => go(ctx, 'pay') } }, t('setup.start'))),
    h('section', { class: 'card' },
      h('p', { text: t('setup.exploreHint') }),
      h('button', { class: 'btn secondary block', type: 'button', on: { click: () => loadExample(ctx) } }, t('setup.explore'))));
}

function pay(ctx) {
  return frame('pay', t('income.title'), t('income.lead'),
    incomeForm(ctx, {
      submitLabel: t('setup.next'),
      after: () => go(ctx, 'bills'),
      buttons: [
        h('button', { class: 'btn secondary', type: 'button', on: { click: () => go(ctx, 'welcome') } }, t('setup.back')),
        h('button', { class: 'btn secondary', type: 'button', on: { click: () => go(ctx, 'bills') } }, t('setup.skip')),
      ],
    }));
}

function bills(ctx, today) {
  const d = ctx.data;
  const totals = billTotals(d, today);
  const err = formError();
  const remove = (id) => ctx.commit((x) => { x.bills = x.bills.filter((b) => b.id !== id); });
  const next = () => (canLeaveBills(d) ? go(ctx, 'safety') : showError(err, t('setup.needBill')));
  return frame('bills', t('setup.title.bills'), t('setup.lead.bills'),
    d.bills.length > 0 && h('section', { class: 'card' },
      h('p', { class: 'big-fact', text: t('setup.total', { total: money(totals.total), essential: money(totals.essential), want: money(totals.want) }) }),
      h('ul', { class: 'plain' }, d.bills.map((b) => h('li', { class: 'row-between' },
        h('span', {}, b.name, ' ', h('span', { class: `tag ${b.kind === 'want' ? 'want' : 'essential'}`, text: t(b.kind === 'want' ? 'bills.tag.want' : 'bills.tag.essential') })),
        h('span', { class: 'row' }, h('strong', { text: money(b.amount) }),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('bills.delete', { name: b.name }), on: { click: () => remove(b.id) } }, trashIcon())))))),
    h('section', { class: 'card' }, h('h2', { text: t('bills.addTitle') }), billForm(ctx, today)),
    err,
    nav(ctx, 'bills', {
      next,
      extra: [h('button', { class: 'btn secondary', type: 'button', on: { click: () => go(ctx, 'safety') } }, t('setup.noBills'))],
    }));
}

function safety(ctx, today) {
  const d = ctx.data;
  // On by default: a safety net is the recommended start.
  const on = h('input', { type: 'checkbox', checked: true });
  const months = select(Array.from({ length: 12 }, (_, i) => i + 1).map((n) => [n, t(n === 6 ? 'em.monthsRecommended' : n === 1 ? 'em.monthOne' : 'em.monthsOption', { n })]), d.settings.emergencyMonths);
  const estimate = h('p', { class: 'hint' });
  const update = () => {
    const target = goalTarget({ ...d, settings: { ...d.settings, emergencyMonths: Number(months.value) } }, { kind: 'emergency' }, today);
    estimate.textContent = target === EMERGENCY_STARTER && !d.bills.length
      ? t('setup.estimateUnknown')
      : t('setup.estimate', { amount: money(target), months: months.value });
  };
  months.addEventListener('change', update);
  update();
  const next = () => ctx.commit((x) => {
    x.settings.emergencyMonths = Number(months.value);
    const existing = x.goals.find((g) => g.kind === 'emergency');
    if (on.checked && !existing) x.goals.push({ id: newId(), name: t('save.emergencyName'), target: EMERGENCY_STARTER, kind: 'emergency' });
    // Switching it off only removes a fund that has nothing in it yet.
    if (!on.checked && existing && goalSaved(x.transactions, existing.id) === 0) x.goals = x.goals.filter((g) => g !== existing);
    x.setup.step = nextStep('safety');
  }, null, 'main h1');
  return frame('safety', t('setup.title.safety'), t('setup.lead.safety'),
    h('section', { class: 'card' }, checkRow(on, t('setup.safetyOn')), field(t('em.monthsLabel'), months), estimate),
    nav(ctx, 'safety', { next }));
}

function goal(ctx) {
  const goals = ctx.data.goals.filter((g) => g.kind !== 'emergency');
  return frame('goal', t('setup.title.goal'), t('setup.lead.goal'),
    goals.length > 0 && h('p', { class: 'alert ok', text: t('setup.goalAdded', { goals: goals.map((g) => g.name).join(', ') }) }),
    h('section', { class: 'card' }, goalForm(ctx)),
    nav(ctx, 'goal', { next: () => go(ctx, 'summary'), nextLabel: goals.length ? t('setup.next') : t('setup.skip') }));
}

function summary(ctx) {
  const d = ctx.data;
  const goalName = d.goals.find((g) => g.kind !== 'emergency')?.name;
  const done = () => {
    location.hash = '#/home';
    ctx.commit((x) => finishSetup(x), null, 'main h1');
  };
  return frame('summary', t('setup.title.summary'), null,
    h('section', { class: 'card highlight' },
      h('p', { class: 'big-fact', text: goalName
        ? t('setup.summary', { pct: d.settings.savePercent, goal: goalName })
        : t('setup.summaryNoGoal', { pct: d.settings.savePercent }) })),
    nav(ctx, 'summary', { next: done, nextLabel: t('setup.go') }));
}

const STEPS = { welcome, pay, bills, safety, goal, summary };

export function render(ctx) {
  const step = STEPS[ctx.data.setup.step] ? ctx.data.setup.step : 'welcome';
  return STEPS[step](ctx, todayISO());
}
