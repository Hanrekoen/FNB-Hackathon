import { ICONS } from '../core/categories.js';
import { parseISO } from '../core/dates.js';
import { formatMoney } from '../core/money.js';
import { h } from '../dom.js';
import { locale, t } from '../i18n.js';

export const money = (cents) => formatMoney(cents, locale());
export const newId = () => crypto.randomUUID();

export function fmtDate(iso) {
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(parseISO(iso));
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
  const nodes = [h('label', { for: input.id, text: label }), input];
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

export function card(title, ...children) {
  return h('section', { class: 'card' }, h('h2', { text: title }), children);
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
  return t(`cat.${tx.category}`);
}

export function txList(ctx, txs, withDelete) {
  const goals = new Map(ctx.data.goals.map((g) => [g.id, g.name]));
  return h('ul', { class: 'tx-list' }, txs.map((tx) => {
    const positive = tx.type === 'in' || tx.type === 'withdraw';
    const title = txTitle(tx, goals);
    const meta = [fmtDate(tx.date), tx.note].filter(Boolean).join(' · ');
    const remove = async () => {
      if (await ctx.confirm(t('tx.confirmDelete', { what: title, amount: money(tx.amount) }), { danger: true, ok: t('action.delete') })) {
        ctx.commit((d) => { d.transactions = d.transactions.filter((x) => x.id !== tx.id); }, t('tx.deleted'));
      }
    };
    return h('li', { class: 'tx' },
      h('span', { class: 'tx-icon', 'aria-hidden': 'true', text: ICONS[tx.type] }),
      h('span', { class: 'tx-main' }, h('span', { class: 'tx-title', text: title }), h('span', { class: 'tx-meta', text: meta })),
      h('span', { class: `tx-amt ${positive ? 'pos' : 'neg'}`, text: `${positive ? '+' : '−'}${money(tx.amount)}` }),
      withDelete && h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': t('tx.delete', { what: title, amount: money(tx.amount) }), on: { click: remove },
      }, h('span', { 'aria-hidden': 'true', text: '🗑️' })));
  }));
}
