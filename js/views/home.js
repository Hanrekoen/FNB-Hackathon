import { summarize } from '../core/budget.js';
import { dayOfYear, todayISO } from '../core/dates.js';
import { h } from '../dom.js';
import { list, t } from '../i18n.js';
import { card, daysText, fmtDate, money, pageTitle, sortTx, txList } from './ui.js';

const SOURCE_NOTE = { estimate: 'home.estimated', late: 'home.late', default: 'home.guess' };

export function render(ctx) {
  const d = ctx.data;
  const today = todayISO();
  const s = summarize(d, today);
  const tips = list('tips.money');
  const over = s.leftToday < 0;
  const sourceNote = SOURCE_NOTE[s.next.source];

  return h('div', { class: 'stack' },
    pageTitle(d.profile.name ? t('home.hello', { name: d.profile.name }) : t('home.helloAnon')),

    h('section', { class: 'hero', 'aria-labelledby': 'hero-h' },
      h('h2', { id: 'hero-h', class: 'hero-label', text: t('home.safeToday') }),
      h('p', { class: 'hero-amount', text: money(Math.max(0, s.leftToday)) }),
      h('p', { class: 'hero-sub', text: over ? t('home.over', { amount: money(-s.leftToday) }) : t('home.daily', { amount: money(s.perDay), spent: money(s.spentToday) }) }),
      h('dl', { class: 'hero-facts' },
        h('div', {}, h('dt', { text: t('home.cash') }), h('dd', { text: money(s.cash) })),
        h('div', {}, h('dt', { text: t('home.next') }), h('dd', { text: `${daysText(s.daysLeft)} · ${fmtDate(s.next.date)}` }))),
      sourceNote && h('p', { class: 'hero-note', text: t(sourceNote) })),

    s.shortfall > 0 && h('p', { class: 'alert danger', text: t('home.shortfall', { amount: money(s.shortfall) }) }),

    h('div', { class: 'quick' },
      h('a', { class: 'btn', href: '#/money/in' }, t('home.addIn')),
      h('a', { class: 'btn secondary', href: '#/money/out' }, t('home.addOut'))),

    !d.transactions.length && card(t('home.startTitle'), h('p', { text: t('home.startBody') })),

    s.billsDue.length > 0 && card(t('home.bills', { amount: money(s.billsTotal) }),
      h('ul', { class: 'plain' }, s.billsDue.slice(0, 4).map((b) => h('li', { class: 'row-between' },
        h('span', { text: `${b.name} · ${fmtDate(b.due)}` }),
        h('strong', { text: money(b.amount) }))))),

    d.transactions.length > 0 && card(t('home.recent'),
      txList(ctx, sortTx(d.transactions).slice(0, 5), false),
      h('a', { class: 'link', href: '#/money' }, t('home.seeAll'))),

    h('section', { class: 'card tip' },
      h('h2', { text: t('home.tip') }),
      h('p', { text: tips[dayOfYear(today) % tips.length] })));
}
