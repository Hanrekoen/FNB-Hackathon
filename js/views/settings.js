import { todayISO } from '../core/dates.js';
import { checkBackupPassword, checkNewSecret } from '../core/security.js';
import { h } from '../dom.js';
import { LANGS, getLang, list, t } from '../i18n.js';
import { AUTO_LOCK_OPTIONS, BG_GRACE_OPTIONS } from '../prefs.js';
import * as vault from '../vault.js';
import { clearExample, loadExample } from './example.js';
import { secretFields } from './gate.js';
import { profileSummary } from './profile.js';
import {
  bulletList, busy, card, checkRow, field, formError, pageTitle, select, showError,
} from './ui.js';

export function render(ctx) {
  const p = ctx.prefs();
  return h('div', { class: 'stack' },
    pageTitle(t('settings.title')),
    displayCard(ctx, p),
    profileCard(ctx),
    card(t('income.title'),
      h('p', { text: profileSummary(ctx.data.income) }),
      h('a', { class: 'btn secondary', href: '#/profile' }, t('income.change'))),
    exampleCard(ctx),
    installCard(ctx),
    pinCard(ctx),
    backupCard(ctx),
    securityCard(ctx, p),
    card(['lock', t('settings.privacyTitle')], bulletList(list('settings.privacy'))),
    dangerCard(ctx));
}

function displayCard(ctx, p) {
  const lang = select(LANGS.map((l) => [l.code, l.name]), getLang(), { on: { change: () => ctx.setPrefs({ lang: lang.value }) } });
  const large = h('input', { type: 'checkbox', checked: p.large, on: { change: () => ctx.setPrefs({ large: large.checked }) } });
  const contrast = h('input', { type: 'checkbox', checked: p.contrast, on: { change: () => ctx.setPrefs({ contrast: contrast.checked }) } });
  return card(t('settings.display'),
    field(t('settings.language'), lang),
    checkRow(large, t('settings.large')),
    checkRow(contrast, t('settings.contrast')));
}

function profileCard(ctx) {
  const name = h('input', { type: 'text', maxlength: 40, autocomplete: 'off', value: ctx.data.profile.name });
  const save = (e) => {
    e.preventDefault();
    ctx.commit((d) => { d.profile.name = name.value.trim().slice(0, 40); }, t('settings.saved'));
  };
  return h('form', { class: 'card', novalidate: true, on: { submit: save } },
    h('h2', { text: t('settings.profile') }),
    field(t('gate.name'), name),
    h('button', { class: 'btn', type: 'submit' }, t('action.save')));
}

function exampleCard(ctx) {
  const demo = ctx.data.demo;
  return card(t('demo.settingsTitle'),
    h('p', { text: t(demo ? 'demo.settingsOn' : 'demo.settingsOff') }),
    h('button', { class: 'btn secondary', type: 'button', on: { click: () => (demo ? clearExample(ctx) : loadExample(ctx)) } },
      t(demo ? 'demo.clear' : 'demo.load')));
}

function installCard(ctx) {
  if (ctx.install.installed()) return null;
  const canPrompt = ctx.install.available();
  return card(['download', t('settings.install')],
    h('p', { text: t(canPrompt ? 'settings.installBody' : 'settings.installManual') }),
    canPrompt && h('button', { class: 'btn', type: 'button', on: { click: () => ctx.install.prompt() } }, t('settings.installBtn')));
}

function pinCard(ctx) {
  const current = h('input', { type: 'password', autocomplete: 'current-password', maxlength: 64, inputmode: ctx.prefs().numericPin ? 'numeric' : 'text' });
  const sf = secretFields('chg', 'settings.newPin');
  const err = formError();
  const btn = h('button', { class: 'btn', type: 'submit' }, t('settings.changePin'));

  async function onSubmit(e) {
    e.preventDefault();
    const problem = checkNewSecret(sf.pin.value, sf.confirm.value);
    if (problem) return showError(err, t(problem), sf.pin);
    const done = busy(btn, t('gate.working'));
    const ok = await vault.changeSecret(current.value, sf.pin.value);
    done();
    if (!ok) return showError(err, t('err.currentPin'), current);
    ctx.setPrefs({ numericPin: sf.isNumeric() });
    ctx.toast(t('settings.pinChanged'));
  }

  return h('section', { class: 'card' },
    h('details', {},
      h('summary', { text: t('settings.changePin') }),
      h('form', { novalidate: true, on: { submit: onSubmit } },
        field(t('settings.currentPin'), current),
        sf.nodes,
        err,
        btn)));
}

function backupCard(ctx) {
  const pass = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const err = formError();
  const btn = h('button', { class: 'btn', type: 'submit' }, t('backup.download'));

  async function onSubmit(e) {
    e.preventDefault();
    const problem = checkBackupPassword(pass.value, confirm.value);
    if (problem) return showError(err, t(problem), pass);
    const done = busy(btn, t('gate.working'));
    try {
      const json = await vault.exportBackup(pass.value);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = h('a', { href: url, download: `imali-backup-${todayISO()}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      pass.value = '';
      confirm.value = '';
      ctx.toast(t('backup.done'));
    } finally {
      done();
    }
  }

  return h('section', { class: 'card' },
    h('details', {},
      h('summary', { text: t('backup.title') }),
      h('p', { text: t('backup.body') }),
      h('form', { novalidate: true, on: { submit: onSubmit } },
        field(t('backup.password'), pass, t('backup.passwordHint')),
        field(t('backup.confirm'), confirm),
        err,
        btn)));
}

function securityCard(ctx, p) {
  const lockSel = select(AUTO_LOCK_OPTIONS.map((m) => [m, t('settings.minutes', { n: m })]), p.autoLockMin, {
    on: { change: () => ctx.setPrefs({ autoLockMin: Number(lockSel.value) }) },
  });
  const graceSel = select(BG_GRACE_OPTIONS.map((s) => [s, s < 60 ? t('settings.seconds', { n: s }) : t('settings.minutes', { n: s / 60 })]), p.bgGraceSec, {
    on: { change: () => ctx.setPrefs({ bgGraceSec: Number(graceSel.value) }) },
  });
  const wipe = h('input', {
    type: 'checkbox',
    on: {
      change: async () => {
        await vault.setWipeOnFails(wipe.checked);
        ctx.toast(t('settings.saved'));
      },
    },
  });
  vault.getMeta().then((m) => { wipe.checked = m.wipeOnFails; });
  return card(t('settings.security'),
    field(t('settings.autoLock'), lockSel, t('settings.autoLockHint')),
    field(t('settings.bgGrace'), graceSel, t('settings.bgGraceHint')),
    checkRow(wipe, t('settings.wipe', { n: vault.WIPE_AFTER })),
    h('button', { class: 'btn secondary', type: 'button', on: { click: ctx.lock } }, t('action.lock')));
}

function dangerCard(ctx) {
  const erase = async () => {
    if (!(await ctx.confirm(t('settings.eraseConfirm'), { danger: true, ok: t('settings.eraseBtn') }))) return;
    await vault.wipe();
    ctx.restart();
  };
  return h('section', { class: 'card danger-zone' },
    h('h2', { text: t('settings.erase') }),
    h('p', { text: t('settings.eraseBody') }),
    h('button', { class: 'btn danger', type: 'button', on: { click: erase } }, t('settings.eraseBtn')));
}
