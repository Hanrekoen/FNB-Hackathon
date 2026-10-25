// The shape of the user's data and its migrations. Everything decrypted from the vault or a
// backup passes through normalize(), so malformed or older data can never reach the app.

import { CUTTABLE, OUT_CATS } from './categories.js';
import { isISODate } from './dates.js';
import { PATTERNS, defaultIncome } from './income.js';
import { MAX_CENTS } from './money.js';

export const SCHEMA_VERSION = 4;
export const SAVE_PERCENTS = [0, 5, 10, 15, 20, 25, 30];
/** Scam checks the user chose to keep (v3): at most this many, each message cut to this length. */
export const SCAM_LOG_MAX = 30;
export const SCAM_LOG_TEXT = 500;

const TX_TYPES = ['in', 'out', 'save', 'withdraw', 'needs', 'release'];
const FREQUENCIES = ['monthly', 'weekly', 'once'];
export const BILL_KINDS = ['essential', 'want'];
const RELEASE_STATUS = ['pending', 'released', 'cancelled'];
const SCAM_LEVELS = ['none', 'low', 'medium', 'high'];
const EARMARK_KINDS = ['emergency', 'goal'];
// Guided setup steps (v4), in order.
export const SETUP_STEPS = ['welcome', 'pay', 'bills', 'safety', 'goal', 'summary'];
const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export function emptyData(name = '', today = null) {
  return {
    v: SCHEMA_VERSION,
    profile: { name },
    settings: { savePercent: 10, emergencyMonths: 6 },
    income: defaultIncome(),
    transactions: [],
    bills: [],
    goals: [],
    releases: [],
    scamLog: [],
    earmarks: [],
    sweeps: [],
    noticeDismissed: null,
    setup: { done: false, step: 'welcome' },
    nextIncome: null,
    demo: false,
    createdAt: today,
  };
}

const isAmount = (n) => Number.isSafeInteger(n) && n > 0 && n <= MAX_CENTS;
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
const list = (x) => (Array.isArray(x) ? x.filter((v) => v && typeof v === 'object') : []);
const isTime = (n) => Number.isSafeInteger(n) && n > 0;

function normalizeIncome(i) {
  const out = defaultIncome();
  if (!i || !PATTERNS.includes(i.pattern)) return out;
  out.pattern = i.pattern;
  out.payDay = isInt(i.payDay, 1, 31) ? i.payDay : null;
  out.payWeekday = isInt(i.payWeekday, 0, 6) ? i.payWeekday : null;
  out.anchorDate = isISODate(i.anchorDate) ? i.anchorDate : null;
  out.nudgeSnoozedUntil = isISODate(i.nudgeSnoozedUntil) ? i.nudgeSnoozedUntil : null;
  return out;
}

function normalizeTx(t) {
  const out = { ...t, id: str(t.id, 64), category: str(t.category, 20), note: str(t.note, 80) };
  if (t.type === 'out' && 'fromNeeds' in t) {
    if (isInt(t.fromNeeds, 0, t.amount)) out.fromNeeds = t.fromNeeds;
    else delete out.fromNeeds;
  }
  if (typeof t.fromIncome === 'string' && t.fromIncome) out.fromIncome = t.fromIncome.slice(0, 64);
  else delete out.fromIncome;
  if (t.correction === true && t.type === 'release') out.correction = true;
  else delete out.correction;
  return out;
}

/** Bills from v1 had only a day of the month; they become fixed monthly bills. */
function normalizeBill(b) {
  const out = {
    id: str(b.id, 64),
    name: str(b.name, 40),
    amount: b.amount,
    frequency: FREQUENCIES.includes(b.frequency) ? b.frequency : 'monthly',
    amountType: b.amountType === 'varies' && OUT_CATS.includes(b.linkedCategory) ? 'varies' : 'fixed',
    // Bills from before the essential/want choice were all treated as must-pays.
    kind: b.kind === 'want' ? 'want' : 'essential',
    lastPaidDue: isISODate(b.lastPaidDue) ? b.lastPaidDue : null,
  };
  if (out.amountType === 'varies') out.linkedCategory = b.linkedCategory;
  if (out.frequency === 'monthly') {
    if (!isInt(b.dueDay, 1, 31)) return null;
    out.dueDay = b.dueDay;
  } else if (out.frequency === 'weekly') {
    if (!isInt(b.weekday, 0, 6)) return null;
    out.weekday = b.weekday;
  } else {
    if (!isISODate(b.dueDate)) return null;
    out.dueDate = b.dueDate;
    out.amountType = 'fixed';
    delete out.linkedCategory;
  }
  return out;
}

function normalizePlan(p) {
  if (!p || typeof p !== 'object' || !isAmount(p.perContribution) || !isTime(p.acceptedAt)) return null;
  // A cut is either less spending in an everyday extra, or a want bill cancelled or cut back.
  const cuts = list(p.cuts)
    .filter((c) => (c.category in CUTTABLE || (typeof c.billId === 'string' && c.billId)) && isAmount(c.cut) && isInt(c.current, 0, MAX_CENTS))
    .map((c) => (c.billId
      ? { billId: str(c.billId, 64), name: str(c.name, 40), current: c.current, cut: c.cut }
      : { category: c.category, current: c.current, cut: c.cut }));
  return { cuts, perContribution: p.perContribution, acceptedAt: p.acceptedAt };
}

/** A deadline is kept even once it has passed, so an old goal still loads; the form checks it's in the future. */
function normalizeGoal(g) {
  const out = { ...g, id: str(g.id, 64), name: str(g.name, 40), kind: g.kind === 'emergency' ? 'emergency' : 'goal' };
  delete out.by;
  delete out.plan;
  if (out.kind === 'goal' && isISODate(g.by)) {
    out.by = g.by;
    const plan = normalizePlan(g.plan);
    if (plan) out.plan = plan;
  }
  return out;
}

function normalizeRelease(r) {
  if (!isAmount(r.amount) || !isTime(r.requestedAt) || !isTime(r.availableAt) || !RELEASE_STATUS.includes(r.status)) return null;
  return { id: str(r.id, 64), amount: r.amount, reason: str(r.reason, 80), requestedAt: r.requestedAt, availableAt: r.availableAt, status: r.status };
}

/** Money earmarked from an income for month-end saving (v4). */
function normalizeEarmark(e) {
  if (!isMonth(e.month) || !EARMARK_KINDS.includes(e.kind) || !isAmount(e.amount)) return null;
  if (e.kind === 'goal' && !(typeof e.goalId === 'string' && e.goalId)) return null;
  const out = { id: str(e.id, 64), month: e.month, kind: e.kind, amount: e.amount, incomeId: typeof e.incomeId === 'string' ? str(e.incomeId, 64) : null };
  if (e.kind === 'goal') out.goalId = str(e.goalId, 64);
  return out;
}

/** A finished month-end sweep (v4), kept so a month is never swept twice. */
function normalizeSweep(w) {
  if (!isMonth(w.month)) return null;
  const cents = (n) => (isInt(n, 0, MAX_CENTS) ? n : 0);
  const goals = list(w.goals).filter((g) => typeof g.goalId === 'string' && isInt(g.amount, 0, MAX_CENTS))
    .map((g) => ({ goalId: str(g.goalId, 64), amount: g.amount }));
  return { month: w.month, emergency: cents(w.emergency), emergencyShort: cents(w.emergencyShort), goals };
}

function normalizeScamCheck(c) {
  if (!SCAM_LEVELS.includes(c.level) || !isISODate(c.date) || typeof c.text !== 'string') return null;
  const matches = Array.isArray(c.matches) ? c.matches.filter((m) => typeof m === 'string').slice(0, 40).map((m) => m.slice(0, 20)) : [];
  return { id: str(c.id, 64), date: c.date, level: c.level, matches, text: c.text.slice(0, SCAM_LOG_TEXT), wrong: c.wrong === true };
}

/** Defensive normalisation of decrypted data, migrating v1 and v2 to the current version. */
export function normalize(input, today = null) {
  const d = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const base = emptyData('', today);
  const out = { ...base, ...d, v: SCHEMA_VERSION, profile: { ...base.profile, ...d?.profile }, settings: { ...base.settings, ...d?.settings } };
  out.profile.name = str(out.profile.name, 40);
  if (!SAVE_PERCENTS.includes(out.settings.savePercent)) out.settings.savePercent = 10;
  // Months of essentials the safety net aims for (v4); 6 is the usual recommendation.
  if (!isInt(out.settings.emergencyMonths, 1, 12)) out.settings.emergencyMonths = 6;
  out.income = normalizeIncome(d?.income);
  out.transactions = list(d?.transactions)
    .filter((t) => TX_TYPES.includes(t.type) && isAmount(t.amount) && isISODate(t.date))
    .map(normalizeTx);
  out.bills = list(d?.bills).filter((b) => isAmount(b.amount)).map(normalizeBill).filter(Boolean);
  out.goals = list(d?.goals).filter((g) => isAmount(g.target)).map(normalizeGoal);
  out.releases = list(d?.releases).map(normalizeRelease).filter(Boolean);
  out.scamLog = list(d?.scamLog).map(normalizeScamCheck).filter(Boolean).slice(0, SCAM_LOG_MAX);
  out.earmarks = list(d?.earmarks).map(normalizeEarmark).filter(Boolean);
  // A spending notice dismissed for the day (v4); only its id and the day are kept.
  const nd = d?.noticeDismissed;
  out.noticeDismissed = nd && typeof nd.id === 'string' && /^\w{1,20}$/.test(nd.id) && isISODate(nd.date) ? { id: nd.id, date: nd.date } : null;
  const swept = new Set();
  out.sweeps = list(d?.sweeps).map(normalizeSweep).filter((w) => w && !swept.has(w.month) && swept.add(w.month));
  out.nextIncome = isISODate(out.nextIncome) ? out.nextIncome : null;
  out.demo = d?.demo === true;
  // Anyone who already has money in Imali skips the guided setup; everyone else resumes where they left off.
  const st = d?.setup;
  out.setup = st && typeof st.done === 'boolean' && SETUP_STEPS.includes(st.step)
    ? { done: st.done, step: st.step }
    : { done: out.transactions.length + out.bills.length + out.goals.length > 0, step: 'welcome' };
  out.createdAt = isISODate(out.createdAt) ? out.createdAt : today;
  return out;
}
