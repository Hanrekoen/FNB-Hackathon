// "How does your money usually come in?" Asked once after setup, changeable any time.

import { isISODate, todayISO } from '../core/dates.js';
import { PATTERNS } from '../core/income.js';
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { checkRow, field, fmtDate, formError, pageTitle, select, showError, weekdayName } from './ui.js';

export function profileSummary(income) {
  const name = t(`income.pattern.${income.pattern}`);
  if (income.pattern === 'monthly' && income.payDay) return t('income.summaryMonthly', { pattern: name, day: income.payDay });
  if (income.pattern === 'weekly' && income.payWeekday !== null) return t('income.summaryWeekly', { pattern: name, day: weekdayName(income.payWeekday) });
  if (income.pattern === 'biweekly' && income.anchorDate) return t('income.summaryBiweekly', { pattern: name, date: fmtDate(income.anchorDate) });
  return t('income.summary', { pattern: name });
}

export function render(ctx) {
  const onboarding = ctx.flash.onboarding === true;
  const income = ctx.data.income;
  const today = todayISO();
  let pattern = income.pattern;

  const radios = PATTERNS.map((p) => checkRow(
    h('input', { type: 'radio', name: 'pattern', value: p, checked: p === pattern, on: { change: () => { pattern = p; sync(); } } }),
    t(`income.pattern.${p}`)));
  const day = h('input', { type: 'number', id: 'pay-day', min: 1, max: 31, inputmode: 'numeric', value: income.payDay ?? '' });
  const weekday = select([1, 2, 3, 4, 5, 6, 0].map((n) => [n, weekdayName(n)]), income.payWeekday ?? 5, { id: 'pay-weekday' });
  const anchor = h('input', { type: 'date', id: 'pay-anchor', max: today, value: income.anchorDate ?? '' });
  const err = formError();

  const dayField = field(t('income.payDay'), day, t('bills.dayHint'));
  const weekdayField = field(t('income.payWeekday'), weekday);
  const anchorField = field(t('income.anchor'), anchor, t('income.anchorHint'));
  const variesNote = h('p', { class: 'hint', text: t('income.variesNote') });
  function sync() {
    dayField.hidden = pattern !== 'monthly';
    weekdayField.hidden = pattern !== 'weekly';
    anchorField.hidden = pattern !== 'biweekly';
    variesNote.hidden = pattern !== 'varies';
  }
  sync();

  const finish = () => {
    delete ctx.flash.onboarding;
    location.hash = '#/home';
  };

  async function onSubmit(e) {
    e.preventDefault();
    const next = { ...income, pattern, payDay: null, payWeekday: null, anchorDate: null, nudgeSnoozedUntil: null };
    if (pattern === 'monthly') {
      const n = Number(day.value);
      if (!Number.isInteger(n) || n < 1 || n > 31) return showError(err, t('err.day'), day);
      next.payDay = n;
    } else if (pattern === 'weekly') {
      next.payWeekday = Number(weekday.value);
    } else if (pattern === 'biweekly') {
      if (!isISODate(anchor.value) || anchor.value > today) return showError(err, t('err.date'), anchor);
      next.anchorDate = anchor.value;
    }
    await ctx.commit((d) => { d.income = next; }, t('income.saved'));
    if (onboarding) finish();
  }

  return h('div', { class: 'stack' },
    pageTitle(t('income.title'), t('income.lead')),
    h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'income-h', on: { submit: onSubmit } },
      h('fieldset', { class: 'choices' }, h('legend', { id: 'income-h', text: t('income.question') }), radios),
      variesNote,
      dayField,
      weekdayField,
      anchorField,
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'submit' }, t('action.save')),
        onboarding && h('button', { class: 'btn secondary', type: 'button', on: { click: finish } }, t('income.skip')))));
}
