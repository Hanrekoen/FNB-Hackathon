// Offline scam-message checker. Rule-based so it works with no data, never sends the message
// anywhere, and can always explain itself. All patterns use bounded repetition only, so no
// input can make them hang (ReDoS).
//
// Rules are data. Each has patterns per language, and every language is checked whatever
// language the app is set to, since people get messages in more than one language. To add a
// language, add its key to `patterns`. isiZulu and Afrikaans wording needs native-speaker review.

import { findFakeDomains, findForeignNumbers, findIpLinks } from './scam-links.js';
import { MAX_LEN, deobfuscate, prepare, spanOf } from './scam-text.js';

export { MAX_LEN };
export const RULES_VERSION = '2026-10-24';

/** In long messages, only warning signs within this many characters of each other add up. */
export const WINDOW = 600;
const MAX_MATCHES = 5;

const AMOUNT = String.raw`r ?\d{1,3}[ ,]?\d{3}`;
const PHONE = String.raw`(?:\+|\b0)\d[\d -]{7,14}\d`;

const RULES = [
  {
    id: 'secret',
    weight: 3,
    negatable: true,
    patterns: {
      en: [
        /\b(send|share|give|confirm|provide|reply with|tell us|enter|verify|update|forward|read out)\b.{0,40}\b(otp|one[- ]?time[- ]?(pin|password)|pin|password|passcode|cvv|cvc|card (number|details)|login details|banking details|security code|verification code)\b/,
        /\b(otp|pin|password|cvv|verification code)\b.{0,30}\b(send|reply|share|give|forward)\b/,
      ],
      af: [
        /\b(stuur|gee|deel|bevestig|verskaf)\b.{0,40}\b(otp|pin|wagwoord|kaartbesonderhede|bankbesonderhede|eenmalige pin)\b/,
        /\b(otp|pin|wagwoord)\b.{0,30}\b(stuur|gee|deel)\b/,
      ],
      zu: [
        /(thumel|nik[ae]|yabelan|qinisekis|fak[ae])[a-z]{0,6}\b.{0,40}\b(i-?otp|i-?pin|iphini|iphasiwedi|inombolo yemfihlo|imininingwane yekhadi|imininingwane yasebhange)\b/,
        /\b(i-?otp|i-?pin|iphasiwedi)\b.{0,30}(thumel|nik[ae]|yabelan)/,
      ],
    },
  },
  {
    id: 'remote',
    weight: 3,
    negatable: true,
    patterns: {
      en: [/\b(anydesk|teamviewer|rustdesk|airdroid|quick ?support|screen ?shar(e|ing)|remote (access|control|support))\b/],
      af: [/\b(skerm deel|afstandtoegang|afstandbeheer)\b/],
      zu: [/(yabelan[ae] ngesikrini|fak[ae] (i-?)?anydesk|fak[ae] (i-?)?teamviewer)\b/],
    },
  },
  {
    id: 'upfront',
    weight: 3,
    patterns: {
      en: [
        /\b(pay|send|deposit|transfer)\b.{0,40}\b(fee|admin|processing|release|clearance|insurance|registration|delivery|customs|activation)\b/,
        /\b(upfront|up-front|advance fee)\b/,
      ],
      af: [/\b(betaal|stuur|deponeer)\b.{0,40}\b(fooi|administrasiefooi|registrasiefooi|vrystellingsfooi|kostes)\b/],
      zu: [
        /(khokh|thumel|fak)[a-z]{0,6}\b.{0,40}\b(imali yokukhulula|imali yokubhalisa|imali yokuphatha|inkokhelo yokuqala|imali yokulethwa)\b/,
        /\b(imali yokukhulula|imali yokubhalisa)\b/,
      ],
    },
  },
  {
    id: 'mule',
    weight: 3,
    patterns: {
      en: [
        /\b(receive|accept)\b.{0,30}\b(money|payment|funds)\b.{0,40}\b(send|transfer|forward|withdraw)\b/,
        /\b(use|borrow|rent)\b.{0,10}\byour (bank )?account\b/,
      ],
      af: [
        /\b(ontvang)\b.{0,30}\b(geld|betaling)\b.{0,40}\b(stuur|oordra|onttrek|oorplaas)\b/,
        /\b(gebruik|leen)\b.{0,10}\bjou (bank)?rekening\b/,
      ],
      zu: [
        /(amukel|thol)[a-z]{0,6}\b.{0,30}\bimali\b.{0,40}(thumel|khiph|dlulisel)/,
        /(sebenzis|bolek)[a-z]{0,6}\b.{0,15}\bi-?akhawunti yakho\b/,
      ],
    },
  },
  {
    id: 'prize',
    weight: 2,
    patterns: {
      // "Congratulations" alone is everyday (a new baby, a new job), so it only counts near a win.
      en: [
        /\b(you('ve| have)? won|winner|prize|lotto|lottery|jackpot|lucky draw|you have been selected|claim your reward)\b/,
        /\bcongratulations\b.{0,60}\b(won|winner|selected|prize|reward|claim|lucky)\b/,
      ],
      af: [/\b(gewen|wenner|prys|lotto)\b/, /\bbaie geluk\b.{0,60}\b(gewen|wenner|prys|gekies|eis)/],
      zu: [/\b(uwine|uwinile|owinile|umklomelo|ilotho)\b/, /\bhalala\b.{0,60}(uwin|owin|umklomelo|ukhethiwe)/],
    },
  },
  {
    id: 'urgent',
    weight: 2,
    patterns: {
      en: [
        /\b(urgent(ly)?|immediately|right now|act now|asap|today only|last (chance|warning)|final notice|expires? (today|soon))\b/,
        /\bwithin \d{1,3} ?(hours?|hrs|minutes?|mins)\b/,
        /\b(account|card|profile)\b.{0,30}\b(suspend|block|clos|deactivat|frozen|freez|locked)/,
      ],
      af: [
        /\b(dringend|onmiddellik|vandag nog|laaste kans|binne \d{1,3} ?(uur|minute))\b/,
        /\b(rekening|kaart)\b.{0,30}\b(opgeskort|geblokkeer|gesluit|gevries|gekanselleer)/,
      ],
      zu: [
        /\b(ngokushesha|masinyane|manje nje|namuhla kuphela|ithuba lokugcina)\b/,
        /\b(i-?akhawunti|ikhadi)\b.{0,30}\b(izovalwa|ivaliwe|imisiwe|izomiswa|ivinjiwe)/,
      ],
    },
  },
  {
    id: 'invest',
    weight: 2,
    patterns: {
      en: [
        /\b(guaranteed (return|profit|income|payout)s?|double your money|risk[- ]free|get rich|investment (opportunity|platform))\b/,
        /\b\d{2,4} ?% (return|profit|interest)\b.{0,20}\b(day|week|month|daily|weekly)\b/,
        /\b(forex|crypto|bitcoin|trading)\b.{0,30}\b(profit|returns?|earn|invest)\b/,
      ],
      af: [/\b(gewaarborgde (opbrengs|wins)|verdubbel jou geld|risikovry)\b/],
      zu: [/\b(imbuyiselo eqinisekisiwe|inzuzo eqinisekisiwe|phinda kabili imali yakho|imali yakho iphindeke kabili)\b/],
    },
  },
  {
    id: 'giftcard',
    weight: 2,
    negatable: true,
    patterns: {
      en: [/\b(buy|send|pay|purchase)\b.{0,30}\b(gift ?cards?|vouchers?|airtime|google play|itunes|steam card|1voucher|ott)\b/],
      af: [/\b(koop|stuur)\b.{0,30}\b(geskenkkaarte?|koopbewyse?|lugtyd|1voucher)\b/],
      zu: [/(theng|thumel)[a-z]{0,6}\b.{0,30}\b(ama-?voucher|i-?voucher|i-?airtime|1voucher)\b/],
    },
  },
  {
    id: 'easyLoan',
    weight: 2,
    patterns: {
      en: [/\b(no credit checks?|blacklisted (ok|welcome|accepted|qualify)|guaranteed (loan|approval)|no payslip|no documents needed)\b/],
      af: [/\b(geen kredietkontrole|swartgelys welkom|gewaarborgde lening)\b/],
      zu: [/\b(akukho ukuhlolwa kwesikweletu|ayikho ukuhlolwa kwesikweletu|imalimboleko eqinisekisiwe|noma usohlwini olumnyama)\b/],
    },
  },
  {
    id: 'secrecy',
    weight: 2,
    patterns: {
      en: [/\b(don't tell|do not tell|keep (this|it) (a )?secret|tell no ?one|between us)\b/],
      af: [/\b(moenie vir [a-z]{1,12} vertel|hou dit (asseblief )?geheim|moenie vertel nie)\b/],
      zu: [/\b(ungatsheli muntu|ungamtsheli muntu|ungatsheli|kugcine kuyimfihlo|yimfihlo phakathi kwethu)\b/],
    },
  },
  {
    id: 'impersonate',
    weight: 2,
    negatable: true,
    patterns: {
      en: [
        /\b(sars|sassa|bank|fnb|absa|capitec|nedbank|standard bank|tyme ?bank|post office|saps|police|eskom)\b.{0,60}\b(verify|update|confirm|suspend|refund|unclaimed|reactivate|validate|outstanding)\b/,
        /\b(verify|update|confirm|reactivate|validate|unblock)\b.{0,20}\b(your )?(sars|sassa|bank|fnb|absa|capitec|nedbank|standard bank|tyme ?bank)\b.{0,12}\b(account|profile|details|card|app)\b/,
      ],
      af: [/\b(sars|sassa|bank|fnb|absa|capitec|nedbank|polisie|poskantoor)\b.{0,60}\b(verifieer|bevestig|opdateer|terugbetaling|heraktiveer)/],
      zu: [/\b(sars|sassa|ibhange|fnb|absa|capitec|amaphoyisa|eskom)\b.{0,60}(qinisekis|buyekez|vuselel|obuyiselwa)/],
    },
  },
  {
    id: 'newNumber',
    weight: 2,
    patterns: {
      en: [/\b(new number|lost my phone|phone (was )?stolen|changed my number|my new whatsapp)\b/],
      af: [/\b(nuwe nommer|my foon is gesteel|foon verloor)\b/],
      zu: [/\b(y?inombolo (yami )?entsha|ngilahlekelwe (yi)?ifoni|ifoni yami (yebiwe|ilahlekile))\b/],
    },
  },
  {
    id: 'job',
    weight: 2,
    patterns: {
      en: [
        /\b(job|work|employment|position)\b.{0,60}\b(fee|deposit|pay for (training|uniform|registration))\b/,
        /\b(job|work|employment|position|hiring|vacanc(y|ies))\b.{0,80}\b(pay|send|deposit)\b.{0,30}\b(uniform|training|registration|starter kit|police clearance)\b/,
      ],
      af: [/\b(werk|pos|betrekking)\b.{0,60}\b(fooi|registrasiefooi|opleidingsfooi|deposito|betaal vir (opleiding|uniform|registrasie))\b/],
      zu: [/\b(umsebenzi|emsebenzini)\b.{0,60}(khokh|imali yokubhalisa|imali yokuqeqeshwa|iyunifomu)/],
    },
  },
  {
    id: 'grant',
    weight: 2,
    patterns: {
      en: [/\b(srd|sassa|social grant|r ?3[57]0 grant|grant)\b.{0,60}\b(approved|reapply|re-apply|update your (banking|bank) details|claim|unpaid|backpay|click|link|declined)\b/],
      af: [/\b(toelae|srd|sassa)\b.{0,60}\b(goedgekeur|herapplikasie|eis|opdateer|klik)\b/],
      zu: [/\b(isibonelelo|i-?srd|sassa)\b.{0,60}(samukelwe|phinda ufake isicelo|buyekez|chofoz)/],
    },
  },
  {
    id: 'parcel',
    weight: 2,
    patterns: {
      en: [/\b(parcel|package|delivery|courier|customs|shipment)\b.{0,60}\b(fee|pay|held|on hold|failed|reschedule|unpaid|duty|duties|release)\b/],
      af: [/\b(pakkie|pakket|aflewering|doeane)\b.{0,60}\b(fooi|betaal|teruggehou|misluk)\b/],
      zu: [/\b(iphasela|iphakethe|ukulethwa)\b.{0,60}(khokh|banjiwe|hlulekile)/],
    },
  },
  {
    id: 'sim',
    weight: 2,
    patterns: {
      en: [/\b(rica|sim ?(card)?)\b.{0,40}\b(block|deactivat|suspend|expire|swap|re-?register|disconnect)/],
      af: [/\b(rica|sim(-?kaart)?)\b.{0,40}\b(geblokkeer|gedeaktiveer|opgeskort|verval|herregistreer)/],
      zu: [/\b(rica|i-?sim|isimu)\b.{0,40}(izovalwa|ivaliwe|izomiswa|bhalisa kabusha)/],
    },
  },
  {
    id: 'prepaid',
    weight: 2,
    patterns: {
      en: [
        /\b(prepaid|electricity|eskom|kwh|units?)\b.{0,40}\b(tokens?|meter|vouchers?)\b.{0,40}\b(cheap|discount|half price|special|\d{1,2} ?% off|free)\b/,
        /\b(cheap|discounted|half price) (electricity|prepaid) (tokens|units)\b/,
      ],
      af: [/\b(goedkoop|afslag|halfprys)\b.{0,30}\b(elektrisiteit|krag|tokens?|eenhede)\b/],
      zu: [/\b(ugesi|kagesi|amathokheni|ama-?token)\b.{0,40}(shibhile|saphulelo|ngentengo ephansi|mahhala)/],
    },
  },
  {
    id: 'pyramid',
    weight: 2,
    patterns: {
      en: [
        /\b(money (flip|doubling|multiplication)|gifting circle|blessing loom|investment club|stokvel)\b.{0,60}\b(join|double|receive|earn|returns?|recruit|invite)\b/,
        /\b(recruit|invite|refer) \d{1,2} (people|friends|members)\b/,
      ],
      af: [/\b(stokvel|geldsirkel)\b.{0,60}\b(sluit aan|verdubbel|ontvang|werf)\b/],
      zu: [/\b(isitokofela|stokvel)\b.{0,60}(joyin|phinda kabili|\bmema)/],
    },
  },
  {
    id: 'workFromHome',
    weight: 2,
    patterns: {
      en: [new RegExp(String.raw`\b(work from home|work from your phone|like (videos|posts) and earn|data capturing job|earn ${AMOUNT} (a|per) (day|week)|earn (up to )?${AMOUNT} daily)\b`)],
      af: [new RegExp(String.raw`\b(werk van die huis af|verdien ${AMOUNT} per (dag|week))\b`)],
      zu: [new RegExp(String.raw`\b(sebenzela ekhaya|sebenza usekhaya|hola ${AMOUNT} ngosuku|thola ${AMOUNT} ngesonto)\b`)],
    },
  },
  {
    id: 'romance',
    weight: 2,
    patterns: {
      en: [/\b(my love|darling|sweetheart|my dear|honey|babe)\b.{0,80}\b(send|needs?|borrow|transfer|pay)\b.{0,40}\b(money|funds|r ?\d|flight|ticket|customs|hospital|visa)/],
      af: [/\b(my liefie|skat|my liefde)\b.{0,80}\b(stuur|leen|betaal)\b.{0,40}\b(geld|r ?\d|kaartjie)/],
      zu: [/\b(sthandwa sami|sithandwa sami|baby wami)\b.{0,80}(thumel|bolek|khokh)[a-z]{0,6}\b.{0,40}(imali|r ?\d|thikithi)/],
    },
  },
  {
    id: 'rental',
    weight: 2,
    patterns: {
      en: [
        /\b(rent|room|flat|house|apartment|cottage|place)\b.{0,60}\b(deposit)\b.{0,60}\b(before|first|to secure|to hold|without)\b.{0,30}\b(view|viewing|see|keys)\b/,
        /\b(i'?m|we are|currently) (overseas|abroad|out of the country)\b.{0,80}\b(keys|deposit|rent)\b/,
      ],
      af: [/\b(woonstel|kamer|huis)\b.{0,60}\b(deposito)\b.{0,60}\b(voor|eers)\b.{0,30}\b(besigtig|sien|sleutels)\b/],
      zu: [/\b(indlu|ikamelo|ifulethi)\b.{0,60}\bidiphozi\b.{0,60}\b(ngaphambi|kuqala)\b.{0,30}(ubon|ukubuka|okhiye)/],
    },
  },
  {
    id: 'fakePayment',
    weight: 2,
    patterns: {
      en: [
        /\b(proof of payment|payment notification|i('ve| have) (paid|sent the money)|overpaid|paid (you )?too much|sent (you )?too much|by mistake|in error)\b.{0,80}\b(refund|send back|pay back|return the (difference|balance|extra)|release the (goods|item|car))\b/,
        /\b(refund|send back|pay back|return) the (difference|extra|balance)\b/,
      ],
      af: [/\b(bewys van betaling|te veel betaal)\b.{0,80}\b(terugbetaal|stuur terug|die verskil)\b/],
      zu: [/\b(ubufakazi bokukhokha|ngikhokhe ngokweqile|ngithumele imali eningi)\b.{0,80}(buyisel|thumel[ae] emuva|umehluko)/],
    },
  },
  {
    id: 'callNumber',
    weight: 1,
    plainOnly: true,
    patterns: {
      en: [new RegExp(String.raw`\b(call|phone|contact|dial|whatsapp)\b.{0,25}${PHONE}`)],
      af: [new RegExp(String.raw`\b(bel|skakel|kontak)\b.{0,25}${PHONE}`)],
      zu: [new RegExp(String.raw`(shayel|fonel|xhuman)[a-z]{0,6}\b.{0,25}${PHONE}`)],
    },
  },
  {
    id: 'premium',
    weight: 2,
    plainOnly: true,
    patterns: {
      en: [/\b0900[\d ]{4,10}\d\b/, /\br ?\d{1,2}(?:[.,]\d{2})? ?(?:\/|per) ?(?:min|minute|sms)\b/, /\bpremium[- ]rate\b/],
    },
  },
  { id: 'foreignNumber', weight: 2, plainOnly: true, find: findForeignNumbers },
  { id: 'fakeDomain', weight: 3, plainOnly: true, find: findFakeDomains },
  { id: 'ipLink', weight: 2, plainOnly: true, find: findIpLinks },
  {
    id: 'shortLink',
    weight: 2,
    plainOnly: true,
    patterns: { en: [/\b(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy|is\.gd|shorturl\.at|tiny\.cc|t\.ly)\b/] },
  },
  {
    id: 'link',
    weight: 1,
    plainOnly: true,
    patterns: { en: [/https?:\/\/|\bwww\./, /\b[a-z0-9-]{2,63}\.(xyz|top|click|link|online|site|live|shop|icu|buzz|info)\b/] },
  },
  {
    id: 'click',
    weight: 1,
    patterns: {
      en: [/\b(click|tap) (here|the link|below|this link)\b/],
      af: [/\b(kliek|druk) hier\b/],
      zu: [/(chofoz|cindezel)[a-z]{0,4} (lapha|isixhumanisi)\b/],
    },
  },
];

// Signs that are far more dangerous together: any such pair makes the message high risk.
const COMBOS = [
  { id: 'bankSecret', all: ['impersonate', 'secret'] },
  { id: 'bankLink', one: ['impersonate', 'grant'], two: ['link', 'shortLink', 'fakeDomain', 'ipLink'] },
  { id: 'bankForeign', one: ['impersonate'], two: ['foreignNumber'] },
  { id: 'familyMoney', one: ['newNumber'], two: ['urgent', 'secrecy', 'upfront', 'giftcard', 'mule'] },
  { id: 'remoteHelp', one: ['remote'], two: ['impersonate', 'secret', 'mule'] },
];

// "Never share your PIN" is advice, not a request: a match is ignored when a negation comes
// before it in the same clause (no punctuation between), or inside it.
const NEG_LOOKBACK = 50;
const NEG_BEFORE = /\b(never|do not|don't|dont|nooit|moenie|ungalokothi|musa)\b[a-z ]{0,40}$/;
const NEG_INSIDE = /\b(never|do not|don't|nooit|moenie|ungalokothi)\b/;
// isiZulu negative commands put "unga-"/"ninga-" before the verb and end it in -i
// ("ungathumeli": don't send). "ungathumela" ends in -a and means "you may send", so it counts.
const ZU_NEG_WORD = /^(u|ni)nga[a-z]{2,16}i$/;

/** The whole word around position i (isiZulu stems match inside words). */
function wordAt(s, i) {
  let a = i;
  let b = i;
  while (a > 0 && /[a-z]/.test(s[a - 1])) a--;
  while (b < s.length && /[a-z]/.test(s[b])) b++;
  return s.slice(a, b);
}

const isNegated = (s, m) => NEG_BEFORE.test(s.slice(Math.max(0, m.index - NEG_LOOKBACK), m.index))
  || NEG_INSIDE.test(m[0])
  || ZU_NEG_WORD.test(wordAt(s, m.index));

const toGlobal = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
for (const rule of RULES) {
  rule.compiled = Object.values(rule.patterns ?? {}).flat().map(toGlobal);
}

export const RULE_IDS = RULES.map((r) => r.id);
export const COMBO_IDS = COMBOS.map((c) => c.id);
/** Language codes each rule has patterns for; used by tests and the rule overview. */
export const RULE_LANGS = Object.fromEntries(RULES.map((r) => [r.id, Object.keys(r.patterns ?? {})]));

function findAll(rule, s) {
  if (rule.find) return rule.find(s);
  const found = [];
  for (const re of rule.compiled) {
    let n = 0;
    for (const m of s.matchAll(re)) {
      if (++n > MAX_MATCHES) break;
      if (rule.negatable && isNegated(s, m)) continue;
      found.push({ index: m.index, length: m[0].length });
    }
  }
  return found;
}

/** Highest total weight of signs whose first matches fall within WINDOW characters. */
function windowScore(hits) {
  const sorted = [...hits].sort((a, b) => a.pos - b.pos);
  let best = 0;
  for (let i = 0; i < sorted.length; i++) {
    let total = 0;
    for (let j = i; j < sorted.length && sorted[j].pos - sorted[i].pos <= WINDOW; j++) total += sorted[j].weight;
    best = Math.max(best, total);
  }
  return best;
}

const near = (a, b) => Math.abs(a.pos - b.pos) <= WINDOW;

function combosFound(byId) {
  const has = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
  return COMBOS.filter((c) => {
    const [first, second] = c.all ? [[byId.get(c.all[0])].filter(Boolean), [byId.get(c.all[1])].filter(Boolean)] : [has(c.one), has(c.two)];
    return first.some((a) => second.some((b) => near(a, b)));
  }).map((c) => c.id);
}

/** Lower-cased, cleaned-up text, as the rules see it. */
export const normalize = (text) => prepare(text).s;

/**
 * Returns { level: 'none' | 'low' | 'medium' | 'high', score, matches: [ruleId],
 * combos: [comboId], spans: [{ start, end, rule }] } where spans are positions in the
 * original text, for highlighting.
 */
export function checkMessage(text) {
  const plain = prepare(text);
  const clean = deobfuscate(plain);
  const hits = [];
  const spans = [];
  for (const rule of RULES) {
    const views = rule.plainOnly ? [plain] : [plain, clean];
    let first = null;
    for (const p of views) {
      for (const m of findAll(rule, p.s)) {
        const span = spanOf(p, m.index, m.index + m.length);
        if (!spans.some((x) => x.rule === rule.id && x.start === span.start && x.end === span.end)) spans.push({ ...span, rule: rule.id });
        if (first === null || span.start < first) first = span.start;
      }
    }
    if (first !== null) hits.push({ id: rule.id, weight: rule.weight, pos: first });
  }
  const byId = new Map(hits.map((x) => [x.id, x]));
  const combos = combosFound(byId);
  const score = String(text).length <= WINDOW ? hits.reduce((a, x) => a + x.weight, 0) : windowScore(hits);
  const level = combos.length || score >= 4 ? 'high' : score >= 2 ? 'medium' : score >= 1 ? 'low' : 'none';
  return { level, score, matches: hits.map((x) => x.id), combos, spans: spans.sort((a, b) => a.start - b.start) };
}
