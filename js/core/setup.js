// The guided setup a new user walks through before Home: steps, their order, and the running
// bill totals shown while adding bills. Progress lives in the vault, so a reload resumes it.

import { monthlyEquivalent } from './forecast.js';
import { SETUP_STEPS } from './schema.js';

export { SETUP_STEPS };

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export const stepNumber = (step) => SETUP_STEPS.indexOf(step) + 1;
export const nextStep = (step) => SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, SETUP_STEPS.indexOf(step) + 1)];
export const prevStep = (step) => SETUP_STEPS[Math.max(0, SETUP_STEPS.indexOf(step) - 1)];

/** What the bills come to in a month, split into essentials and wants (once-off bills left out). */
export function billTotals(data, today) {
  const monthly = (b) => (b.frequency === 'once' ? 0 : monthlyEquivalent(b, data.transactions, today));
  const essential = sum(data.bills.filter((b) => b.kind !== 'want').map(monthly));
  const want = sum(data.bills.filter((b) => b.kind === 'want').map(monthly));
  return { essential, want, total: essential + want };
}

/** The bills step may finish with at least one bill, or with "I don't have any bills right now". */
export const canLeaveBills = (data, noBills = false) => noBills || data.bills.length > 0;

export const restartSetup = (data) => { data.setup = { done: false, step: SETUP_STEPS[0] }; };
export const finishSetup = (data) => { data.setup = { done: true, step: SETUP_STEPS.at(-1) }; };
