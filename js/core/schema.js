// The shape of the user's data and its migrations. Everything decrypted from the vault or a
// backup passes through normalize(), so malformed or older data can never reach the app.

import { OUT_CATS } from './categories.js';
import { isISODate } from './dates.js';
import { PATTERNS, defaultIncome } from './income.js';
import { MAX_CENTS } from './money.js';

export const SCHEMA_VERSION = 3;
export const SAVE_PERCENTS = [0, 5, 10, 15, 20, 25, 30];
/** Scam checks the user chose to keep (v3): at most this many, each message cut to this length. */
export const SCAM_LOG_MAX = 30;
export const SCAM_LOG_TEXT = 500;

const TX_TYPES = ['in', 'out', 'save', 'withdraw', 'needs', 'release'];
const FREQUENCIES = ['monthly', 'weekly', 'once'];
const RELEASE_STATUS = ['pending', 'released', 'cancelled'];
const SCAM_LEVELS = ['none', 'low', 'medium', 'high'];

export function emptyData(name = '', today = null) {
  return {
    v: SCHEMA_VERSION,
    profile: { name },
    settings: { savePercent: 10 },
    income: defaultIncome(),
    transactions: [],
    bills: [],
    goals: [],
    releases: [],
    scamLog: [],
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

function normalizeRelease(r) {
  if (!isAmount(r.amount) || !isTime(r.requestedAt) || !isTime(r.availableAt) || !RELEASE_STATUS.includes(r.status)) return null;
  return { id: str(r.id, 64), amount: r.amount, reason: str(r.reason, 80), requestedAt: r.requestedAt, availableAt: r.availableAt, status: r.status };
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
  out.income = normalizeIncome(d?.income);
  out.transactions = list(d?.transactions)
    .filter((t) => TX_TYPES.includes(t.type) && isAmount(t.amount) && isISODate(t.date))
    .map(normalizeTx);
  out.bills = list(d?.bills).filter((b) => isAmount(b.amount)).map(normalizeBill).filter(Boolean);
  out.goals = list(d?.goals)
    .filter((g) => isAmount(g.target))
    .map((g) => ({ ...g, id: str(g.id, 64), name: str(g.name, 40), kind: g.kind === 'emergency' ? 'emergency' : 'goal' }));
  out.releases = list(d?.releases).map(normalizeRelease).filter(Boolean);
  out.scamLog = list(d?.scamLog).map(normalizeScamCheck).filter(Boolean).slice(0, SCAM_LOG_MAX);
  out.nextIncome = isISODate(out.nextIncome) ? out.nextIncome : null;
  out.demo = d?.demo === true;
  out.createdAt = isISODate(out.createdAt) ? out.createdAt : today;
  return out;
}
