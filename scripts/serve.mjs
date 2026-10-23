// Zero-dependency static server for local development, sending the same security headers
// as production. Usage: node scripts/serve.mjs   (PORT and HOST env vars are optional)

import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

// Only the app itself is served: never tests, scripts, .git, etc.
const PUBLIC = /^\/(index\.html|manifest\.webmanifest|sw\.js|(css|js|icons)\/[\w./-]+)$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types imali; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cache-Control': 'no-cache',
};

const server = http.createServer(async (req, res) => {
  const send = (status, body = '', type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': type });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(400, 'Bad request');
  }
  if (pathname === '/') pathname = '/index.html';
  if (!PUBLIC.test(pathname) || pathname.includes('..')) return send(404, 'Not found');

  const file = path.resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(ROOT + path.sep)) return send(404, 'Not found');
  try {
    send(200, await readFile(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
  } catch {
    send(404, 'Not found');
  }
});

server.listen(PORT, HOST, () => console.log(`Imali running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
