// Shows how well the scam checker does on the test messages: hit rate, false alarms, misses
// and how often each rule fires. Usage: npm run scam-report

import { REAL, SCAMS } from '../tests/fixtures/scam-corpus.mjs';
import { RULE_IDS, checkMessage } from '../js/core/scam.js';

const flagged = (r) => r.level === 'medium' || r.level === 'high';
const scams = SCAMS.map((text) => ({ text, r: checkMessage(text) }));
const real = REAL.map((text) => ({ text, r: checkMessage(text) }));
const caught = scams.filter((x) => flagged(x.r));
const falseAlarms = real.filter((x) => flagged(x.r));
const pct = (a, b) => `${((a / b) * 100).toFixed(1)}%`;

console.log(`Scams caught (medium or high): ${caught.length}/${scams.length} (${pct(caught.length, scams.length)})`);
console.log(`Real messages flagged:         ${falseAlarms.length}/${real.length} (${pct(falseAlarms.length, real.length)})`);
console.log(`Scams rated high:              ${scams.filter((x) => x.r.level === 'high').length}/${scams.length}`);

const show = (title, list) => {
  if (!list.length) return;
  console.log(`\n${title}`);
  for (const x of list) console.log(`  [${x.r.level}] ${x.r.matches.join(', ') || '-'}  ${x.text.slice(0, 90)}`);
};
show('Missed scams:', scams.filter((x) => !flagged(x.r)));
show('False alarms:', falseAlarms);

const counts = Object.fromEntries(RULE_IDS.map((id) => [id, 0]));
for (const x of [...scams, ...real]) for (const id of x.r.matches) counts[id]++;
console.log('\nRule hits across all messages:');
for (const [id, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${id}`);
