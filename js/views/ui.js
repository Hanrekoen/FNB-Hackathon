import { overspendOf, summarize } from '../core/budget.js';
import { deleteTransaction } from '../core/buckets.js';
import { ICONS } from '../core/categories.js';
import { spendingConsequence } from '../core/coach.js';
import { parseISO, todayISO } from '../core/dates.js';
import { formatMoney } from '../core/money.js';
import { h } from '../dom.js';
import { locale, t } from '../i18n.js';
import { icon } from '../icons.js';

export const money = (cents) => formatMoney(cents, locale());
export const newId = () => crypto.randomUUID();

export function fmtDate(iso) {
  const d = parseISO(iso);
  // Show the year only when it isn't this year, e.g. a goal date moved into next year.
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', year }).format(d);
}

export function fmtDateTime(ms) {
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
}

/** Weekday name for 0 (Sunday) to 6, in the current language. */
export function weekdayName(day, style = 'long') {
  return new Intl.DateTimeFormat(locale(), { weekday: style }).format(new Date(2024, 0, 7 + day));
}

export function daysText(n) {
  if (n <= 0) return t('when.today');
  if (n === 1) return t('when.tomorrow');
  return t('when.inDays', { n });
}

/** The page heading receives focus on navigation so screen readers announce the new page. */
export function pageTitle(title, lead) {
  return [h('h1', { tabindex: -1, text: title }), lead && h('p', { class: 'lead', text: lead })];
}

let uid = 0;
export function field(label, input, hint) {
  input.id ||= `f${++uid}`;
  const nodes = [h('label', { for: input.id }, label), input];
  if (hint) {
    input.setAttribute('aria-describedby', `${input.id}-hint`);
    nodes.push(h('p', { class: 'hint', id: `${input.id}-hint`, text: hint }));
  }
  return h('div', { class: 'field' }, nodes);
}

export function checkRow(input, label) {
  return h('label', { class: 'check' }, input, h('span', { text: label }));
}

export function amountInput(props = {}) {
  return h('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', maxlength: 16, ...props,
  });
}

export function select(options, value, props = {}) {
  return h('select', props, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
}

/** Error region announced by screen readers when its text changes. */
export const formError = () => h('p', { class: 'error', role: 'alert' });

export function showError(errEl, message, input) {
  errEl.textContent = message;
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      errEl.textContent = '';
    }, { once: true });
    input.focus();
  }
}

/** Disables a button while slow work (key derivation) runs; returns a function that restores it. */
export function busy(btn, label) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = label;
  return () => {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = old;
  };
}

export function stat(label, value, cls = '') {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: label }), h('strong', { class: `stat-value ${cls}`, text: value }));
}

/** Needs / Safety / Free as a stacked bar, with a text legend so colour is never the only signal. */
export function bucketBar({ needs, safety, free, overspend }) {
  const parts = [['needs', needs], ['safety', safety], ['free', Math.max(0, free)]];
  // Spending past the free money shows as its own red part, instead of quietly reading R0.
  if (overspend?.overspent > 0) parts.push(['over', overspend.overspent]);
  const total = parts.reduce((a, [, v]) => a + v, 0);
  const bar = h('div', { class: 'bucket-bar', 'aria-hidden': 'true' }, parts.map(([k, v]) => {
    const seg = h('span', { class: `seg-${k}` });
    // CSSOM writes are allowed by the CSP; style attributes are not.
    seg.style.flexGrow = String(total ? v : 1);
    return seg;
  }));
  return h('div', { class: 'buckets' },
    bar,
    h('dl', { class: 'bucket-legend' }, parts.map(([k, v]) => h('div', {},
      h('dt', {}, h('span', { class: `swatch seg-${k}`, 'aria-hidden': 'true' }), t(`bucket.${k}`)),
      h('dd', { class: k === 'over' ? 'neg' : null, text: k === 'over' ? `−${money(v)}` : money(v) })))));
}

/**
 * After overspending: how far over, what the extra came out of, and what to do. Null if not
 * over. Spending more than you have at all (debt) leads, because it's the most serious part.
 */
export function overspendNote({ overspend: o }) {
  if (!o || o.overspent <= 0) return null;
  const inDebt = o.behind > 0;
  const lines = inDebt
    ? [
      o.fromSaving > 0 && t('bucket.alsoSaving', { amount: money(o.fromSaving) }),
      o.fromNeeds > 0 && t('bucket.alsoNeeds', { amount: money(o.fromNeeds) }),
    ]
    : [
      o.fromSaving > 0 && t('bucket.overSaving', { amount: money(o.fromSaving) }),
      o.fromNeeds > 0 && t('bucket.overNeeds', { amount: money(o.fromNeeds) }),
    ];
  return h('div', { class: 'alert danger overspend', role: 'status' },
    h('p', { class: 'with-icon' }, icon('alert'), inDebt
      ? t('bucket.debtTitle', { amount: money(o.behind) })
      : t('bucket.overTitle', { amount: money(o.overspent) })),
    lines.some(Boolean) && bulletList(lines.filter(Boolean)),
    h('p', { class: 'hint', text: t('bucket.overFix') }));
}

/** A card with a heading; pass [iconName, text] as the title for a leading icon. */
export function card(title, ...children) {
  return h('section', { class: 'card' }, heading('h2', title), children);
}

export function heading(tag, title, props = {}) {
  const [name, text] = Array.isArray(title) ? title : [null, title];
  const cls = [props.class, name && 'with-icon'].filter(Boolean).join(' ');
  return h(tag, { ...props, class: cls || null }, name && icon(name), text);
}

export const trashIcon = () => icon('trash');

const LEVEL_ICON = { danger: 'stop', warn: 'alert', info: 'info' };

function noticeText(n) {
  const v = n.vars;
  if (n.id === 'earmarkUsed') return t('notice.earmarkUsed', { used: money(v.used), perDay: money(v.perDay), date: fmtDate(v.date) });
  if (n.id === 'protectSaving') {
    return v.goal
      ? t('notice.protectSaving', { earmarked: money(v.earmarked), goal: v.goal, perDay: money(v.perDay) })
      : t('notice.protectSavingSafety', { earmarked: money(v.earmarked), perDay: money(v.perDay) });
  }
  if (n.id === 'monthEndSoon') {
    return v.goal
      ? t('notice.monthEndSoon', { days: v.days, emergency: money(v.emergency), goalAmount: money(v.goalAmount), goal: v.goal, date: fmtDate(v.date) })
      : t('notice.monthEndSoonSafety', { days: v.days, emergency: money(v.emergency), date: fmtDate(v.date) });
  }
  return t('notice.overPace', { category: t(`cat.${v.category}`) });
}

function noticeActionText(a) {
  return a.kind === 'pauseWant'
    ? t('notice.action.pauseWant', { name: a.name, amount: money(a.amount) })
    : t('notice.action.cut', { cut: money(a.cut), category: t(`cat.${a.category}`) });
}

/**
 * A spending notice: what is happening, what to do next, and the numbers behind it. "Got it"
 * hides it for today. `compact` is the top banner shown when the app opens on another tab.
 */
export function noticeCard(ctx, n, compact = false) {
  const e = n.evidence;
  const dismiss = () => ctx.commit((d) => { d.noticeDismissed = { id: n.id, date: todayISO() }; });
  return h('section', { class: `card notice ${n.level} ${compact ? 'compact' : ''}`, role: 'status' },
    h('p', { class: 'with-icon' }, icon(LEVEL_ICON[n.level], { cls: n.level }), noticeText(n)),
    h('div', { class: 'row' },
      n.action && h('a', { class: 'btn small secondary', href: '#/money' }, noticeActionText(n.action)),
      h('button', { class: 'btn small', type: 'button', on: { click: dismiss } }, t('notice.gotIt'))),
    !compact && h('details', {},
      h('summary', { text: t('notice.why') }),
      h('p', { text: t('notice.numbers', { cash: money(e.cash), needs: money(e.needs), earmarked: money(e.earmarked), pace: money(e.pace), days: e.daysToMonthEnd }) }),
      e.week !== undefined && h('p', { text: t('notice.numbersWeek', { week: money(e.week), usual: money(e.usual) }) })));
}

/** A coach action as a plain sentence; `next` is the next income date. */
export function actionText(a, next) {
  const date = fmtDate(next);
  if (a.kind === 'setAside') return t('coach.action.setAside', { amount: money(a.amount), date });
  if (a.kind === 'keepTo') return t('coach.action.keepTo', { amount: money(a.amount), date });
  if (a.kind === 'pauseWant') return t('coach.action.pauseWant', { name: a.name, amount: money(a.amount), date: fmtDate(a.due) });
  return t('coach.action.cutBefore', { cut: money(a.cut), category: t(`cat.${a.category}`), date });
}

/**
 * Before money leaves (spending, or moving it into savings): if it would come out of what's
 * needed for bills, spell out the consequences and let the user decide. Resolves true to go on.
 */
export async function confirmConsequence(ctx, amount, kind = 'spend') {
  const today = todayISO();
  const c = spendingConsequence(ctx.data, amount, today);
  if (c.fromBillMoney <= 0) return true;
  const verb = kind === 'save' ? 'coach.save' : 'coach.spend';
  const [first, ...more] = c.affected;
  const [want] = c.wants;
  // Past the free money, say what the extra really comes out of. With the bills already paid
  // it isn't bill money: it's this month's saving, then money that isn't there.
  const s = summarize(ctx.data, today);
  const o = overspendOf({ ...s, cash: s.cash - amount, free: s.free - amount });
  const billLine = first
    ? t(`${verb}.short`, { amount: money(amount), short: money(first.short), bill: first.name, billAmount: money(first.planned), date: fmtDate(first.due) })
    : want
      ? t('coach.spend.wantShort', { bill: want.name, short: money(want.short), date: fmtDate(want.due) })
      : (o.fromNeeds > 0 || o.overspent === 0) && t('coach.spend.fromBills', { amount: money(o.fromNeeds || c.fromBillMoney) });
  const lines = [
    billLine,
    ...more.map((b) => t('coach.spend.bill', { bill: b.name, short: money(b.short), date: fmtDate(b.due) })),
    kind === 'spend' && o.fromSaving > 0 && t('coach.over.saving', { amount: money(o.fromSaving) }),
    o.behind > 0 && t('coach.over.behind', { amount: money(o.behind) }),
    c.shortBefore > 0 && t('coach.spend.alreadyShort', { amount: money(c.shortBefore), date: fmtDate(c.nextIncome) }),
    t('coach.spend.yourCall'),
  ].filter(Boolean);
  const choice = await ctx.choose(lines.join('\n\n'), [
    { value: 'stop', label: t(`${verb}.cancel`) },
    { value: 'go', label: t(`${verb}.anyway`), secondary: true },
  ]);
  return choice === 'go';
}

export function bulletList(items) {
  return h('ul', { class: 'bullets' }, items.map((x) => h('li', { text: x })));
}

/** Newest first; same-day entries keep the order they were added. */
export function sortTx(txs) {
  return txs
    .map((tx, i) => [tx, i])
    .sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1])
    .map(([tx]) => tx);
}

export function txTitle(tx, goals) {
  const goal = goals.get(tx.goalId) ?? t('tx.closedGoal');
  if (tx.type === 'save') return t('tx.save', { goal });
  if (tx.type === 'withdraw') return t('tx.withdraw', { goal });
  if (tx.type === 'needs') return t('tx.needs');
  if (tx.type === 'release') return t(tx.correction ? 'tx.correction' : 'tx.release');
  return t(`cat.${tx.category}`);
}

// Moves between buckets don't change the money on hand, so they show without a sign.
const SIGN = { in: '+', withdraw: '+', out: '−', save: '−' };
const SIGN_CLASS = { '+': 'pos', '−': 'neg' };
// Deleting a Needs move would get around the release notice.
const UNDELETABLE = ['needs', 'release'];

export function txList(ctx, txs, withDelete) {
  const goals = new Map(ctx.data.goals.map((g) => [g.id, g.name]));
  return h('ul', { class: 'tx-list' }, txs.map((tx) => {
    const sign = SIGN[tx.type] ?? '';
    const title = txTitle(tx, goals);
    const meta = [fmtDate(tx.date), tx.note].filter(Boolean).join(' · ');
    const remove = async () => {
      // Work out on a copy what else the delete changes, so the user sees it before confirming.
      const preview = deleteTransaction(structuredClone(ctx.data), tx.id, todayISO(), () => 'preview');
      const linked = preview.linked.reduce((a, x) => a + x.amount, 0);
      const message = [
        t('tx.confirmDelete', { what: title, amount: money(tx.amount) }),
        linked > 0 && t('tx.deleteLinked', { amount: money(linked) }),
        preview.corrected > 0 && t('tx.deleteCorrects', { amount: money(preview.corrected) }),
      ].filter(Boolean).join('\n\n');
      if (await ctx.confirm(message, { danger: true, ok: t('action.delete') })) {
        ctx.commit((d) => deleteTransaction(d, tx.id, todayISO(), newId), t('tx.deleted'));
      }
    };
    return h('li', { class: 'tx' },
      h('span', { class: 'tx-icon' }, icon(ICONS[tx.type])),
      h('span', { class: 'tx-main' }, h('span', { class: 'tx-title', text: title }), h('span', { class: 'tx-meta', text: meta })),
      h('span', { class: `tx-amt ${SIGN_CLASS[sign] ?? ''}`, text: `${sign}${money(tx.amount)}` }),
      withDelete && !UNDELETABLE.includes(tx.type) && h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': t('tx.delete', { what: title, amount: money(tx.amount) }), on: { click: remove },
      }, trashIcon()));
  }));
}
