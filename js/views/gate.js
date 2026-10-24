// Screens shown while the vault is locked: first-time setup, restore, and unlock.

import { checkNewSecret } from '../core/security.js';
import { h } from '../dom.js';
import { LANGS, getLang, list, t } from '../i18n.js';
import * as vault from '../vault.js';
import { bulletList, busy, checkRow, field, formError, showError } from './ui.js';

const MAX_BACKUP_BYTES = 8_000_000;

/** New PIN + confirm, with options to allow letters and to show what's typed. */
export function secretFields(prefix, labelKey = 'gate.newPin') {
  const attrs = { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 64 };
  const pin = h('input', { ...attrs, id: `${prefix}-pin` });
  const confirm = h('input', { ...attrs, id: `${prefix}-pin2` });
  const letters = h('input', {
    type: 'checkbox',
    on: { change: () => [pin, confirm].forEach((el) => el.setAttribute('inputmode', letters.checked ? 'text' : 'numeric')) },
  });
  const show = h('input', {
    type: 'checkbox',
    on: { change: () => [pin, confirm].forEach((el) => { el.type = show.checked ? 'text' : 'password'; }) },
  });
  return {
    pin,
    confirm,
    isNumeric: () => /^\d+$/.test(pin.value),
    nodes: [
      field(t(labelKey), pin, t('gate.pinHint')),
      field(t('gate.confirmPin'), confirm),
      checkRow(letters, t('gate.letters')),
      checkRow(show, t('gate.show')),
    ],
  };
}

function langPicker(ctx) {
  const sel = h('select', { id: 'lang', on: { change: () => ctx.setLang(sel.value) } },
    LANGS.map((l) => h('option', { value: l.code, selected: l.code === getLang() }, l.name)));
  // Label is in all languages so someone can find it even if the wrong language is showing.
  return field('🌐 Language · Taal · Ulimi', sel);
}

function brand() {
  return h('div', { class: 'gate-brand' },
    h('img', { src: './icons/icon.svg', alt: '', width: 64, height: 64 }),
    h('h1', { tabindex: -1, text: 'Imali' }),
    h('p', { class: 'lead', text: t('gate.tagline') }));
}

export function onboarding(ctx) {
  const name = h('input', { id: 'ob-name', type: 'text', maxlength: 40, autocomplete: 'given-name' });
  const sf = secretFields('ob');
  const understand = h('input', { type: 'checkbox', id: 'ob-understand' });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, t('gate.create'));

  async function onSubmit(e) {
    e.preventDefault();
    const problem = checkNewSecret(sf.pin.value, sf.confirm.value);
    if (problem) return showError(err, t(problem), sf.pin);
    if (!understand.checked) return showError(err, t('err.understand'), understand);
    const done = busy(btn, t('gate.working'));
    try {
      await vault.create(sf.pin.value, vault.emptyData(name.value.trim().slice(0, 40)));
      ctx.savePrefs({ numericPin: sf.isNumeric() });
      ctx.unlocked({ firstRun: true });
    } catch {
      done();
      showError(err, t('err.generic'));
    }
  }

  return h('main', { id: 'main', class: 'gate' },
    brand(),
    langPicker(ctx),
    h('section', { class: 'card' }, h('h2', { text: t('gate.whatTitle') }), bulletList(list('gate.what'))),
    h('section', { class: 'card highlight' }, h('h2', { text: t('gate.privateTitle') }), h('p', { text: t('gate.privateBody') })),
    h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'ob-h', on: { submit: onSubmit } },
      h('h2', { id: 'ob-h', text: t('gate.setupTitle') }),
      field(t('gate.name'), name, t('gate.nameHint')),
      sf.nodes,
      checkRow(understand, t('gate.understand')),
      err,
      btn),
    restoreCard(ctx));
}

function restoreCard(ctx) {
  const file = h('input', { type: 'file', id: 'rs-file', accept: '.json,application/json' });
  const pass = h('input', { type: 'password', id: 'rs-pass', autocomplete: 'off', maxlength: 128 });
  const sf = secretFields('rs');
  const err = formError();
  const btn = h('button', { class: 'btn', type: 'submit' }, t('restore.btn'));

  async function onSubmit(e) {
    e.preventDefault();
    const f = file.files[0];
    if (!f || f.size > MAX_BACKUP_BYTES) return showError(err, t('restore.invalid'), file);
    const problem = checkNewSecret(sf.pin.value, sf.confirm.value);
    if (problem) return showError(err, t(problem), sf.pin);
    const done = busy(btn, t('gate.working'));
    const result = await vault.restoreBackup(await f.text(), pass.value, sf.pin.value).catch(() => 'invalid');
    done();
    if (result === 'invalid') return showError(err, t('restore.invalid'), file);
    if (result === 'wrongPassword') return showError(err, t('restore.wrong'), pass);
    ctx.savePrefs({ numericPin: sf.isNumeric() });
    ctx.unlocked();
  }

  return h('section', { class: 'card' },
    h('details', {},
      h('summary', { text: t('restore.title') }),
      h('form', { novalidate: true, on: { submit: onSubmit } },
        field(t('restore.file'), file),
        field(t('backup.password'), pass),
        sf.nodes,
        err,
        btn)));
}

export function unlockScreen(ctx) {
  const pin = h('input', {
    id: 'unlock-pin', type: 'password', autocomplete: 'current-password', maxlength: 64,
    inputmode: ctx.prefs().numericPin ? 'numeric' : 'text', autofocus: true,
  });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, t('gate.unlock'));
  let timer;

  function countdown(until) {
    clearInterval(timer);
    btn.disabled = true;
    const tick = () => {
      const secs = Math.ceil((until - Date.now()) / 1000);
      if (!btn.isConnected || secs <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        err.textContent = '';
        return;
      }
      err.textContent = t('gate.wait', { s: secs });
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!pin.value) return showError(err, t('err.pinEmpty'), pin);
    const done = busy(btn, t('gate.unlocking'));
    const res = await vault.unlock(pin.value);
    pin.value = '';
    done();
    if (res.ok) return ctx.unlocked();
    if (res.wiped) return ctx.restart(t('gate.wiped'));
    if (res.lockUntil > Date.now()) return countdown(res.lockUntil);
    const meta = await vault.getMeta();
    showError(err, meta.wipeOnFails ? t('gate.wrongWipe', { n: vault.WIPE_AFTER - res.fails }) : t('gate.wrong'), pin);
  }

  async function forget() {
    if (!(await ctx.confirm(t('settings.eraseConfirm'), { danger: true, ok: t('settings.eraseBtn') }))) return;
    await vault.wipe();
    ctx.restart();
  }

  vault.getMeta().then((m) => { if (m.lockUntil > Date.now()) countdown(m.lockUntil); });

  return h('main', { id: 'main', class: 'gate' },
    brand(),
    h('form', { class: 'card', novalidate: true, on: { submit: onSubmit } },
      field(t('gate.enterPin'), pin),
      err,
      btn),
    langPicker(ctx),
    h('section', { class: 'card' },
      h('details', {},
        h('summary', { text: t('gate.forgot') }),
        h('p', { text: t('gate.forgotBody') }),
        h('button', { class: 'btn danger', type: 'button', on: { click: forget } }, t('settings.eraseBtn')))));
}
