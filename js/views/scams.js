// Scam check: paste or share a message, see the risk, the exact words that gave it away and
// what to do next. Plus practice messages, every warning sign with an example, and checks the
// user chose to keep (encrypted with the rest of their data).

import { todayISO } from '../core/dates.js';
import { CONTACTS, PRACTICE_IS_SCAM, firstAmount, nextSteps } from '../core/scam-advice.js';
import { MAX_LEN, RULES_VERSION, RULE_IDS, checkMessage } from '../core/scam.js';
import { SCAM_LOG_MAX, SCAM_LOG_TEXT } from '../core/schema.js';
import { h } from '../dom.js';
import { list, locale, t } from '../i18n.js';
import { icon } from '../icons.js';
import { bulletList, card, field, fmtDate, heading, newId, pageTitle, trashIcon } from './ui.js';

const LEVEL_ICON = { none: ['shieldCheck', 'ok'], low: ['info', 'warn'], medium: ['alert', 'warn'], high: ['stop', 'danger'] };
const QUIZ = [
  { id: 1, correct: 1 },
  { id: 2, correct: 0 },
  { id: 3, correct: 1 },
  { id: 4, correct: 0 },
];
const canSpeak = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
const canPaste = () => typeof navigator.clipboard?.readText === 'function';

export function render(ctx) {
  // Set when a message was shared into Imali, or to keep the result across a re-render.
  const carried = ctx.flash.scam;
  delete ctx.flash.scam;

  const text = h('textarea', { id: 'scam-text', rows: 6, maxlength: MAX_LEN, autocomplete: 'off', spellcheck: 'false' });
  const out = h('div', { 'aria-live': 'polite' });

  function check(focus = true) {
    if (!text.value.trim()) {
      out.replaceChildren(h('p', { class: 'hint', text: t('scam.empty') }));
      text.focus();
      return;
    }
    out.replaceChildren(resultCard(ctx, text.value, checkMessage(text.value)));
    if (focus) out.querySelector('h2')?.focus();
  }

  const clear = () => {
    text.value = '';
    out.replaceChildren();
    text.focus();
  };

  async function paste() {
    try {
      text.value = (await navigator.clipboard.readText()).slice(0, MAX_LEN);
      check();
    } catch {
      ctx.toast(t('scam.pasteFailed'));
      text.focus();
    }
  }

  // Cycles through the practice scams so judges and first-time users can try it at once.
  let example = 0;
  function tryExample() {
    const msgs = list('practice.msgs').filter((_, i) => PRACTICE_IS_SCAM[i]);
    text.value = msgs[example++ % msgs.length];
    check();
  }

  const form = h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'scam-h', on: { submit: (e) => { e.preventDefault(); check(); } } },
    heading('h2', ['search', t('scam.checkTitle')], { id: 'scam-h' }),
    field(t('scam.label'), text, t('scam.privacy')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'submit' }, t('scam.check')),
      canPaste() && h('button', { class: 'btn secondary', type: 'button', on: { click: paste } }, icon('paste'), t('scam.paste')),
      h('button', { class: 'btn secondary', type: 'button', on: { click: tryExample } }, icon('shuffle'), t('scam.tryExample')),
      h('button', { class: 'btn secondary', type: 'button', on: { click: clear } }, t('scam.clear'))),
    h('p', { class: 'hint', text: t('scam.version', { date: fmtDate(RULES_VERSION) }) }));

  if (carried?.text) {
    text.value = carried.text;
    check(false);
  }

  return h('div', { class: 'stack' },
    pageTitle(t('scam.title'), t('scam.lead')),
    form,
    out,
    savedCard(ctx, text, check),
    practiceCard(),
    signsCard(),
    card(['shieldCheck', t('scam.rulesTitle')], bulletList(list('scam.rules'))),
    card(['quiz', t('quiz.title')], QUIZ.map(quizItem)),
    card(['lifebuoy', t('scam.helpTitle')], bulletList(list('scam.help')), contactList(Object.keys(CONTACTS))));
}

// ---------- result ----------

function badge(level) {
  const [name, tone] = LEVEL_ICON[level];
  return h('p', { class: `badge big with-icon ${level}` }, icon(name, { cls: tone }), t(`scam.level.${level}`));
}

/** The message with every matched warning sign marked, built from text nodes only. */
export function highlighted(text, spans) {
  const src = String(text).slice(0, MAX_LEN);
  const merged = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ start: s.start, end: s.end });
  }
  const parts = [];
  let at = 0;
  for (const m of merged) {
    if (m.start > at) parts.push(src.slice(at, m.start));
    parts.push(h('mark', { text: src.slice(m.start, m.end) }));
    at = m.end;
  }
  parts.push(src.slice(at));
  return h('blockquote', { class: 'scam-msg' }, parts);
}

function contactList(ids) {
  return h('ul', { class: 'plain contacts' }, ids.map((id) => {
    const c = CONTACTS[id];
    return h('li', {},
      c.tel
        ? h('a', { class: 'btn small secondary', href: `tel:${c.tel}` }, icon('phone'), `${c.name}: ${c.show}`)
        : h('span', { class: 'with-icon' }, icon('mail'), t('scam.emailTo', { name: c.name, email: c.email })));
  }));
}

function stepsList(ctx, text, r) {
  const steps = nextSteps(r, text);
  if (!steps.length) return null;
  const openCredit = () => {
    const amount = firstAmount(text);
    if (amount) ctx.flash.loanAmount = amount;
    location.hash = '#/credit';
  };
  return [
    h('h3', { text: t('scam.stepsTitle') }),
    h('ol', { class: 'steps' }, steps.map((s) => h('li', {},
      h('p', { text: t(`scam.step.${s.key}`) }),
      s.contacts && contactList(s.contacts),
      s.action === 'credit' && h('button', { class: 'btn small', type: 'button', on: { click: openCredit } }, icon('card'), t('scam.openCredit'))))),
  ];
}

function speakButton(r) {
  if (!canSpeak()) return null;
  const btn = h('button', { class: 'btn small secondary', type: 'button' }, icon('speaker'), t('scam.readAloud'));
  btn.addEventListener('click', () => {
    const synth = window.speechSynthesis;
    if (synth.speaking) {
      synth.cancel();
      return;
    }
    const words = [t(`scam.level.${r.level}`), t(`scam.advice.${r.level}`), ...r.combos.map((c) => t(`scam.c.${c}`)), ...r.matches.map((id) => t(`scam.r.${id}`))];
    const u = new SpeechSynthesisUtterance(words.join('. '));
    u.lang = locale();
    synth.speak(u);
  });
  return btn;
}

function resultCard(ctx, text, r) {
  const keep = (wrong) => ctx.commit((d) => {
    d.scamLog.unshift({ id: newId(), date: todayISO(), level: r.level, matches: r.matches, text: text.slice(0, SCAM_LOG_TEXT), wrong });
    d.scamLog = d.scamLog.slice(0, SCAM_LOG_MAX);
    ctx.flash.scam = { text };
  }, t(wrong ? 'scam.reported' : 'scam.saved'));

  return h('section', { class: `card result scam-${r.level}`, 'aria-labelledby': 'scam-res-h' },
    h('h2', { id: 'scam-res-h', tabindex: -1, text: t('scam.result') }),
    badge(r.level),
    h('p', { class: 'big-fact', text: t(`scam.advice.${r.level}`) }),
    r.combos.map((c) => h('p', { class: 'alert danger with-icon' }, icon('alert'), t(`scam.c.${c}`))),
    stepsList(ctx, text, r),
    r.matches.length > 0 && h('details', { open: true },
      h('summary', { text: t('scam.why', { n: r.matches.length }) }),
      h('p', { class: 'hint', text: t('scam.marked') }),
      highlighted(text, r.spans),
      bulletList(r.matches.map((id) => t(`scam.r.${id}`)))),
    h('div', { class: 'row' },
      speakButton(r),
      h('button', { class: 'btn small secondary', type: 'button', on: { click: () => keep(false) } }, icon('bookmark'), t('scam.save')),
      h('button', { class: 'btn small secondary', type: 'button', on: { click: () => keep(true) } }, icon('flag'), t('scam.wrong'))),
    h('p', { class: 'hint', text: t('scam.saveHint') }));
}

// ---------- saved checks ----------

function savedCard(ctx, text, check) {
  const log = ctx.data.scamLog;
  if (!log.length) return null;
  const again = (entry) => {
    text.value = entry.text;
    check();
  };
  const remove = (entry) => ctx.commit((d) => { d.scamLog = d.scamLog.filter((x) => x.id !== entry.id); }, t('scam.removed'));
  const clearAll = async () => {
    if (await ctx.confirm(t('scam.confirmClearLog', { n: log.length }), { danger: true, ok: t('action.delete') })) {
      ctx.commit((d) => { d.scamLog = []; }, t('scam.removed'));
    }
  };
  return h('section', { class: 'card', 'aria-labelledby': 'saved-h' },
    h('details', {},
      h('summary', { id: 'saved-h' }, icon('history'), t('scam.savedTitle', { n: log.length })),
      h('p', { class: 'hint', text: t('scam.savedLead') }),
      h('ul', { class: 'plain saved' }, log.map((e) => h('li', { class: 'saved-item' },
        h('div', { class: 'bill-main' },
          h('span', { class: `badge ${e.level}`, text: t(`scam.level.${e.level}`) }),
          h('span', { class: 'tx-meta', text: [fmtDate(e.date), e.wrong && t('scam.markedWrong')].filter(Boolean).join(' · ') }),
          h('span', { class: 'saved-text', text: e.text.length > 140 ? `${e.text.slice(0, 140)}…` : e.text })),
        h('div', { class: 'row' },
          h('button', { class: 'btn small secondary', type: 'button', on: { click: () => again(e) } }, t('scam.checkAgain')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('scam.removeOne', { date: fmtDate(e.date) }), on: { click: () => remove(e) } }, trashIcon()))))),
      h('button', { class: 'btn small secondary', type: 'button', on: { click: clearAll } }, t('scam.clearLog'))));
}

// ---------- learning ----------

/** "Scam or real?" with real-looking messages; the answer shows what the checker found. */
function practiceCard() {
  const msgs = list('practice.msgs');
  const box = h('div', { class: 'practice' });
  let i = 0;
  let right = 0;

  function show() {
    if (i >= msgs.length) {
      box.replaceChildren(
        h('p', { class: 'big-fact', text: t('practice.done', { right, total: msgs.length }) }),
        h('button', { class: 'btn secondary', type: 'button', on: { click: () => { i = 0; right = 0; show(); } } }, t('practice.again')));
      return;
    }
    const message = msgs[i];
    const isScam = PRACTICE_IS_SCAM[i];
    const feedback = h('div', { 'aria-live': 'polite' });
    const answer = (saysScam) => {
      buttons.forEach((b) => { b.disabled = true; });
      const correct = saysScam === isScam;
      if (correct) right++;
      const r = checkMessage(message);
      feedback.replaceChildren(
        h('p', { class: `quiz-feedback with-icon ${correct ? 'ok' : 'danger'}` }, icon(correct ? 'check' : 'stop'), `${t(correct ? 'quiz.right' : 'quiz.wrong')} ${t(isScam ? 'practice.wasScam' : 'practice.wasReal')}`),
        // replaceChildren() can't take an array, so the reasons go in one wrapper element.
        r.matches.length
          ? h('div', {}, highlighted(message, r.spans), bulletList(r.matches.map((id) => t(`scam.r.${id}`))))
          : h('p', { class: 'hint', text: t('practice.noSigns') }),
        h('button', { class: 'btn', type: 'button', on: { click: () => { i++; show(); } } }, t('practice.next'), icon('arrowRight')));
    };
    const buttons = [
      h('button', { class: 'btn secondary quiz-opt', type: 'button', on: { click: () => answer(true) } }, t('practice.scam')),
      h('button', { class: 'btn secondary quiz-opt', type: 'button', on: { click: () => answer(false) } }, t('practice.real')),
    ];
    box.replaceChildren(
      h('p', { class: 'hint', text: t('practice.count', { n: i + 1, total: msgs.length }) }),
      h('blockquote', { class: 'scam-msg', text: message }),
      h('div', { class: 'row' }, buttons),
      feedback);
  }
  show();
  return card(['learn', t('practice.title')], h('p', { text: t('practice.lead') }), box);
}

/** Every warning sign the checker knows, each with a real-looking example. */
function signsCard() {
  return card(['flag', t('scam.signsTitle')],
    h('details', {},
      h('summary', { text: t('scam.signsOpen', { n: RULE_IDS.length }) }),
      h('ul', { class: 'plain signs' }, RULE_IDS.map((id) => h('li', {},
        h('p', { text: t(`scam.r.${id}`) }),
        h('p', { class: 'example', text: t('scam.exampleOf', { example: t(`scam.ex.${id}`) }) }))))));
}

function quizItem(q) {
  const feedback = h('p', { class: 'quiz-feedback with-icon', 'aria-live': 'polite' });
  const buttons = [0, 1].map((i) => h('button', {
    type: 'button',
    class: 'btn secondary quiz-opt',
    'aria-pressed': 'false',
    on: {
      click: () => {
        buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
        const right = i === q.correct;
        feedback.className = `quiz-feedback with-icon ${right ? 'ok' : 'danger'}`;
        feedback.replaceChildren(icon(right ? 'check' : 'stop'), `${t(right ? 'quiz.right' : 'quiz.wrong')} ${t(`quiz.${q.id}.why`)}`);
      },
    },
  }, t(`quiz.${q.id}.${i ? 'b' : 'a'}`)));
  return h('fieldset', { class: 'quiz' },
    h('legend', { text: t(`quiz.${q.id}.q`) }),
    h('div', { class: 'row' }, buttons),
    feedback);
}
