// Copies only the files the app needs into dist/, ready to upload to any static host.
// Usage: npm run build
//
// The service worker serves its cached copy first, so installed apps only update when the
// cache VERSION in sw.js changes. Forgetting to bump it by hand left phones on old code, so
// the build stamps dist/sw.js with a fingerprint of every app file: any change, new version.

import { createHash } from 'node:crypto';
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', '_headers', 'css', 'js', 'icons'];

rmSync(dist, { recursive: true, force: true });
for (const f of FILES) cpSync(new URL(f, root), new URL(f, dist), { recursive: true });

/** Every file under dist/ except sw.js itself, in a stable order. */
function files(dir = dist, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => {
    const url = new URL(name, dir);
    return statSync(url).isDirectory() ? files(new URL(`${name}/`, dir), `${prefix}${name}/`) : [`${prefix}${name}`];
  }).filter((f) => f !== 'sw.js');
}

const hash = createHash('sha256');
for (const f of files()) hash.update(f).update(readFileSync(new URL(f, dist)));
const fingerprint = hash.digest('hex').slice(0, 10);

const swUrl = new URL('sw.js', dist);
const sw = readFileSync(swUrl, 'utf8');
const stamped = sw.replace(/const VERSION = '([^']+)';/, (_, v) => `const VERSION = '${v}-${fingerprint}';`);
if (stamped === sw) throw new Error('Could not find VERSION in sw.js');
writeFileSync(swUrl, stamped);

console.log(`Built dist/ (cache version ${stamped.match(/const VERSION = '([^']+)'/)[1]}) - upload this folder to your host.`);
