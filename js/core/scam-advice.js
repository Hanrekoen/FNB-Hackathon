// What to do after a scam check, plus the scam-awareness hooks used elsewhere in the app.
// Contact details are fixed strings shipped with the app; check them before each release.

import { parseAmount } from './money.js';
import { normalize } from './scam.js';

/** Official South African places to report fraud. Names are proper nouns, so not translated. */
export const CONTACTS = {
  saps: { name: 'SAPS Crime Stop', tel: '0860010111', show: '08600 10111' },
  safps: { name: 'SAFPS (Southern African Fraud Prevention Service)', tel: '0118672234', show: '011 867 2234' },
  ncr: { name: 'National Credit Regulator (NCR)', tel: '0860627627', show: '0860 627 627' },
  sassa: { name: 'SASSA', tel: '0800601011', show: '0800 60 10 11' },
  sars: { name: 'SARS', email: 'phishing@sars.gov.za' },
};

// Rule ids -> the step that helps most. Order is the order steps are shown in.
const STEPS = [
  ['secret', ['secret']],
  ['remote', ['remote']],
  ['mule', ['mule']],
  ['noPay', ['upfront', 'giftcard', 'invest', 'job', 'parcel', 'rental', 'fakePayment', 'pyramid', 'workFromHome', 'romance', 'prepaid', 'premium']],
  ['official', ['impersonate', 'fakeDomain', 'foreignNumber', 'ipLink', 'grant', 'sim']],
  ['family', ['newNumber']],
  ['loan', ['easyLoan']],
];

/**
 * Next steps for a result: [{ key, contacts?: [contactId], action?: 'credit' }]. Keys are
 * i18n keys under "scam.step.". Nothing is suggested when no warning signs were found.
 */
export function nextSteps(result, text) {
  if (result.level === 'none') return [];
  const found = new Set(result.matches);
  const s = normalize(text);
  const steps = [{ key: 'stop' }];
  for (const [key, ids] of STEPS) if (ids.some((id) => found.has(id))) steps.push({ key });
  const loan = steps.find((x) => x.key === 'loan');
  if (loan) Object.assign(loan, { contacts: ['ncr'], action: 'credit' });
  if (/\bsars\b/.test(s)) steps.push({ key: 'sars', contacts: ['sars'] });
  if (/\b(sassa|srd|social grant|isibonelelo|toelae)\b/.test(s)) steps.push({ key: 'sassa', contacts: ['sassa'] });
  if (result.level === 'high') steps.push({ key: 'report', contacts: ['saps', 'safps'] });
  return steps;
}

/** First rand amount in a message ("R5 000", "R 2,500.00"), in cents, or null. */
export function firstAmount(text) {
  const m = normalize(text).match(/\br ?(\d{1,3}(?:[ ,]\d{3})+|\d{2,7})(?:[.,]\d{2})?\b/);
  return m ? parseAmount(m[0]) : null;
}

// Categories where money often goes because of a scam message or call.
const CHECK_CATEGORIES = ['other', 'family', 'debt'];

/**
 * Should Imali suggest checking for a scam before saving this payment? Large payments, money
 * to family or "other", or a big part of the cash on hand. Amounts in cents.
 */
export function paymentNeedsCheck(amount, category, cash) {
  if (amount >= 200_000) return true;
  if (CHECK_CATEGORIES.includes(category) && amount >= 50_000) return true;
  return amount >= 20_000 && cash > 0 && amount * 2 >= cash;
}

/** Which of the practice messages (list "practice.msgs" in the language files) are scams. */
export const PRACTICE_IS_SCAM = [true, false, true, true, false, true, false, true, true, false];

/** Index into the "scam of the week" list for a date: changes every Monday-ish 7-day block. */
export const weekIndex = (dayOfYear, count) => Math.floor((dayOfYear - 1) / 7) % count;
