// Inline SVG icons (Lucide, see icon-data.js), built with DOM calls so no markup is ever parsed
// and nothing is fetched. Icons are decorative unless given a label.

import { ICON_DATA } from './icon-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const hasIcon = (name) => Object.hasOwn(ICON_DATA, name);

export function icon(name, { label = null, cls = '' } = {}) {
  if (!hasIcon(name)) throw new Error(`Unknown icon: ${name}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('focusable', 'false');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, attrs] of ICON_DATA[name]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
