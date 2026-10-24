// Text preparation for the scam checker. Every prepared string keeps a map back to the
// original message, so matches can be highlighted in exactly what the user pasted.
// All patterns use bounded repetition only, so no input can make them hang (ReDoS).

export const MAX_LEN = 5000;

const INVISIBLE = /[­​-‏⁠-⁤﻿]/;
const QUOTES = /[‘’ʼ`´]/g;

/**
 * Lower-cased, NFKC-normalised text with invisible characters removed and runs of whitespace
 * collapsed. Returns { s, from, to }: for each code unit of `s`, the range it came from in the
 * original text.
 */
export function prepare(text) {
  const src = String(text).slice(0, MAX_LEN);
  let s = '';
  const from = [];
  const to = [];
  let lastWasSpace = true;
  for (let i = 0; i < src.length;) {
    const len = src.codePointAt(i) > 0xffff ? 2 : 1;
    const ch = src.slice(i, i + len);
    let out = INVISIBLE.test(ch) ? '' : ch.normalize('NFKC').toLowerCase().replace(QUOTES, "'");
    if (/^\s+$/.test(out)) out = lastWasSpace ? '' : ' ';
    for (let k = 0; k < out.length; k++) {
      from.push(i);
      to.push(i + len);
    }
    s += out;
    if (out) lastWasSpace = out === ' ';
    i += len;
  }
  return { s, from, to };
}

// Single characters split up by spaces or dots ("o t p", "P.I.N"): 3 to 16 of them. No
// lookbehind (older iPhones can't parse it), so group 1 captures the character before.
const SPACED = /(^|[^\p{L}\p{N}])((?:[\p{L}\p{N}@$][ .\-_*|]){2,15}[\p{L}\p{N}@$])(?![\p{L}\p{N}])/gu;
const SEPARATOR = /[ .\-_*|]/;
// Look-alike digits and symbols, only swapped inside words that also contain letters.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };
const TOKEN = /[\p{L}\p{N}@$!|]{2,40}/gu;
// Rand amounts and units ("r349", "24h", "4g", "10am") are real numbers, not disguised letters.
const NUMBER_TOKEN = /^(r\d[\d.,]*|\d+(st|nd|rd|th|am|pm|h|hr|hrs|min|mins|gb|mb|kb|g|km|kg|kwh|x))$/;

function rebuild(p, keep) {
  const out = { s: '', from: [], to: [] };
  for (let i = 0; i < p.s.length; i++) {
    if (!keep[i]) continue;
    out.s += p.s[i];
    out.from.push(p.from[i]);
    out.to.push(p.to[i]);
  }
  return out;
}

/** Undoes common disguises ("0TP", "O.T.P", "p1n", "f33") in a prepared text. */
export function deobfuscate(p) {
  const keep = Array(p.s.length).fill(true);
  for (const m of p.s.matchAll(SPACED)) {
    const start = m.index + m[1].length;
    for (let i = start; i < start + m[2].length; i++) if (SEPARATOR.test(p.s[i])) keep[i] = false;
  }
  const joined = rebuild(p, keep);
  const units = joined.s.split('');
  for (const m of joined.s.matchAll(TOKEN)) {
    if (!/\p{L}/u.test(m[0]) || !/[\d@$!|]/.test(m[0]) || NUMBER_TOKEN.test(m[0])) continue;
    for (let i = m.index; i < m.index + m[0].length; i++) units[i] = LEET[units[i]] ?? units[i];
  }
  return { ...joined, s: units.join('') };
}

/** The original-text range covered by prepared characters [start, end). */
export const spanOf = (p, start, end) => ({ start: p.from[start], end: p.to[end - 1] });
