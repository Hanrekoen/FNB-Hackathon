// Offline-first service worker: the whole app is cached on first visit, so it opens with
// no signal and uses no data afterwards. Bump VERSION whenever any app file changes.

const VERSION = 'imali-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/dom.js',
  './js/i18n.js',
  './js/idb.js',
  './js/prefs.js',
  './js/vault.js',
  './js/core/budget.js',
  './js/core/buckets.js',
  './js/core/categories.js',
  './js/core/credit.js',
  './js/core/crypto.js',
  './js/core/dates.js',
  './js/core/demo.js',
  './js/core/forecast.js',
  './js/core/income.js',
  './js/core/money.js',
  './js/core/scam.js',
  './js/core/schema.js',
  './js/core/security.js',
  './js/lang/af.js',
  './js/lang/en.js',
  './js/lang/zu.js',
  './js/views/budget.js',
  './js/views/credit.js',
  './js/views/example.js',
  './js/views/gate.js',
  './js/views/home.js',
  './js/views/profile.js',
  './js/views/savings.js',
  './js/views/scams.js',
  './js/views/settings.js',
  './js/views/ui.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only ever serve this app's own files; anything else is not handled.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((r) => r || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((r) => r || fetch(request)));
});
