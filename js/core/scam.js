// Offline scam-message checker. Rule-based so it works with no data and never sends the
// message anywhere. All patterns use bounded repetition only, so they can't hang (ReDoS).

export const MAX_LEN = 5000;

const RULES = [
  {
    id: 'secret',
    weight: 3,
    any: [
      /\b(send|share|give|confirm|provide|reply with|tell us|enter|verify|update|stuur|gee)\b.{0,40}\b(otp|one[- ]?time[- ]?(pin|password)|pin|password|passcode|cvv|cvc|card (number|details)|login details|wagwoord)\b/,
      /\b(otp|pin|password|cvv|wagwoord)\b.{0,30}\b(send|reply|share|give|stuur)\b/,
    ],
    unless: /\b(never|do not|don't|nooit|moenie)\b.{0,20}\b(share|give|send|disclose|tell|deel|stuur|gee)\b/,
  },
  { id: 'remote', weight: 3, any: [/\b(anydesk|teamviewer|rustdesk|quick ?support|screen ?shar(e|ing)|remote access)\b/] },
  {
    id: 'upfront',
    weight: 3,
    any: [
      /\b(pay|send|deposit|transfer|betaal)\b.{0,40}\b(fee|admin|processing|release|clearance|insurance|registration|delivery|customs|activation|fooi)\b/,
      /\b(upfront|up-front|advance fee)\b/,
    ],
  },
  {
    id: 'mule',
    weight: 3,
    any: [
      /\b(receive|accept|ontvang)\b.{0,30}\b(money|payment|funds|geld)\b.{0,40}\b(send|transfer|forward|withdraw|oordra)\b/,
      /\b(use|borrow|rent)\b.{0,10}\byour (bank )?account\b/,
    ],
  },
  {
    id: 'prize',
    weight: 2,
    any: [/\b(you('ve| have)? won|winner|prize|lotto|lottery|jackpot|congratulations|lucky draw|baie geluk|gewen)\b/],
  },
  {
    id: 'urgent',
    weight: 2,
    any: [
      /\b(urgent(ly)?|immediately|right now|act now|asap|today only|last (chance|warning)|final notice|expires? (today|soon)|dringend|onmiddellik)\b/,
      /\bwithin \d{1,3} ?(hours?|hrs|minutes?|mins)\b/,
      /\b(account|card|profile|rekening)\b.{0,30}\b(suspend|block|clos|deactivat|frozen|freez|locked|opgeskort|gesluit)/,
    ],
  },
  {
    id: 'invest',
    weight: 2,
    any: [
      /\b(guaranteed (return|profit|income|payout)s?|double your money|risk[- ]free|get rich|investment (opportunity|platform))\b/,
      /\b\d{2,4} ?% (return|profit|interest)\b.{0,20}\b(day|week|month|daily|weekly)\b/,
      /\b(forex|crypto|bitcoin|trading)\b.{0,30}\b(profit|returns?|earn|invest)\b/,
    ],
  },
  {
    id: 'giftcard',
    weight: 2,
    any: [/\b(buy|send|pay|purchase|koop|stuur)\b.{0,30}\b(gift ?cards?|vouchers?|airtime|google play|itunes|steam card|1voucher|ott)\b/],
  },
  {
    id: 'easyLoan',
    weight: 2,
    any: [/\b(no credit checks?|blacklisted (ok|welcome|accepted|qualify)|guaranteed (loan|approval)|no payslip|no documents needed)\b/],
  },
  { id: 'secrecy', weight: 2, any: [/\b(don't tell|do not tell|keep (this|it) (a )?secret|tell no ?one|between us|moenie vertel nie)\b/] },
  {
    id: 'impersonate',
    weight: 2,
    any: [
      /\b(sars|sassa|bank|fnb|absa|capitec|nedbank|standard bank|tyme ?bank|post office|saps|police|eskom)\b.{0,60}\b(verify|update|confirm|suspend|refund|unclaimed|reactivate|validate|outstanding)\b/,
    ],
  },
  { id: 'newNumber', weight: 2, any: [/\b(new number|lost my phone|phone (was )?stolen|nuwe nommer)\b/] },
  { id: 'job', weight: 2, any: [/\b(job|work|employment|position|werk)\b.{0,60}\b(fee|deposit|pay for (training|uniform|registration))\b/] },
  { id: 'shortLink', weight: 2, any: [/\b(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy|is\.gd|shorturl\.at|tiny\.cc|t\.ly)\b/] },
  { id: 'link', weight: 1, any: [/https?:\/\/|\bwww\./, /\b[a-z0-9-]{2,63}\.(xyz|top|click|link|online|site|live|shop|icu|buzz|info)\b/] },
  { id: 'click', weight: 1, any: [/\b(click|tap) (here|the link|below|this link)\b|\bkliek hier\b/] },
];

export function normalize(text) {
  return String(text)
    .slice(0, MAX_LEN)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ');
}

/** Returns { level: 'none' | 'low' | 'medium' | 'high', score, matches: [ruleId] } */
export function checkMessage(text) {
  const s = normalize(text);
  const matches = [];
  let score = 0;
  for (const rule of RULES) {
    if (rule.unless?.test(s)) continue;
    if (rule.any.some((re) => re.test(s))) {
      matches.push(rule.id);
      score += rule.weight;
    }
  }
  const level = score >= 4 ? 'high' : score >= 2 ? 'medium' : score >= 1 ? 'low' : 'none';
  return { level, score, matches };
}

export const RULE_IDS = RULES.map((r) => r.id);
