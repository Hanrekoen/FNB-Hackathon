// Copies only the files the app needs into dist/, ready to upload to any static host.
// Usage: npm run build

import { cpSync, rmSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', '_headers', 'css', 'js', 'icons'];

rmSync(dist, { recursive: true, force: true });
for (const f of FILES) cpSync(new URL(f, root), new URL(f, dist), { recursive: true });
console.log('Built dist/ - upload this folder to your host.');
