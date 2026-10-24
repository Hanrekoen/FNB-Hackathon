// Project-wide checks: translations complete, offline cache complete, no unsafe DOM APIs.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import af from '../js/lang/af.js';
import en from '../js/lang/en.js';
import zu from '../js/lang/zu.js';
import { COMBO_IDS, RULE_IDS } from '../js/core/scam.js';
import { ICONS, IN_CATS, OUT_CATS } from '../js/core/categories.js';
import { PATTERNS } from '../js/core/income.js';
import { ICON_DATA } from '../js/icon-data.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const walk = (dir) => readdirSync(new URL(dir, ROOT), { recursive: true })
  .map((f) => `${dir}/${f.replaceAll('\\', '/')}`)
  .filter((f) => /\.\w+$/.test(f));
const sources = walk('js').filter((f) => f.endsWith('.js') && !f.includes('/lang/'));

function usedKeys() {
  const keys = new Set([
    ...IN_CATS.map((c) => `cat.${c}`),
    ...OUT_CATS.map((c) => `cat.${c}`),
    ...RULE_IDS.flatMap((id) => [`scam.r.${id}`, `scam.ex.${id}`]),
    ...COMBO_IDS.map((id) => `scam.c.${id}`),
    ...['stop', 'secret', 'remote', 'mule', 'noPay', 'official', 'family', 'loan', 'sars', 'sassa', 'report'].map((k) => `scam.step.${k}`),
    'tx.correction',
    ...PATTERNS.map((p) => `income.pattern.${p}`),
    ...['monthly', 'weekly', 'once'].map((f) => `bills.freq.${f}`),
    ...['needs', 'safety', 'free'].map((b) => `bucket.${b}`),
    ...['home', 'money', 'save', 'credit', 'scams', 'settings', 'profile'].map((r) => `nav.${r}`),
  ]);
  for (const level of ['none', 'low', 'medium', 'high']) keys.add(`scam.level.${level}`).add(`scam.advice.${level}`);
  for (const level of ['ok', 'caution', 'danger']) keys.add(`credit.level.${level}`);
  for (const n of [1, 2, 3, 4]) for (const p of ['q', 'a', 'b', 'why']) keys.add(`quiz.${n}.${p}`);
  for (const f of [...sources, 'js/core/security.js', 'js/core/credit.js']) {
    const s = read(f);
    for (const m of s.matchAll(/\b(?:t|list)\(\s*'([\w.]+)'/g)) keys.add(m[1]);
    for (const m of s.matchAll(/'((?:err|credit\.r|nav)\.\w+)'/g)) keys.add(m[1]);
  }
  return keys;
}

test('every translation key used in code exists in English', () => {
  const missing = [...usedKeys()].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});

for (const [name, dict] of Object.entries({ af, zu })) {
  test(`${name} translation has every English key with matching placeholders`, () => {
    const missing = Object.keys(en).filter((k) => !(k in dict));
    assert.deepEqual(missing, [], `missing in ${name}`);
    for (const [k, v] of Object.entries(en)) {
      if (typeof v === 'string') {
        const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        assert.deepEqual(ph(dict[k]), ph(v), `placeholders differ for ${k} in ${name}`);
      } else {
        assert.ok(Array.isArray(dict[k]) && dict[k].length === v.length, `list ${k} in ${name}`);
      }
    }
  });
}

test('bucket wording never implies the bank has locked or frozen money', () => {
  const guarded = /^(bucket|needs|alloc|safety|demo)\.|^tx\.(needs|release)$/;
  for (const [name, dict] of Object.entries({ en, af, zu })) {
    for (const [k, v] of Object.entries(dict)) {
      if (guarded.test(k)) assert.doesNotMatch(v, /frozen|locked|bevrie|gesluit|kukhiyiwe|iqandisiwe/i, `${name} ${k}`);
    }
  }
});

test('no emoji anywhere in the app: icons come from js/icon-data.js', () => {
  const emoji = /[\p{Extended_Pictographic}\u{FE0F}]/u;
  for (const f of [...walk('js').filter((x) => x.endsWith('.js')), 'css/app.css', 'index.html', 'manifest.webmanifest']) {
    read(f).split('\n').forEach((line, i) => assert.doesNotMatch(line, emoji, `${f}:${i + 1}`));
  }
});

test('every icon used in the code exists', () => {
  const used = new Set(Object.values(ICONS));
  for (const f of sources) {
    const s = read(f);
    for (const m of s.matchAll(/\bicon\(\s*'([\w-]+)'/g)) used.add(m[1]);
    // card(['name', t(...)]) and heading('h2', ['name', t(...)])
    for (const m of s.matchAll(/\b(?:card|heading)\(\s*(?:'h\d',\s*)?\['([\w-]+)',/g)) used.add(m[1]);
    const tabs = s.match(/const TABS = \[([\s\S]*?)\];/);
    if (tabs) for (const m of tabs[1].matchAll(/\['\w+', '([\w-]+)'\]/g)) used.add(m[1]);
    const levels = s.match(/const LEVEL_ICON = (\{.*\});/);
    if (levels) for (const m of levels[1].matchAll(/:\s*\[?'([\w-]+)'/g)) used.add(m[1]);
    // Goal status: [cssClass, iconName] pairs
    const status = s.match(/const STATUS = \{([\s\S]*?)\};/);
    if (status) for (const m of status[1].matchAll(/\['\w+', '([\w-]+)'\]/g)) used.add(m[1]);
  }
  assert.ok(used.size > 30, `only found ${used.size} icon names`);
  assert.deepEqual([...used].filter((n) => !(n in ICON_DATA)), []);
});

test('service worker precaches every app file', () => {
  const sw = read('sw.js');
  const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
  const required = ['index.html', 'manifest.webmanifest', ...walk('js'), ...walk('css'), ...walk('icons')];
  assert.deepEqual(required.filter((f) => !listed.has(f)), []);
  assert.deepEqual([...listed].filter((f) => f && !required.includes(f)), [], 'stale entries in sw.js');
});

test('no unsafe HTML or code-evaluation APIs are used', () => {
  const banned = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setTimeout\(\s*['"`]/;
  for (const f of [...sources, 'sw.js']) assert.doesNotMatch(read(f), banned, f);
});

test('CSP is strict and identical in the page, dev server and hosting headers', () => {
  const meta = read('index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const directive of ["default-src 'none'", "script-src 'self'", "require-trusted-types-for 'script'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(meta.includes(directive), directive);
  }
  assert.doesNotMatch(meta, /unsafe-inline|unsafe-eval|\*/);
  // Headers add frame-ancestors, which browsers ignore in a <meta> tag.
  const full = `${meta}; frame-ancestors 'none'`;
  assert.ok(read('_headers').includes(full), '_headers CSP');
  assert.ok(read('scripts/serve.mjs').includes(full), 'serve.mjs CSP');
});
