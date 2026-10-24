// Offline checks on links and phone numbers in a message: brand names in someone else's
// domain, look-alike domains, raw IP links and foreign numbers claiming to be local.
// Each finder returns match positions in the prepared text: [{ index, length }].

// Real domains of South African banks, government and big brands that scammers copy.
export const OFFICIAL_DOMAINS = [
  'fnb.co.za', 'absa.co.za', 'capitecbank.co.za', 'nedbank.co.za', 'standardbank.co.za', 'tymebank.co.za',
  'discovery.co.za', 'africanbank.co.za', 'investec.com', 'sars.gov.za', 'sassa.gov.za', 'gov.za', 'saps.gov.za',
  'postoffice.co.za', 'eskom.co.za', 'vodacom.co.za', 'mtn.co.za', 'telkom.co.za', 'cellc.co.za',
  'telkomsa.net', 'mtn.com', 'takealot.com', 'ncr.org.za', 'sabric.co.za', 'safps.org.za',
];
// Brand names that only belong in their own domain. Long ones are flagged anywhere in a
// domain word; short ones only at its start or end ("fnbsecure", "myabsa"), since "saps" or
// "absa" can hide inside ordinary words.
const LONG_BRANDS = ['capitec', 'nedbank', 'standardbank', 'tymebank', 'africanbank', 'investec', 'sassa', 'postoffice', 'eskom', 'vodacom', 'telkom', 'takealot'];
const SHORT_BRANDS = ['fnb', 'absa', 'sars', 'saps'];
const EXACT_BRANDS = ['mtn', 'discovery'];

const brandIn = (w) => LONG_BRANDS.some((b) => w.includes(b))
  || SHORT_BRANDS.some((b) => w.startsWith(b) || w.endsWith(b))
  || EXACT_BRANDS.includes(w);

const DOMAIN = /(?:[\p{L}\p{N}-]{1,63}\.){1,6}[\p{L}]{2,24}(?![\p{L}\p{N}-])/gu;
const IP_LINK = /\bhttps?:\/\/\d{1,3}(?:\.\d{1,3}){3}\b/g;
const NUMBER = /(?:\+|\b00)\d{1,3}[\d ()-]{6,16}\d/g;
const BRAND_WORD = /\b(bank|fnb|absa|capitec|nedbank|standard bank|tyme ?bank|sars|sassa|saps|police|post office|eskom|vodacom|mtn|telkom)\b/;

const isOfficial = (d) => OFFICIAL_DOMAINS.some((o) => d === o || d.endsWith(`.${o}`));
const tail = (d, labels) => d.split('.').slice(-labels).join('.');

/** Levenshtein distance, stopping early once it is past `max`. */
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...row) > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Why a domain looks fake, or null: 'unicode', 'brand' or 'lookalike'. */
export function domainProblem(raw) {
  const d = raw.replace(/^www\./, '');
  if (isOfficial(d)) return null;
  if (d.includes('xn--') || /[^\x00-\x7f]/.test(d)) return 'unicode';
  const words = d.split(/[.-]/);
  if (words.some(brandIn)) return 'brand';
  if (d.includes('gov.za')) return 'brand';
  for (const o of OFFICIAL_DOMAINS) {
    const labels = o.split('.').length;
    if (d.split('.').length >= labels && distance(tail(d, labels), o) <= (o.length > 10 ? 2 : 1)) return 'lookalike';
  }
  return null;
}

const all = (re, s) => [...s.matchAll(re)].slice(0, 20).map((m) => ({ index: m.index, length: m[0].length }));

export const findFakeDomains = (s) => [...s.matchAll(DOMAIN)].slice(0, 20)
  .filter((m) => domainProblem(m[0]))
  .map((m) => ({ index: m.index, length: m[0].length }));

export const findIpLinks = (s) => all(IP_LINK, s);

/** International numbers (not +27) in a message that also names a bank or government body. */
export const findForeignNumbers = (s) => (BRAND_WORD.test(s)
  ? all(NUMBER, s).filter((m) => !/^(\+|00)27/.test(s.slice(m.index, m.index + 4)))
  : []);
