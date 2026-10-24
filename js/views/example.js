// Loading and clearing example data, shared by Home and Settings.

import { todayISO } from '../core/dates.js';
import { generateDemo } from '../core/demo.js';
import { emptyData } from '../core/schema.js';
import { t } from '../i18n.js';
import { newId } from './ui.js';

const hasRealData = (d) => !d.demo && (d.transactions.length > 0 || d.bills.length > 0 || d.goals.length > 0);

function replaceData(d, next) {
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, next);
}

export async function loadExample(ctx) {
  const d = ctx.data;
  if (hasRealData(d) && !(await ctx.confirm(t('demo.confirmReplace'), { danger: true, ok: t('demo.load') }))) return;
  const names = {
    rent: t('demo.rent'),
    data: t('demo.data'),
    taxi: t('demo.taxi'),
    registration: t('demo.registration'),
    emergency: t('save.emergencyName'),
    releaseReason: t('demo.releaseReason'),
    holiday: t('demo.holiday'),
    streaming: t('demo.streaming'),
  };
  const next = generateDemo({ today: todayISO(), now: Date.now(), names, profileName: d.profile.name, newId });
  location.hash = '#/home';
  await ctx.commit((x) => replaceData(x, next), t('demo.loaded'));
}

/** Back to an empty start, keeping the user's name and settings. */
export async function clearExample(ctx) {
  if (!(await ctx.confirm(t('demo.confirmClear'), { ok: t('demo.clear') }))) return;
  await ctx.commit((x) => {
    const next = emptyData(x.profile.name, todayISO());
    next.settings = x.settings;
    replaceData(x, next);
  }, t('demo.cleared'));
}
