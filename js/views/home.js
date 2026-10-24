import { summarize } from '../core/budget.js';
import { addDays, dayOfYear, todayISO } from '../core/dates.js';
import { runOutForecast, spendingPace, weekdayInsight } from '../core/forecast.js';
import { NUDGE_SNOOZE_DAYS, patternMismatch } from '../core/income.js';
import { weekIndex } from '../core/scam-advice.js';
import { h } from '../dom.js';
import { list, t } from '../i18n.js';
import { loadExample } from './example.js';
import { bucketBar, card, daysText, fmtDate, heading, money, pageTitle, sortTx, txList, weekdayName } from './ui.js';

const SOURCE_NOTE = { estimate: 'home.estimated', late: 'home.late', default: 'home.guess', payday: 'home.payday' };

export function render(ctx) {
  const d = ctx.data;
  const today = todayISO();
  const s = summarize(d, today);
  const tips = list('tips.money');
  const over = s.leftToday < 0;
  const sourceNote = SOURCE_NOTE[s.next.source];
  const empty = !d.transactions.length;

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

    empty && !d.demo && exampleCard(ctx),

    !empty && bucketsCard(s),
    !empty && forecastCard(d, s, today),
    nudgeCard(ctx, today),

    s.billsDue.length > 0 && card(t('home.bills', { amount: money(s.billsTotal) }),
      h('ul', { class: 'plain' }, s.billsDue.slice(0, 5).map((b) => h('li', { class: 'row-between' },
        h('span', { text: `${b.name} · ${fmtDate(b.due)}` }),
        h('strong', { text: money(b.planned) }))))),

    !empty && card(t('home.recent'),
      txList(ctx, sortTx(d.transactions).slice(0, 5), false),
      h('a', { class: 'link', href: '#/money' }, t('home.seeAll'))),

    scamWeekCard(today),

    h('section', { class: 'card tip' },
      heading('h2', ['lightbulb', t('home.tip')]),
      h('p', { text: tips[dayOfYear(today) % tips.length] })));
}

function scamWeekCard(today) {
  const scams = list('scam.weekly');
  return h('section', { class: 'card tip warn' },
    heading('h2', ['message-square-warning', t('home.scamWeek')]),
    h('p', { text: scams[weekIndex(dayOfYear(today), scams.length)] }),
    h('a', { class: 'link', href: '#/scams' }, t('home.scamCheck')));
}

function exampleCard(ctx) {
  return h('section', { class: 'card highlight' },
    h('h2', { text: t('demo.title') }),
    h('p', { text: t('demo.body') }),
    h('button', { class: 'btn', type: 'button', on: { click: () => loadExample(ctx) } }, t('demo.load')),
    h('p', { class: 'hint', text: t('home.startBody') }));
}

function bucketsCard(s) {
  return h('section', { class: 'card', 'aria-labelledby': 'buckets-h' },
    h('h2', { id: 'buckets-h', text: t('bucket.title') }),
    bucketBar(s),
    h('p', { class: 'hint', text: s.needs > 0 ? t('bucket.guarding', { amount: money(s.needs) }) : t('bucket.noneGuarded') }),
    h('a', { class: 'link', href: '#/save' }, t('bucket.manage')));
}

/** Run-out warning plus one spending pattern; both show the numbers they are based on. */
function forecastCard(d, s, today) {
  const pace = spendingPace(d.transactions, today);
  const f = runOutForecast(s.free - s.unfunded, pace, today, s.next.date);
  const insight = weekdayInsight(d.transactions, today);
  const message = f.onTrack
    ? t('forecast.onTrack')
    : t('forecast.runOut', { date: fmtDate(f.date), n: f.gap });
  return h('section', { class: `card forecast ${f.onTrack ? 'ok' : 'warn'}`, 'aria-labelledby': 'forecast-h' },
    heading('h2', ['telescope', t('forecast.title')], { id: 'forecast-h' }),
    h('p', { class: 'big-fact', text: message }),
    h('details', {},
      h('summary', { text: t('forecast.how') }),
      h('p', { text: t('forecast.numbers', { spent: money(pace.spent), days: pace.days, pace: money(pace.perDay), free: money(Math.max(0, s.free - s.unfunded)) }) })),
    insight && h('p', { text: t('forecast.weekday', { day: weekdayName(insight.weekday), amount: money(insight.average) }) }),
    insight && h('details', {},
      h('summary', { text: t('forecast.how') }),
      h('p', { text: t('forecast.weekdayNumbers', { total: money(insight.total), count: insight.count, day: weekdayName(insight.weekday), from: fmtDate(insight.from) }) })));
}

function nudgeCard(ctx, today) {
  const m = patternMismatch(ctx.data.income, ctx.data.transactions, today);
  if (!m) return null;
  const pattern = t(`income.pattern.${ctx.data.income.pattern}`);
  const switchToVaries = () => ctx.commit((d) => { d.income.pattern = 'varies'; }, t('income.saved'));
  const snooze = () => ctx.commit((d) => { d.income.nudgeSnoozedUntil = addDays(today, NUDGE_SNOOZE_DAYS); });
  return h('section', { class: 'card highlight', 'aria-labelledby': 'nudge-h' },
    h('h2', { id: 'nudge-h', text: t('nudge.title') }),
    h('p', { text: t('nudge.body', { pattern, gap: m.learned }) }),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', on: { click: switchToVaries } }, t('nudge.switch')),
      h('button', { class: 'btn secondary', type: 'button', on: { click: snooze } }, t('nudge.dismiss'))));
}
