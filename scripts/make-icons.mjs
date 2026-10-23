// Generates the PNG app icons (same design as icons/icon.svg) with no dependencies.
// Usage: node scripts/make-icons.mjs

import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const BG = [0x0a, 0x6e, 0x6e];
const COIN = [0xf5, 0xa6, 0x23];
const RING = [0xc9, 0x7d, 0x06];
const WHITE = [0xff, 0xff, 0xff];

// Shapes in a 512-unit design space, painted in order (later shapes on top).
function colorAt(x, y, { rounded, scale }) {
  const c = 256;
  const ux = (x - c) / scale + c;
  const uy = (y - c) / scale + c;
  let color = null;
  if (!rounded || insideRoundRect(x, y, 0, 0, 512, 512, 112)) color = BG;
  const d = Math.hypot(ux - c, uy - c);
  if (d <= 160) color = COIN;
  if (Math.abs(d - 118) <= 9) color = RING;
  if (insideRoundRect(ux, uy, 236, 176, 40, 160, 20)) color = WHITE;
  return color;
}

function insideRoundRect(x, y, rx, ry, w, h, r) {
  const cx = Math.max(rx + r, Math.min(x, rx + w - r));
  const cy = Math.max(ry + r, Math.min(y, ry + h - r));
  return x >= rx && x <= rx + w && y >= ry && y <= ry + h && Math.hypot(x - cx, y - cy) <= r;
}

function render(size, opts) {
  const SS = 4; // 4x4 supersampling for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const col = colorAt(((px + (sx + 0.5) / SS) * 512) / size, ((py + (sy + 0.5) / SS) * 512) / size, opts);
          if (!col) continue;
          acc[0] += col[0];
          acc[1] += col[1];
          acc[2] += col[2];
          acc[3] += 255;
        }
      }
      const n = SS * SS;
      const covered = acc[3] / 255;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = covered ? Math.round(acc[0] / covered) : 0;
      raw[o + 1] = covered ? Math.round(acc[1] / covered) : 0;
      raw[o + 2] = covered ? Math.round(acc[2] / covered) : 0;
      raw[o + 3] = Math.round(acc[3] / n);
    }
  }
  return png(size, raw);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = (name) => new URL(`../icons/${name}`, import.meta.url);
writeFileSync(out('icon-192.png'), render(192, { rounded: true, scale: 1 }));
writeFileSync(out('icon-512.png'), render(512, { rounded: true, scale: 1 }));
// Maskable: full-bleed background, artwork inside the 80% safe zone.
writeFileSync(out('icon-maskable-512.png'), render(512, { rounded: false, scale: 0.8 }));
// iOS adds its own rounded corners and ignores transparency.
writeFileSync(out('apple-touch-icon.png'), render(180, { rounded: false, scale: 0.9 }));
console.log('Icons written to icons/');
