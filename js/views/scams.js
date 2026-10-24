import { MAX_LEN, checkMessage } from '../core/scam.js';
import { h } from '../dom.js';
import { list, t } from '../i18n.js';
import { icon } from '../icons.js';
import { bulletList, card, field, pageTitle, withIcon } from './ui.js';

const LEVEL_ICON = { none: 'shieldCheck', low: 'info', medium: 'alert', high: 'stop' };
const QUIZ = [
  { id: 1, correct: 1 },
  { id: 2, correct: 0 },
  { id: 3, correct: 1 },
  { id: 4, correct: 0 },
];

export function render() {
  const text = h('textarea', { id: 'scam-text', rows: 6, maxlength: MAX_LEN, autocomplete: 'off', spellcheck: 'false' });
  const out = h('div', { 'aria-live': 'polite' });

  function onSubmit(e) {
    e.preventDefault();
    if (!text.value.trim()) {
      out.replaceChildren(h('p', { class: 'hint', text: t('scam.empty') }));
      text.focus();
      return;
    }
    out.replaceChildren(resultCard(checkMessage(text.value)));
  }

  const clear = () => {
    text.value = '';
    out.replaceChildren();
    text.focus();
  };

  return h('div', { class: 'stack' },
    pageTitle(t('scam.title'), t('scam.lead')),
    h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'scam-h', on: { submit: onSubmit } },
      h('h2', { id: 'scam-h', text: t('scam.checkTitle') }),
      field(t('scam.label'), text, t('scam.privacy')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'submit' }, t('scam.check')),
        h('button', { class: 'btn secondary', type: 'button', on: { click: clear } }, t('scam.clear')))),
    out,
    card(withIcon('shield', t('scam.rulesTitle')), bulletList(list('scam.rules'))),
    card(withIcon('quiz', t('quiz.title')), QUIZ.map(quizItem)),
    card(withIcon('lifebuoy', t('scam.helpTitle')), bulletList(list('scam.help'))));
}

function resultCard(r) {
  return h('section', { class: `card result scam-${r.level}` },
    h('h2', { text: t('scam.result') }),
    h('p', { class: `badge ${r.level}` }, icon(LEVEL_ICON[r.level], { cls: 'title-icon' }), t(`scam.level.${r.level}`)),
    r.matches.length > 0 && h('h3', { text: t('scam.why') }),
    r.matches.length > 0 && bulletList(r.matches.map((id) => t(`scam.r.${id}`))),
    h('p', { text: t(`scam.advice.${r.level}`) }));
}

function quizItem(q) {
  const feedback = h('p', { class: 'quiz-feedback', 'aria-live': 'polite' });
  const buttons = [0, 1].map((i) => h('button', {
    type: 'button',
    class: 'btn secondary quiz-opt',
    'aria-pressed': 'false',
    on: {
      click: () => {
        buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
        const right = i === q.correct;
        feedback.className = `quiz-feedback ${right ? 'ok' : 'danger'}`;
        feedback.replaceChildren(icon(right ? 'check' : 'stop', { cls: 'title-icon' }), `${t(right ? 'quiz.right' : 'quiz.wrong')} ${t(`quiz.${q.id}.why`)}`);
      },
    },
  }, t(`quiz.${q.id}.${i ? 'b' : 'a'}`)));
  return h('fieldset', { class: 'quiz' },
    h('legend', { text: t(`quiz.${q.id}.q`) }),
    h('div', { class: 'row' }, buttons),
    feedback);
}
