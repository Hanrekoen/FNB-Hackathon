import { cashAvailable, goalSaved, needsBalance, summarize } from '../core/budget.js';
import {
  DAY_MS, EMERGENCY_STARTER, NOTICE_DAYS, cancelRelease, checkRelease, moveToGoal, needsAvailable, pendingReleases, releaseWarning, requestRelease,
  safetyConsequence, setAside,
} from '../core/buckets.js';
import { addDays, isISODate, todayISO } from '../core/dates.js';
import { assessMoney } from '../core/coach.js';
import { goalPlan, goalTarget } from '../core/goals.js';
import { parseAmount } from '../core/money.js';
import { SAVE_PERCENTS } from '../core/schema.js';
import { h } from '../dom.js';
import { list, t } from '../i18n.js';
import { icon } from '../icons.js';
import {
  amountInput, bucketBar, bulletList, card, confirmConsequence, field, fmtDate, fmtDateTime, formError, money, heading, newId, overspendNote, pageTitle, select, showError, stat, trashIcon,
} from './ui.js';

export function render(ctx) {
  const d = ctx.data;
  const today = todayISO();
  const s = summarize(d, today);
  const cash = cashAvailable(d.transactions);
  // The emergency fund's target is worked out live from essentials, not stored.
  const goals = d.goals.map((g) => ({ ...g, target: goalTarget(d, g, today), saved: goalSaved(d.transactions, g.id) }));
  const coach = assessMoney(d, today);

  return h('div', { class: 'stack' },
    pageTitle(t('save.title'), t('save.lead')),
    h('section', { class: 'card' }, bucketBar(s), overspendNote(s)),
    needsCard(ctx, s, today),
    h('div', { class: 'card stats' }, stat(t('save.total'), money(s.safety), 'pos'), stat(t('save.cash'), money(cash))),
    ruleCard(ctx),
    goals.map((g) => goalCard(ctx, g, cash, today, coach)),
    !goals.length && starterCard(ctx, s, coach.emergency),
    newGoalCard(ctx),
    card(['bulb', t('save.tipsTitle')], bulletList(list('tips.save'))));
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

/**
 * Taking money out of the emergency fund: allowed, but only after seeing how many months of
 * essentials it leaves, with the choice to move it into a savings goal instead of spending it.
 * Resolves to 'spend', a goal id, or '' to keep it.
 */
async function chooseEmergencyWithdraw(ctx, g, amount, today) {
  const c = safetyConsequence(ctx.data, amount, today);
  const lines = [
    c.monthsBefore !== null
      ? t('safety.monthsMove', { before: c.monthsBefore, after: c.monthsAfter })
      : t('safety.consequence', { before: money(c.before), after: money(c.after) }),
    t('safety.sure'),
  ];
  const others = ctx.data.goals.filter((x) => x.id !== g.id);
  const choice = await ctx.choose(lines.join('\n\n'), [
    { value: 'keep', label: t('safety.keep') },
    others.length > 0 && { value: 'goal', label: t('safety.toGoal'), secondary: true },
    { value: 'spend', label: t('safety.useSpend'), secondary: true },
  ].filter(Boolean));
  if (choice !== 'goal') return choice === 'spend' ? 'spend' : '';
  if (others.length === 1) return others[0].id;
  const pick = await ctx.choose(t('safety.whichGoal'), others.map((x) => ({ value: x.id, label: x.name, secondary: true })));
  return pick || '';
}

/** Taking money out of Safety is allowed instantly, but only after seeing what it means. */
async function confirmWithdraw(ctx, amount, today) {
  const c = safetyConsequence(ctx.data, amount, today);
  const lines = [t('safety.consequence', { before: money(c.before), after: money(c.after) })];
  if (c.daysBefore !== null) lines.push(t('safety.days', { after: c.daysAfter, before: c.daysBefore }));
  lines.push(t('safety.sure'));
  return ctx.confirm(lines.join('\n\n'), { ok: t('safety.withdraw'), cancel: t('safety.keep') });
}

function goalCard(ctx, g, cash, today, coach) {
  const hid = `goal-${g.id}`;
  const amount = amountInput({ id: `amt-${g.id}` });
  const err = formError();
  const pct = Math.min(100, Math.floor((g.saved * 100) / g.target));

  async function move(kind) {
    const cents = parseAmount(amount.value);
    if (!cents) return showError(err, t('err.amount'), amount);
    if (kind === 'save' && cents > cash) return showError(err, t('err.notEnoughCash', { amount: money(Math.max(0, cash)) }), amount);
    if (kind === 'withdraw' && cents > g.saved) return showError(err, t('err.notEnoughSaved', { amount: money(g.saved) }), amount);
    if (kind === 'withdraw' && g.kind === 'emergency') {
      const to = await chooseEmergencyWithdraw(ctx, g, cents, today);
      if (!to) return;
      if (to !== 'spend') {
        const goalName = ctx.data.goals.find((x) => x.id === to)?.name ?? '';
        return ctx.commit((d) => moveToGoal(d, g.id, to, cents, today, newId), t('safety.moved', { amount: money(cents), goal: goalName }));
      }
    } else if (kind === 'withdraw' && !(await confirmWithdraw(ctx, cents, today))) return;
    if (kind === 'save' && !(await confirmConsequence(ctx, cents, 'save'))) return;
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
        trashIcon())),
    h('progress', { max: g.target, value: Math.min(g.saved, g.target), 'aria-label': t('save.progress', { pct }) }),
    h('p', { text: t('save.ofTarget', { saved: money(g.saved), target: money(g.target), pct }) }),
    g.saved >= g.target && h('p', { class: 'alert ok with-icon' }, icon('party'), t('save.reached')),
    g.kind === 'emergency' && emergencyHeader(ctx, coach.emergency),
    g.kind === 'emergency' && emergencySection(coach.emergency),
    planSection(ctx, g, today, coach.peace.status === 'act'),
    dateEditor(ctx, g, today),
    field(t('save.amount'), amount),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'submit' }, t('save.add')),
      g.saved > 0 && h('button', { class: 'btn secondary', type: 'button', on: { click: () => move('withdraw') } }, t('save.withdraw'))));
}

const STATUS = {
  onTrack: ['ok', 'check'],
  stretch: ['warn', 'alert'],
  unrealistic: ['danger', 'stop'],
  unknown: ['neutral', 'info'],
  pastDue: ['warn', 'calendar'],
};

function cutList(cuts) {
  return h('ul', { class: 'bullets' }, cuts.map((c) => h('li', {
    text: c.billId
      ? t('goals.cutWant', { name: c.name, cut: money(c.cut) })
      : t('goals.cut', { cut: money(c.cut), category: t(`cat.${c.category}`), current: money(c.current) }),
  })));
}

/** The numbers behind a goal's status, so nothing is a black box. */
function howWeWorkedItOut(p) {
  const c = p.capacity;
  if (!c) return null;
  const rows = [
    ['goals.num.income', c.income],
    ['goals.num.essentials', c.essentials],
    ['goals.num.spending', c.spending],
    ['goals.num.emergency', c.emergency],
    ['goals.num.other', c.otherGoals],
    ['goals.num.left', c.available],
    p.monthlyNeed !== undefined && ['goals.num.need', p.monthlyNeed],
  ].filter(Boolean);
  return h('details', {},
    h('summary', { text: t('forecast.how') }),
    h('p', { class: 'hint', text: t('goals.num.lead') }),
    h('ul', { class: 'plain' }, rows.map(([key, amount]) => h('li', { text: t(key, { amount: money(amount) }) }))));
}

/** Per-payday amount, whether it fits, and ways to make it fit. Guidance only: the user decides. */
function planSection(ctx, g, today, needsFirst) {
  const p = goalPlan(ctx.data, g, today);
  if (!p || p.status === 'reached') return null;
  // Never push saving while bills aren't covered; show the amount, but no plan to accept.
  if (needsFirst) {
    return h('div', { class: 'goal-plan' },
      h('p', { class: 'goal-status warn' }, icon('alert'), t('coach.needsFirst')));
  }
  const change = (mutate, message) => ctx.commit((d) => {
    const goal = d.goals.find((x) => x.id === g.id);
    if (goal) mutate(goal);
  }, message);
  const usePlan = (cuts) => change((goal) => {
    goal.plan = { cuts, perContribution: p.perContribution, acceptedAt: Date.now() };
  }, t('goals.planSaved'));
  const usePlanBtn = (cuts) => !g.plan && h('button', { class: 'btn small', type: 'button', on: { click: () => usePlan(cuts) } }, t('goals.usePlan'));

  const alt = p.alternatives;
  const moveBtn = alt?.earliestFeasibleDate && h('button', {
    class: 'btn small secondary', type: 'button',
    on: { click: () => change((goal) => { goal.by = alt.earliestFeasibleDate; delete goal.plan; }, t('goals.dateMoved', { date: fmtDate(alt.earliestFeasibleDate) })) },
  }, t('goals.moveDate', { date: fmtDate(alt.earliestFeasibleDate) }));
  const lowerBtn = alt && p.status !== 'pastDue' && alt.maxAffordable > p.saved && h('button', {
    class: 'btn small secondary', type: 'button',
    on: { click: () => change((goal) => { goal.target = alt.maxAffordable; delete goal.plan; }, t('goals.lowered', { amount: money(alt.maxAffordable) })) },
  }, t('goals.lower', { amount: money(alt.maxAffordable) }));

  const [cls, iconName] = STATUS[p.status];
  const statusText = {
    onTrack: () => t('goals.onTrack'),
    stretch: () => t('goals.stretch', { gap: money(p.gap) }),
    unrealistic: () => (p.limitedBy === 'spending'
      ? t('goals.unrealistic', { need: money(p.monthlyNeed), left: money(Math.max(0, p.capacity.available)) })
      : t('goals.unrealisticIncome', { need: money(p.monthlyNeed) })),
    unknown: () => t('goals.unknown'),
    pastDue: () => t('goals.pastDue', { remaining: money(p.remaining) }),
  }[p.status]();
  const cutsTotal = (p.cuts ?? []).reduce((a, c) => a + c.cut, 0);
  const perKey = p.unit === 'week' ? 'goals.perWeek' : 'goals.perPayday';

  return h('div', { class: 'goal-plan' },
    p.perContribution !== undefined && h('p', {
      class: 'big-fact',
      text: t(perKey, { amount: money(p.perContribution), monthly: money(p.monthlyNeed), target: money(g.target), date: fmtDate(g.by) }),
    }),
    h('p', { class: `goal-status ${cls}` }, icon(iconName), statusText),
    p.status === 'stretch' && [cutList(p.cuts), h('p', { class: 'hint', text: t('goals.cutsTotal', { amount: money(cutsTotal) }) }), usePlanBtn(p.cuts)],
    p.status === 'unrealistic' && p.cuts.length > 0 && [
      h('h3', { text: t('goals.waysToSave') }),
      cutList(p.cuts),
      h('p', { class: 'hint', text: `${t('goals.cutsTotal', { amount: money(cutsTotal) })} ${t('goals.cutBackNote')}` }),
    ],
    p.status === 'unrealistic' && !alt.earliestFeasibleDate
      && h('p', { class: 'hint', text: t(p.capacity.otherGoals > 0 ? 'goals.noDateOtherGoals' : 'goals.noDate') }),
    (p.status === 'unrealistic' || p.status === 'pastDue') && h('div', { class: 'row' }, moveBtn, lowerBtn),
    g.plan && h('div', { class: 'goal-accepted' },
      heading('h3', ['target', t('goals.planTitle')]),
      h('p', { text: t(p.unit === 'week' ? 'goals.planPerWeek' : 'goals.planPerPayday', { amount: money(g.plan.perContribution) }) }),
      g.plan.cuts.length > 0 && cutList(g.plan.cuts),
      h('button', { class: 'btn small secondary', type: 'button', on: { click: () => change((goal) => { delete goal.plan; }, t('goals.planDropped')) } }, t('goals.dropPlan'))),
    howWeWorkedItOut(p));
}

/** Add, change or remove a goal's target date. The emergency fund never has one: it's for any time. */
function dateEditor(ctx, g, today) {
  if (g.kind === 'emergency') return null;
  const input = h('input', { type: 'date', min: addDays(today, 1), value: g.by ?? '' });
  const err = formError();
  const set = (by, message) => ctx.commit((d) => {
    const goal = d.goals.find((x) => x.id === g.id);
    if (!goal) return;
    if (by) goal.by = by;
    else delete goal.by;
    // A saved plan was worked out for the old date.
    delete goal.plan;
  }, message);
  const save = () => {
    if (!isISODate(input.value) || input.value <= today) return showError(err, t('err.goalDate'), input);
    set(input.value, t('goals.dateSaved', { date: fmtDate(input.value) }));
  };
  // The goal card is a form whose submit adds savings, so Enter here must save the date instead.
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  return h('details', { class: 'goal-date' },
    h('summary', {}, icon('calendar'), t(g.by ? 'goals.dateChange' : 'goals.dateAdd')),
    field(t('goals.dateLabel'), input, t('save.byWhenHint')),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', on: { click: save } }, t('goals.dateSave')),
      g.by && h('button', { class: 'btn small secondary', type: 'button', on: { click: () => set(null, t('goals.dateRemoved')) } }, t('goals.dateRemove'))));
}

/** What having no safety net would mean right now, in rand. */
function impactLine(e) {
  const impact = e?.impact;
  if (!impact) return null;
  const text = !impact.bill ? t('coach.em.impactLoan')
    : impact.margin === 0 ? t('coach.em.impactNow', { bill: impact.bill.name })
      : t('coach.em.impact', { amount: money(impact.margin), bill: impact.bill.name });
  return h('p', { class: 'hint', text });
}

const EMERGENCY_REASON = { noFreeMoney: 'coach.em.noFreeMoney', needsFirst: 'coach.em.needsFirst', noSavingsRule: 'coach.em.noSavingsRule' };

/**
 * How the automatic target is worked out, months covered on a bar with a 1-month marker, the
 * months choice, and this month's earmark waiting for month-end.
 */
function emergencyHeader(ctx, e) {
  const bar = h('div', { class: 'em-progress' },
    h('progress', { max: e.target, value: Math.min(e.saved, e.target), 'aria-label': t('em.monthsCovered', { n: e.monthsCovered ?? 0 }) }));
  if (e.months > 1) {
    const marker = h('span', { class: 'em-marker', 'aria-hidden': 'true', text: t('em.oneMonth') });
    // CSSOM writes are allowed by the CSP; style attributes are not.
    marker.style.left = `${100 / e.months}%`;
    bar.append(marker);
  }
  const months = select(Array.from({ length: 12 }, (_, i) => i + 1).map((n) => [n, t(n === 6 ? 'em.monthsRecommended' : n === 1 ? 'em.monthOne' : 'em.monthsOption', { n })]), e.months, {
    on: { change: () => ctx.commit((d) => { d.settings.emergencyMonths = Number(months.value); }, t('em.monthsSaved', { n: months.value })) },
  });
  return h('div', { class: 'em-header' },
    h('p', { class: 'big-fact', text: t('em.targetHow', { months: e.months, essentials: money(e.essentials.total), target: money(e.target) }) }),
    e.monthsCovered !== null && h('p', { text: t('em.monthsCovered', { n: e.monthsCovered }) }),
    bar,
    field(t('em.monthsLabel'), months),
    e.earmarkedThisMonth > 0 && h('p', { class: 'hint', text: t('em.thisMonth', { amount: money(e.earmarkedThisMonth), date: fmtDate(e.monthEnd) }) }),
    h('details', {},
      h('summary', { text: t('forecast.how') }),
      h('p', { text: t('em.numbers', { bills: money(e.essentials.bills), spending: money(e.essentials.spending), days: e.essentials.days }) })));
}

/** The emergency fund's verdict: how long it lasts, and if it can't grow this month, why and what would help. */
function emergencySection(e) {
  return h('div', { class: 'goal-plan' },
    e.canSave === true && !e.reached && h('p', { class: 'goal-status ok' }, icon('check'), t('coach.em.canSave', { amount: money(e.monthly) })),
    e.canSave === false && [
      h('p', { class: 'goal-status warn' }, icon('alert'), t(EMERGENCY_REASON[e.reason])),
      impactLine(e),
      e.reason === 'noFreeMoney' && e.plan.cuts.length > 0 && [
        h('h3', { text: t('coach.em.cutsLead') }),
        cutList(e.plan.cuts),
      ],
    ],
    e.canSave === null && h('p', { class: 'hint', text: t('goals.unknown') }));
}

function starterCard(ctx, s, emergency) {
  const target = Math.max(EMERGENCY_STARTER, s.billsTotal);
  const start = () => ctx.commit((d) => { d.goals.push({ id: newId(), name: t('save.emergencyName'), target, kind: 'emergency' }); }, t('save.created'));
  return h('section', { class: 'card highlight' },
    h('h2', { text: t('save.starterTitle') }),
    h('p', { text: t('save.starterBody', { amount: money(target) }) }),
    impactLine(emergency),
    h('button', { class: 'btn', type: 'button', on: { click: start } }, t('save.starterBtn')));
}

function newGoalCard(ctx) {
  return h('section', { class: 'card' },
    h('details', { open: !ctx.data.goals.some((g) => g.kind !== 'emergency') },
      h('summary', { text: t('save.newTitle') }),
      goalForm(ctx)));
}

/** Name, amount and an optional date; `after` runs once the goal is saved (e.g. in setup). */
export function goalForm(ctx, { after = null } = {}) {
  const name = h('input', { type: 'text', id: 'goal-name', maxlength: 40, autocomplete: 'off' });
  const target = amountInput({ id: 'goal-target' });
  const today = todayISO();
  const by = h('input', { type: 'date', id: 'goal-by', min: addDays(today, 1) });
  const err = formError();

  async function onSubmit(e) {
    e.preventDefault();
    const n = name.value.trim();
    const cents = parseAmount(target.value);
    if (!n) return showError(err, t('err.name'), name);
    if (!cents) return showError(err, t('err.amount'), target);
    if (by.value && (!isISODate(by.value) || by.value <= today)) return showError(err, t('err.goalDate'), by);
    const goal = { id: newId(), name: n.slice(0, 40), target: cents, kind: 'goal' };
    if (by.value) goal.by = by.value;
    await ctx.commit((d) => { d.goals.push(goal); }, t('save.created'));
    if (after) after();
  }

  return h('form', { novalidate: true, on: { submit: onSubmit } },
    field(t('save.goalName'), name, t('save.goalNameHint')),
    field(t('save.goalTarget'), target),
    field(t('save.byWhen'), by, t('save.byWhenHint')),
    err,
    h('button', { class: 'btn', type: 'submit' }, t('save.create')));
}
