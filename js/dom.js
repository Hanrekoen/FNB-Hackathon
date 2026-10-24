// Safe DOM builder. Text is always inserted as text nodes, never parsed as HTML, so user
// input (names, notes, pasted messages) can't inject markup or script. The page's CSP also
// enforces Trusted Types, which makes innerHTML-style sinks throw.

const BLOCKED_ATTR = /^(on|style$|srcdoc$|formaction$|action$)/i;
// In-app links, downloads, and tap-to-call links to fixed numbers (digits only).
const SAFE_URL = /^(#|\.\/|blob:|tel:\+?\d{3,15}$)/;

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else {
      if (BLOCKED_ATTR.test(k)) throw new Error(`Blocked attribute: ${k}`);
      if ((k === 'href' || k === 'src') && !SAFE_URL.test(String(v))) throw new Error(`Blocked URL: ${v}`);
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
