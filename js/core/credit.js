// Responsible credit: show the true cost of a loan in plain terms before someone signs.

// National Credit Act regulations cap short-term credit at 5% per month (60% a year), the
// highest cap for any loan type. Above this the lender is very likely operating illegally.
export const LEGAL_MAX_ANNUAL = 60;
// Roughly the cap for unsecured personal loans (repo rate + 21%). Above it is expensive credit.
export const HIGH_ANNUAL = 28;

export function monthlyInstalment(financed, annualRate, months) {
  const r = annualRate / 100 / 12;
  return r === 0 ? financed / months : (financed * r) / (1 - (1 + r) ** -months);
}

/** Effective yearly cost of borrowing `principal` and repaying `payment` monthly, fees included. */
export function effectiveAnnualRate(principal, payment, months) {
  if (payment * months <= principal) return 0;
  const pv = (i) => (payment * (1 - (1 + i) ** -months)) / i;
  let lo = 1e-9;
  let hi = 1; // 100% per month
  if (pv(hi) > principal) return ((1 + hi) ** 12 - 1) * 100;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > principal) lo = mid;
    else hi = mid;
  }
  return ((1 + lo) ** 12 - 1) * 100;
}

/** All amounts in cents. The initiation fee is assumed to be added to the loan, as is common. */
export function loanCost({ principal, annualRate, months, initFee = 0, monthlyFee = 0 }) {
  const monthly = Math.round(monthlyInstalment(principal + initFee, annualRate, months) + monthlyFee);
  const total = monthly * months;
  return {
    monthly,
    total,
    cost: total - principal,
    payBackPer100: Math.round((total * 10_000) / principal),
    effectiveRate: effectiveAnnualRate(principal, monthly, months),
    monthsToSave: Math.ceil(principal / monthly),
  };
}

/** Returns { level: 'ok' | 'caution' | 'danger', reasons: [{ key, vars }] } */
export function assessLoan(result, principal, annualRate, monthlyIncome) {
  const reasons = [];
  let level = 'ok';
  const flag = (lvl, key, vars = {}) => {
    reasons.push({ key, level: lvl, vars });
    if (lvl === 'danger' || (lvl === 'caution' && level === 'ok')) level = lvl;
  };

  if (annualRate > LEGAL_MAX_ANNUAL) flag('danger', 'credit.r.illegal');
  else if (annualRate > HIGH_ANNUAL) flag('caution', 'credit.r.high');

  if (monthlyIncome > 0) {
    const pct = Math.round((result.monthly / monthlyIncome) * 100);
    if (pct > 30) flag('danger', 'credit.r.unaffordable', { pct });
    else if (pct > 20) flag('caution', 'credit.r.stretch', { pct });
    else reasons.push({ key: 'credit.r.fits', level: 'ok', vars: { pct } });
  } else {
    flag('caution', 'credit.r.noIncome');
  }

  if (result.cost >= principal) flag('danger', 'credit.r.double');
  if (result.effectiveRate - annualRate > 10) flag('caution', 'credit.r.fees');

  return { level, reasons };
}
