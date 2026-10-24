import { settleReleases } from './core/buckets.js';
import { todayISO } from './core/dates.js';
import { formatMoney } from './core/money.js';
import { MAX_LEN } from './core/scam.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { locale, t } from './i18n.js';
import { icon } from './icons.js';
import { applyPrefs, loadPrefs, savePrefs } from './prefs.js';
import * as vault from './vault.js';
import * as budget from './views/budget.js';
import * as credit from './views/credit.js';
import { onboarding, unlockScreen } from './views/gate.js';
import * as home from './views/home.js';
import * as profile from './views/profile.js';
import * as savings from './views/savings.js';
import * as scams from './views/scams.js';
import * as settings from './views/settings.js';

const ROUTES = { home, money: budget, save: savings, credit, scams, settings, profile };
const TABS = [
  ['home', 'home'],
  ['money', 'money'],
  ['save', 'piggy'],
  ['credit', 'card'],
  ['scams', 'shield'],
];

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');
let prefs = loadPrefs();
let lastActivity = Date.now();
let hiddenAt = 0;
let installEvent = null;

// ---------- shared helpers given to views ----------

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4000);
}

function confirmDialog(message, { ok = t('action.ok'), cancel = t('action.cancel'), danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (value) => dlg.close(value);
    const dlg = h('dialog', { class: 'dialog', 'aria-describedby': 'dlg-msg' },
      h('p', { id: 'dlg-msg', text: message }),
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn secondary', on: { click: () => close('cancel') } }, cancel),
        h('button', { type: 'button', class: `btn ${danger ? 'danger' : ''}`, on: { click: () => close('ok') } }, ok)));
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Like confirmDialog, with several labelled choices. Resolves to the chosen value, or '' if dismissed. */
function chooseDialog(message, choices) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-describedby': 'dlg-msg' },
      h('p', { id: 'dlg-msg', text: message }),
      h('div', { class: 'row end' }, choices.map((c) => h('button', {
        type: 'button', class: `btn ${c.secondary ? 'secondary' : ''}`, on: { click: () => dlg.close(c.value) },
      }, c.label))));
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue);
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  savePrefs(prefs);
  const langChanged = 'lang' in patch;
  applyPrefs(prefs);
  if (langChanged) vault.isUnlocked() ? renderShell() : showGate();
}

const ctx = {
  get data() { return vault.getData(); },
  flash: {},
  prefs: () => prefs,
  setPrefs,
  toast,
  confirm: confirmDialog,
  choose: chooseDialog,
  lock: () => lockApp(),
  restart: (message) => { lockApp(); if (message) toast(message); },
  install: {
    available: () => installEvent !== null,
    installed: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    async prompt() {
      if (!installEvent) return;
      installEvent.prompt();
      await installEvent.userChoice;
      installEvent = null;
      renderView(false);
    },
  },
  /** Apply a change to the data, encrypt + save it, then re-render. */
  async commit(mutate, message, focusSelector) {
    mutate(vault.getData());
    try {
      await vault.save();
      if (message) toast(message);
    } catch {
      toast(t('err.save'));
    }
    renderView(false);
    if (focusSelector) {
      const el = document.querySelector(focusSelector);
      el?.focus();
      el?.scrollIntoView({ block: 'start' });
    }
  },
};

const gateCtx = {
  prefs: () => prefs,
  setLang: (lang) => setPrefs({ lang }),
  savePrefs: (patch) => { prefs = { ...prefs, ...patch }; savePrefs(prefs); },
  confirm: confirmDialog,
  toast,
  unlocked: ({ firstRun = false } = {}) => {
    lastActivity = Date.now();
    if (firstRun) {
      ctx.flash.onboarding = true;
      history.replaceState(null, '', '#/profile');
    }
    renderShell();
  },
  restart: ctx.restart,
};

// ---------- rendering ----------

function route() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/');
  return ROUTES[name] ? { name, args } : { name: 'home', args: [] };
}

async function showGate() {
  const exists = await vault.hasVault();
  root.replaceChildren(exists ? unlockScreen(gateCtx) : onboarding(gateCtx));
  document.title = 'Imali';
  (root.querySelector('#unlock-pin') ?? root.querySelector('h1'))?.focus();
}

function renderShell() {
  const nav = h('nav', { class: 'tabbar', 'aria-label': t('nav.label') },
    TABS.map(([name, iconName]) => h('a', { href: `#/${name}`, 'data-tab': name },
      h('span', { class: 'tab-icon' }, icon(iconName)),
      h('span', { class: 'tab-label', text: t(`nav.${name}`) }))));
  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/home' }, h('img', { src: './icons/icon.svg', alt: '', width: 28, height: 28 }), 'Imali'),
      h('div', { class: 'row' },
        h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': t('nav.settings') }, icon('settings')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('action.lock'), on: { click: () => lockApp() } },
          icon('lock')))),
    h('main', { id: 'main' }),
    nav);
  renderView(true);
}

function renderView(isNavigation) {
  const main = document.getElementById('main');
  if (!vault.isUnlocked() || !root.querySelector('.tabbar')) return;
  settleDueReleases();
  const r = route();
  const y = window.scrollY;
  const banner = vault.getData().demo && h('p', { class: 'demo-banner', role: 'note', text: t('demo.banner') });
  main.replaceChildren(...[banner, ROUTES[r.name].render(ctx, r.args)].filter(Boolean));
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === r.name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${t(`nav.${r.name}`)} · Imali`;
  if (isNavigation) {
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({ preventScroll: true });
  } else {
    window.scrollTo(0, y);
  }
}

/** Needs releases whose notice has ended move to free money; there are no background jobs, so check on every render. */
function settleDueReleases() {
  const released = settleReleases(vault.getData(), Date.now(), todayISO());
  if (!released.length) return;
  vault.save().catch(() => toast(t('err.save')));
  const amount = released.reduce((a, r) => a + r.amount, 0);
  toast(t('needs.released', { amount: formatMoney(amount, locale()) }));
}

function lockApp() {
  vault.lock();
  ctx.flash = {};
  for (const d of document.querySelectorAll('dialog')) d.remove();
  showGate();
}

// ---------- security behaviours ----------

function watchActivity() {
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
    addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
  }
  setInterval(() => {
    if (vault.isUnlocked() && Date.now() - lastActivity > prefs.autoLockMin * 60_000) lockApp();
  }, 10_000);

  // Blur content when the app goes to the background (hides it in the app switcher on most
  // phones) and lock if it stayed away too long.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      document.documentElement.classList.add('privacy');
    } else {
      document.documentElement.classList.remove('privacy');
      if (vault.isUnlocked() && Date.now() - hiddenAt > prefs.bgGraceSec * 1000) lockApp();
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // The CSP enforces Trusted Types, so script URLs must pass through this allow-list policy.
  const policy = window.trustedTypes?.createPolicy('imali', {
    createScriptURL: (url) => {
      if (url === './sw.js') return url;
      throw new TypeError(`Blocked script URL: ${url}`);
    },
  });
  navigator.serviceWorker.register(policy ? policy.createScriptURL('./sw.js') : './sw.js', { scope: './' }).catch(() => {});
}

function unsupported() {
  root.replaceChildren(h('main', { id: 'main', class: 'gate' },
    h('h1', { text: 'Imali' }),
    h('p', { class: 'alert danger', text: t('err.insecure') })));
}

/**
 * A message shared to Imali from another app (Web Share Target) arrives in the URL. Take it
 * out at once so it isn't kept in browser history, and check it once the app is unlocked.
 */
function takeSharedText() {
  if (!location.search) return;
  const q = new URLSearchParams(location.search);
  const text = ['title', 'text', 'url'].map((k) => q.get(k)).filter(Boolean).join('\n').trim();
  history.replaceState(null, '', `${location.pathname}${text ? '#/scams' : location.hash}`);
  if (text) ctx.flash.scam = { text: text.slice(0, MAX_LEN) };
}

// ---------- start ----------

function start() {
  applyPrefs(prefs);
  if (!window.isSecureContext || !crypto?.subtle || !window.indexedDB) return unsupported();
  takeSharedText();
  registerServiceWorker();
  navigator.storage?.persist?.().catch(() => {});
  watchActivity();
  addEventListener('hashchange', () => renderView(true));
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
  });
  showGate();
}

start();
