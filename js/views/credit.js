// Responsible credit: true cost of a loan, affordability, and how to spot illegal lenders.

import { monthlyIncomeEstimate } from '../core/budget.js';
import { assessLoan, loanCost } from '../core/credit.js';
import { todayISO } from '../core/dates.js';
import { centsToInput, parseAmount, parseOptionalAmount, parsePercent } from '../core/money.js';
import { h } from '../dom.js';
import { list, t } from '../i18n.js';
import { icon } from '../icons.js';
import { amountInput, bulletList, card, field, formError, money, pageTitle, showError, stat } from './ui.js';

const LEVEL_ICON = { ok: 'check', caution: 'alert', danger: 'stop' };

export function render(ctx) {
  const est = monthlyIncomeEstimate(ctx.data.transactions, todayISO());
  // Set when the scam check sends a loan offer here, so its amount is filled in.
  const offered = ctx.flash.loanAmount;
  delete ctx.flash.loanAmount;
  const principal = amountInput({ id: 'loan-amount', value: offered ? centsToInput(offered) : '' });
  const rate = h('input', { id: 'loan-rate', type: 'text', inputmode: 'decimal', autocomplete: 'off', maxlength: 8, placeholder: '27.5' });
  const months = h('input', { id: 'loan-months', type: 'number', inputmode: 'numeric', min: 1, max: 360 });
  const initFee = amountInput({ id: 'loan-init', placeholder: '0' });
  const monthlyFee = amountInput({ id: 'loan-fee', placeholder: '0' });
  const income = amountInput({ id: 'loan-income', value: est > 0 ? centsToInput(est) : '' });
  const err = formError();
  const out = h('div', { 'aria-live': 'polite' });

  function onSubmit(e) {
    e.preventDefault();
    const p = parseAmount(principal.value);
    const r = parsePercent(rate.value);
    const m = Number(months.value);
    const fi = parseOptionalAmount(initFee.value);
    const fm = parseOptionalAmount(monthlyFee.value);
    const inc = parseOptionalAmount(income.value);
    if (!p) return showError(err, t('err.amount'), principal);
    if (r === null) return showError(err, t('err.rate'), rate);
    if (!Number.isInteger(m) || m < 1 || m > 360) return showError(err, t('err.months'), months);
    if (fi === null) return showError(err, t('err.amount'), initFee);
    if (fm === null) return showError(err, t('err.amount'), monthlyFee);
    if (inc === null) return showError(err, t('err.amount'), income);
    const res = loanCost({ principal: p, annualRate: r, months: m, initFee: fi, monthlyFee: fm });
    out.replaceChildren(resultCard(res, assessLoan(res, p, r, inc)));
    out.querySelector('h2').focus();
  }

  return h('div', { class: 'stack' },
    pageTitle(t('credit.title'), t('credit.lead')),
    h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'loan-h', on: { submit: onSubmit } },
      h('h2', { id: 'loan-h', text: t('credit.formTitle') }),
      field(t('credit.amount'), principal),
      field(t('credit.rate'), rate, t('credit.rateHint')),
      field(t('credit.months'), months),
      field(t('credit.initFee'), initFee, t('credit.optional')),
      field(t('credit.monthlyFee'), monthlyFee, t('credit.optional')),
      field(t('credit.income'), income, est > 0 ? t('credit.incomeEst') : t('credit.incomeHint')),
      err,
      h('button', { class: 'btn', type: 'submit' }, t('credit.calc'))),
    out,
    card(['flag', t('credit.flagsTitle')], bulletList(list('credit.flags'))),
    card(['scale', t('credit.rightsTitle')], bulletList(list('credit.rights')), h('p', { class: 'hint', text: t('credit.disclaimer') })));
}

function resultCard(res, a) {
  return h('section', { class: `card result ${a.level}`, 'aria-labelledby': 'res-h' },
    h('h2', { id: 'res-h', tabindex: -1, text: t('credit.result') }),
    h('p', { class: `badge with-icon ${a.level}` }, icon(LEVEL_ICON[a.level]), t(`credit.level.${a.level}`)),
    h('div', { class: 'stats' },
      stat(t('credit.monthly'), money(res.monthly)),
      stat(t('credit.total'), money(res.total)),
      stat(t('credit.cost'), money(res.cost), 'neg'),
      stat(t('credit.real'), `${res.effectiveRate.toFixed(1)}%`)),
    h('p', { class: 'big-fact', text: t('credit.per100', { amount: money(res.payBackPer100) }) }),
    h('ul', { class: 'reasons' }, a.reasons.map((r) => h('li', { class: r.level },
      icon(LEVEL_ICON[r.level], { cls: r.level }), t(r.key, r.vars)))),
    h('p', { class: 'alert ok', text: t('credit.saveInstead', { monthly: money(res.monthly), months: res.monthsToSave }) }));
}
