import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import af from '../js/lang/af.js';
import en from '../js/lang/en.js';
import zu from '../js/lang/zu.js';
import { PRACTICE_IS_SCAM, firstAmount, nextSteps, paymentNeedsCheck, weekIndex } from '../js/core/scam-advice.js';
import { domainProblem } from '../js/core/scam-links.js';
import { deobfuscate, prepare } from '../js/core/scam-text.js';
import { COMBO_IDS, MAX_LEN, RULE_IDS, RULE_LANGS, WINDOW, checkMessage } from '../js/core/scam.js';
import { REAL, SCAMS } from './fixtures/scam-corpus.mjs';

const LANGS = { en, af, zu };
const flagged = (r) => r.level === 'medium' || r.level === 'high';

describe('text preparation', () => {
  test('maps every prepared character back to the original text', () => {
    const src = 'URGENT!!  Send​ your   OTP';
    const p = prepare(src);
    assert.equal(p.s, 'urgent!! send your otp');
    const i = p.s.indexOf('otp');
    assert.equal(src.slice(p.from[i], p.to[i + 2]), 'OTP');
  });

  test('undoes look-alike characters and spaced-out letters', () => {
    for (const [disguised, plain] of [['0TP', 'otp'], ['p1n', 'pin'], ['f33', 'fee'], ['O.T.P', 'otp'], ['p i n', 'pin'], ['passw0rd', 'password']]) {
      assert.equal(deobfuscate(prepare(disguised)).s, plain, disguised);
    }
    // Plain numbers and amounts are left alone.
    assert.equal(deobfuscate(prepare('R1 000 within 24 hours')).s, 'r1 000 within 24 hours');
  });
});

describe('scam rules', () => {
  test('disguised requests are still caught', () => {
    for (const m of ['Please send us your 0TP to verify', 'Send the O.T.P now', 'Reply with your P 1 N', 'Pl3ase s3nd y0ur 0TP']) {
      assert.ok(checkMessage(m).matches.includes('secret'), m);
    }
  });

  test('advice not to share is not flagged, in all three languages', () => {
    for (const m of [
      'Your OTP is 482913. Never share it with anyone.',
      'FNB will never ask you to verify your details via SMS or email.',
      'Capitec will never call you to ask for your password or remote access to your phone.',
      'Jou Absa OTP is 551209. Moet dit nooit met iemand deel nie.',
      'Ungathumeli i-OTP yakho kumuntu.',
    ]) assert.equal(checkMessage(m).level, 'none', m);
  });

  test('a negation in an earlier clause does not hide a later request', () => {
    assert.ok(checkMessage('We will never ask for your PIN, but please confirm your OTP here').matches.includes('secret'));
    // isiZulu "ungathumela" (you may send) is a request; "ungathumeli" (don't send) is not.
    assert.ok(checkMessage('Ungathumela i-OTP yakho manje.').matches.includes('secret'));
  });

  test('dangerous combinations make a message high risk', () => {
    const cases = [
      ['FNB: confirm your account by replying with your OTP', 'bankSecret'],
      ['SASSA: update your details at sassa-srd.online', 'bankLink'],
      ['Call +234 801 234 5678 to verify your Capitec account', 'bankForeign'],
      ['Hi mom, this is my new number. Send R500 urgently', 'familyMoney'],
      ['Install AnyDesk so we can verify your bank account', 'remoteHelp'],
    ];
    for (const [m, combo] of cases) {
      const r = checkMessage(m);
      assert.ok(r.combos.includes(combo), `${combo}: ${m} -> ${r.combos}`);
      assert.equal(r.level, 'high', m);
    }
  });

  test('in long messages, signs far apart do not add up', () => {
    const filler = ' The weather was lovely and we went for a walk in the park.'.repeat(15);
    const far = `Please send us the OTP.${filler} Click here for the photos.`;
    assert.ok(far.length > WINDOW);
    assert.equal(checkMessage(far).level, 'medium');
    const near = `${filler} Please send us the OTP. Click here for the photos.`;
    assert.equal(checkMessage(near).level, 'high');
  });

  test('everyday congratulations are not a prize scam', () => {
    for (const m of ['Congratulations on your new baby!', 'Baie geluk met jou nuwe werk!', 'Halala ngomsebenzi wakho omusha!']) {
      assert.equal(checkMessage(m).level, 'none', m);
    }
    assert.ok(checkMessage('Congratulations! You have been selected for a R5 000 reward').matches.includes('prize'));
  });

  test('highlight spans point at the matched words in the original text', () => {
    const text = 'Hello.  Please SEND your 0TP​ now!';
    const r = checkMessage(text);
    const marked = r.spans.map((s) => text.slice(s.start, s.end));
    assert.ok(marked.some((m) => /SEND your 0TP/.test(m)), marked.join(' | '));
    for (const s of r.spans) assert.ok(s.start >= 0 && s.end <= text.length && s.start < s.end);
  });

  test('every rule example triggers its rule, in every language', () => {
    for (const [code, dict] of Object.entries(LANGS)) {
      for (const id of RULE_IDS) {
        const example = dict[`scam.ex.${id}`];
        assert.ok(checkMessage(example).matches.includes(id), `${code} scam.ex.${id}: "${example}" -> ${checkMessage(example).matches}`);
      }
    }
  });

  test('practice messages are classified as the answers say, in every language', () => {
    for (const [code, dict] of Object.entries(LANGS)) {
      const msgs = dict['practice.msgs'];
      assert.equal(msgs.length, PRACTICE_IS_SCAM.length, code);
      msgs.forEach((m, i) => assert.equal(flagged(checkMessage(m)), PRACTICE_IS_SCAM[i], `${code} practice ${i + 1}: ${m}`));
    }
  });

  test('keyword rules cover English, Afrikaans and isiZulu', () => {
    const languageFree = ['premium', 'foreignNumber', 'fakeDomain', 'ipLink', 'shortLink', 'link'];
    for (const id of RULE_IDS.filter((x) => !languageFree.includes(x))) {
      assert.deepEqual([...RULE_LANGS[id]].sort(), ['af', 'en', 'zu'], id);
    }
  });

  test('every combination and next step has wording in every language', () => {
    const steps = ['stop', 'secret', 'remote', 'mule', 'noPay', 'official', 'family', 'loan', 'sars', 'sassa', 'report'];
    for (const [code, dict] of Object.entries(LANGS)) {
      for (const c of COMBO_IDS) assert.ok(dict[`scam.c.${c}`], `${code} scam.c.${c}`);
      for (const s of steps) assert.ok(dict[`scam.step.${s}`], `${code} scam.step.${s}`);
    }
  });
});

describe('scam test messages', () => {
  test('catches at least 90% of scams and flags at most 5% of real messages', () => {
    const caught = SCAMS.filter((m) => flagged(checkMessage(m)));
    const falseAlarms = REAL.filter((m) => flagged(checkMessage(m)));
    assert.ok(caught.length / SCAMS.length >= 0.9, `caught ${caught.length}/${SCAMS.length}`);
    assert.ok(falseAlarms.length / REAL.length <= 0.05, `false alarms: ${falseAlarms.join(' | ')}`);
  });
});

describe('links and numbers', () => {
  test('official domains pass; brand copies and look-alikes do not', () => {
    for (const d of ['fnb.co.za', 'www.fnb.co.za', 'srd.sassa.gov.za', 'capitecbank.co.za', 'telkomsa.net', 'perhaps.com', 'news24.com']) {
      assert.equal(domainProblem(d), null, d);
    }
    assert.equal(domainProblem('fnb-verify.xyz'), 'brand');
    assert.equal(domainProblem('gov.za.claim.info'), 'brand');
    assert.equal(domainProblem('capltecbank.co.za'), 'lookalike');
    assert.equal(domainProblem('takeal0t.com'), 'lookalike');
    assert.equal(domainProblem('xn--fnb-xyz.com'), 'unicode');
  });
});

describe('scam advice', () => {
  test('next steps follow what was found', () => {
    const t = 'SARS: unclaimed refund. Verify at sars-refund.top and send your OTP. Loans R3 000, no credit checks';
    const steps = nextSteps(checkMessage(t), t);
    const keys = steps.map((s) => s.key);
    for (const k of ['stop', 'secret', 'official', 'loan', 'sars', 'report']) assert.ok(keys.includes(k), k);
    assert.equal(steps.find((s) => s.key === 'loan').action, 'credit');
    assert.deepEqual(nextSteps(checkMessage('See you at 6'), 'See you at 6'), []);
  });

  test('finds the first rand amount', () => {
    assert.equal(firstAmount('Loan of R5 000, no credit check'), 500_000);
    assert.equal(firstAmount('Get R 2,500.00 today'), 250_000);
    assert.equal(firstAmount('no money here'), null);
  });

  test('suggests a scam check before big or unusual payments', () => {
    assert.equal(paymentNeedsCheck(250_000, 'food', 1_000_000), true); // R2 500
    assert.equal(paymentNeedsCheck(60_000, 'family', 1_000_000), true); // R600 to family
    assert.equal(paymentNeedsCheck(60_000, 'food', 100_000), true); // more than half the cash
    assert.equal(paymentNeedsCheck(4_500, 'food', 100_000), false); // R45 of groceries
  });

  test('scam of the week changes weekly and wraps around', () => {
    assert.equal(weekIndex(1, 8), 0);
    assert.equal(weekIndex(7, 8), 0);
    assert.equal(weekIndex(8, 8), 1);
    assert.equal(weekIndex(365, 8), 4);
  });
});

describe('scam checker safety', () => {
  test('no input can make a rule slow (ReDoS)', () => {
    const attacks = [
      'a'.repeat(MAX_LEN * 10),
      'send '.repeat(2000),
      'otp '.repeat(2000),
      'o t p '.repeat(1500),
      `${'fnb.'.repeat(1200)}xyz`,
      '+27 '.repeat(2000),
      `${'r 1 '.repeat(1500)}a day`,
      'thumela '.repeat(1000),
      `${'.'.repeat(4000)}fnb`,
      `${'1.'.repeat(2500)}`,
    ];
    for (const a of attacks) {
      const t0 = performance.now();
      checkMessage(a);
      const ms = performance.now() - t0;
      assert.ok(ms < 1000, `${a.slice(0, 20)}… took ${ms.toFixed(0)} ms`);
    }
  });
});
