// Line icons drawn as inline SVG, so they follow the text colour (dark and high-contrast modes
// included) and render the same on every phone, unlike emoji. Shapes are adapted from Lucide
// (lucide.dev, ISC licence). Built with createElementNS: no HTML parsing, Trusted Types safe.

const NS = 'http://www.w3.org/2000/svg';
const circle = (cx, cy, r) => ['circle', { cx, cy, r }];
const path = (d) => ['path', { d }];
const rect = (x, y, width, height, rx = 2) => ['rect', { x, y, width, height, rx }];
const SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';

const SHAPES = {
  home: [path('m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'), path('M9 22V12h6v10')],
  money: [rect(2, 6, 20, 12), circle(12, 12, 2), path('M6 12h.01M18 12h.01')],
  piggy: [
    path('M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z'),
    path('M2 9v1c0 1.1.9 2 2 2h1'),
    path('M16 11h.01'),
  ],
  card: [rect(2, 5, 20, 14), path('M2 10h20')],
  shield: [path(SHIELD)],
  shieldCheck: [path(SHIELD), path('m9 12 2 2 4-4')],
  settings: [path('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'), path('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z')],
  lock: [rect(3, 11, 18, 11), path('M7 11V7a5 5 0 0 1 10 0v4')],
  trash: [path('M3 6h18'), path('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'), path('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'), path('M10 11v6M14 11v6')],
  plus: [path('M12 5v14M5 12h14')],
  minus: [path('M5 12h14')],
  undo: [path('M9 14 4 9l5-5'), path('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  arrowRight: [path('M5 12h14'), path('m12 5 7 7-7 7')],
  bulb: [path('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'), path('M9 18h6M10 22h4')],
  check: [circle(12, 12, 10), path('m9 12 2 2 4-4')],
  alert: [path('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z'), path('M12 9v4M12 17h.01')],
  stop: [circle(12, 12, 10), path('m15 9-6 6M9 9l6 6')],
  info: [circle(12, 12, 10), path('M12 16v-4M12 8h.01')],
  flag: [path('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z'), path('M4 22v-7')],
  scale: [path('M12 3v18M7 21h10M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'), path('m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z'), path('m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z')],
  lifebuoy: [circle(12, 12, 10), circle(12, 12, 4), path('m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24')],
  quiz: [circle(12, 12, 10), path('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), path('M12 17h.01')],
  download: [path('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), path('m7 10 5 5 5-5'), path('M12 15V3')],
  trend: [path('M22 7 13.5 15.5 8.5 10.5 2 17'), path('M16 7h6v6')],
  globe: [circle(12, 12, 10), path('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'), path('M2 12h20')],
  target: [circle(12, 12, 10), circle(12, 12, 6), circle(12, 12, 2)],
  calendar: [rect(3, 4, 18, 18), path('M16 2v4M8 2v4M3 10h18')],
  party: [path('M5.8 11.3 2 22l10.7-3.79'), path('M4 3h.01M22 8h.01M15 2h.01M22 20h.01'), path('m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10'), path('m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17'), path('m11 2 .33.82c.34.86-.2 1.82-1.11 1.98-.7.1-1.22.72-1.22 1.43V7'), path('M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2z')],
  // Scam check
  search: [circle(11, 11, 8), path('m21 21-4.3-4.3')],
  paste: [path('M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z'), path('M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2M16 4h2a2 2 0 0 1 2 2v2M11 14h10'), path('m17 10 4 4-4 4')],
  shuffle: [path('M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22'), path('m18 2 4 4-4 4'), path('M2 6h1.9c1.5 0 2.9.9 3.6 2.2'), path('M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8'), path('m18 14 4 4-4 4')],
  phone: [path('M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z')],
  mail: [rect(2, 4, 20, 16), path('m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7')],
  speaker: [path('M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z'), path('M16 9a5 5 0 0 1 0 6'), path('M19.364 18.364a9 9 0 0 0 0-12.728')],
  bookmark: [path('m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z')],
  history: [path('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), path('M3 3v5h5'), path('M12 7v5l4 2')],
  learn: [path('M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z'), path('M22 10v6'), path('M6 12.5V16a6 3 0 0 0 12 0v-3.5')],
  message: [path('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), path('M12 7v2'), path('M12 13h.01')],
};

export const ICON_NAMES = Object.keys(SHAPES);

/** An icon element. Decorative by default (hidden from screen readers); pass `label` when it carries meaning alone. */
export function icon(name, { label = null, cls = '' } = {}) {
  const shapes = SHAPES[name];
  if (!shapes) throw new Error(`Unknown icon: ${name}`);
  const svg = document.createElementNS(NS, 'svg');
  const attrs = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false', class: `icon ${cls}`.trim(),
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, props] of shapes) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(props)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
