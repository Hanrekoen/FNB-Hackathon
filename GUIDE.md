# Imali: what we built and how to run it

This is a full walkthrough of the Imali app built for the FNB Hackathon (theme: *financial inclusion and money confidence*). The [README](README.md) is the short pitch; this guide covers what each part does, how it fits together, and how to run, test and deploy it.

---

## 1. The idea in one paragraph

Imali (isiZulu/isiXhosa for "money") is a money companion for people with **irregular incomes, limited financial knowledge, or limited access to formal banking**. It is a **Progressive Web App (PWA)**: it opens in any phone browser and can be added to the home screen. It needs no app store, no account and no server, and it works **fully offline** after the first visit. All data stays on the phone, **encrypted with the user's PIN**. It is available in **English, Afrikaans and isiZulu**.

---

## 2. What the user sees

### First run and lock screen ([js/views/gate.js](js/views/gate.js))
- **Onboarding:** pick a language, enter a name (optional) and choose a PIN of at least 6 characters. Weak PINs such as `123456`, `111111` or `121212` are rejected.
- **How you're paid** ([js/views/profile.js](js/views/profile.js)): straight after setup, the user says whether they're paid monthly (on a given day), every two weeks, weekly, or "it varies". They can skip this and change it later.
- **Restore:** a backup file can be restored on a new phone from the same screen.
- **Unlock:** after the first run, the app always opens on the PIN screen. After 5 wrong tries it makes you wait (30 s, doubling each time up to 1 hour). There is an optional setting to erase all data after 10 wrong tries.

### Home ([js/views/home.js](js/views/home.js))
- **"Safe to spend today"**: the main number, with cash on hand and the next expected income.
- **Where your money is:** a bar showing the three buckets (see below).
- **Looking ahead:** a run-out forecast ("at this pace you run out on the 3rd, 5 days before your next income") and the user's biggest spending weekday. Each one has a "How we worked this out" section that shows the numbers it used.
- **A nudge** when the user's real income timing doesn't match how they said they're paid.
- **Bills due before the next income**, recent transactions, **scam of the week** and a daily money tip.
- **Load example data:** on an empty app, one tap loads six weeks of a student's money so judges can explore straight away. A banner says it's example data, and Settings clears it.

### Money / budget ([js/views/budget.js](js/views/budget.js), logic in [js/core/budget.js](js/core/budget.js), [js/core/income.js](js/core/income.js), [js/core/forecast.js](js/core/forecast.js))
Imali does not use a monthly budget, because a monthly budget doesn't fit someone whose pay is irregular. It works like this instead:

1. **Next income date** comes from one of these, in order:
   - a date the user entered;
   - their stated payday (monthly paydays on a weekend move to the Friday before);
   - for "it varies": a cautious estimate from their history (a longer-than-usual gap between incomes, the 75th percentile);
   - if that date has passed and no money has arrived, today + 7 days;
   - with no history at all, today + 14 days.
2. **Bills due before then** are planned for. Bills can be monthly, weekly or once-off. Bills whose amount varies, like taxi fare, are estimated from the last 6 weeks of spending in a linked category.
3. **Safe per day** = (free money − bills not yet covered by Needs) ÷ days until next income.

The screen also has:
- **Add money in or out**, with categories ([js/core/categories.js](js/core/categories.js)).
- **Income split** ([js/core/buckets.js](js/core/buckets.js)): when money comes in, Imali suggests a split into the three buckets. The user can apply it, adjust it, or ignore it:
  - **Needs:** bills due before the next income. Taking money out needs **3 days' notice**, with a warning if a bill would be left short.
  - **Safety:** the savings percentage, going to the emergency fund first and then other goals. It can be taken out straight away, after a screen showing what that costs (for example, "covers 6 days of essentials → 2 days").
  - **Free:** the rest, which becomes safe-to-spend.

  The money is set aside *inside Imali*; nothing moves at a bank.
- **Scam check before big payments:** a payment of R2,000 or more, R500 or more to "family", "debt" or "other", or more than half the cash on hand asks first: "Is this because of a message or call?" The user can check a message first or save the payment.
- **Bills:** add bills and mark them paid. Payments come out of Needs first.
- **This month** and a **history** list.
- **Deleting an income also undoes its split.** The Needs and Safety amounts set aside from it are removed with it, and the confirm dialog says how much. For older data with no link, Needs is trimmed so it can never hold more than the cash really there.

### Save ([js/views/savings.js](js/views/savings.js))
- The buckets bar, and the **Needs** card: set money aside, ask for a release (3 days' notice), or cancel a pending release.
- The "pay yourself first" savings percentage.
- **Savings goals** with progress bars, and a one-tap **emergency fund** starter goal.
- The "pay yourself first" rule and the savings percentage.
- **Savings goals** with progress bars. Users can move money into a goal or take it back out.
- A one-tap **emergency fund** starter goal.
- **Goals with a deadline** ([js/core/goals.js](js/core/goals.js)): "R3 000 by 15 December" becomes an amount per payday (per week if income varies), a status (on track / a stretch / too big / not enough history yet) and, when needed, specific cuts to extras, a later date or a lower amount. "How we worked this out" shows every number used. Cuts never touch rent, bills, school, health, family, stokvel, debt or transport.

### Credit / loan checker ([js/views/credit.js](js/views/credit.js), logic in [js/core/credit.js](js/core/credit.js))
The user enters a loan amount, interest rate, term, initiation fee and monthly fee. Imali shows:
- the monthly repayment, the total paid back, and **"for every R100 you borrow you pay back R…"**;
- the **real yearly cost including fees** (effective annual rate, found by bisection);
- how many months it would take to save the same amount instead.

It then rates the loan as **ok / caution / danger**:
- **Danger:** rate above 60%/year (the National Credit Act short-term cap, so the lender is probably illegal); repayment above 30% of income; or total cost at least equal to the amount borrowed.
- **Caution:** rate above 28%; repayment between 20% and 30% of income; income unknown; or fees adding more than 10 percentage points to the real rate.

Below the result are borrower rights and the warning signs of an illegal lender (*mashonisa*). When the scam check finds a loan offer, a button opens this screen with the loan amount from the message already filled in.

### Scams ([js/views/scams.js](js/views/scams.js))
**Getting a message in:** paste it, tap **Paste**, tap **Try an example**, or **share it straight from WhatsApp or SMS** into Imali. Sharing works on Android once the app is installed. The shared text is removed from the address bar straight away, and checked once the app is unlocked.

**The result:**
- A big risk level (none / low / medium / high) and one sentence of advice.
- A red warning for **dangerous combinations**, such as "names a bank AND asks for your OTP".
- **What to do now:** numbered steps that depend on what was found (for example, "already shared a PIN? call your bank now"), with **tap-to-call** report numbers.
- **What gave it away:** the user's own message, with the **exact words that triggered each warning highlighted**, and a plain-language reason for each.
- **Read aloud**, **Save to my history**, and **This result looks wrong**. Both kinds of save are kept on the phone only, encrypted, and included in the backup.

**Learning:**
- **Scam or real?** A practice game with 10 real-looking messages per language. After each answer it shows what gave the message away.
- **Learn the warning signs:** all 30 warning signs, each with an example.
- Golden rules, a quiz, and what to do if you've been scammed, with contact numbers.

**How the checker works** ([js/core/scam.js](js/core/scam.js), [scam-text.js](js/core/scam-text.js), [scam-links.js](js/core/scam-links.js), [scam-advice.js](js/core/scam-advice.js)):
1. **Clean up the text:** lowercase, Unicode normalisation, invisible characters removed, spaces collapsed. Every character keeps a link back to the original, which is how highlighting works.
2. **Undo disguises:** "0TP", "p1n" and "f33" are read as OTP, PIN and fee, and "O.T.P" or "P I N" are joined up. Rand amounts like "R1 000" are left alone.
3. **Run the 30 rules.** Each rule is data with English, Afrikaans and isiZulu patterns, and all three languages are checked whatever language the app is in. The isiZulu patterns match verb stems, because the verbs take prefixes and suffixes ("thumela" → "uthumele").
4. **Link and number checks:**
   - brand names in someone else's domain (`fnb-verify.xyz`);
   - look-alike domains (`capltecbank.co.za`, `takeal0t.com`);
   - Unicode and punycode tricks;
   - links that are raw IP addresses;
   - foreign phone numbers in a message that names a South African bank.
5. **Ignore advice:** "never share your OTP" isn't a request. A match is ignored when a negation comes before it in the same clause, including isiZulu negative commands ("ungathumeli", "don't send"). "We never ask for your PIN, **but** confirm your OTP" is still flagged.
6. **Score:** the warning signs found are added up (4 or more = high, 2–3 = medium, 1 = low). Any of 5 dangerous pairs makes the message high. In long messages, only signs within 600 characters of each other count together.
7. **Safe on any input:** every pattern has bounded repetition and input is capped at 5,000 characters, so no message can freeze the phone (ReDoS). A test throws worst-case input at it.

New South African scam types covered:
- SASSA SRD grants;
- parcel and customs fees;
- RICA / SIM blocking;
- cheap prepaid electricity;
- money flips and pyramid "stokvels";
- work-from-home;
- romance scams;
- rental deposits;
- fake proof of payment and overpayment;
- premium-rate numbers.

### Settings ([js/views/settings.js](js/views/settings.js))
- **Display:** language, larger text, high contrast and dark mode ([js/prefs.js](js/prefs.js), saved in `localStorage`; no financial data is stored there).
- **Profile** name, **how you're paid**, and **example data** (load or clear).
- **Install** button (uses the browser's install prompt where available).
- **Change PIN.**
- **Backup and restore:** an encrypted backup file protected by a **separate password of at least 10 characters**, since the file can leave the phone.
- **Security:** auto-lock after 1, 3, 5 or 10 minutes idle; lock after leaving the app for 30 s, 2 min or 5 min (5 min by default, for judging); and the erase-after-10-wrong-tries option.
- **Danger zone:** erase everything.

### Across the whole app ([js/app.js](js/app.js))
- A hash router (`#/home`, `#/money`, `#/save`, `#/credit`, `#/scams`, `#/settings`, `#/profile`) with a bottom tab bar.
- **Icons, not emoji:** every icon is an inline SVG adapted from [Lucide](https://lucide.dev) (ISC licence), defined and built with DOM calls in [js/icons.js](js/icons.js). Nothing is fetched, so it still works offline and within the security policy. A test fails if an emoji appears anywhere in the app.
- **Auto-lock**, a **blur in the app switcher**, toasts, dialogs and focus management for screen readers.
- Service worker registration, so the app works offline.

---

## 3. How it's built

**No frameworks and no dependencies.** It is plain HTML, CSS and ES modules, about 440 KB on disk including icons and all three languages, and works on cheap phones and expensive data.

```
index.html, manifest.webmanifest, sw.js   PWA shell, CSP meta tag, share target, offline cache
_headers                                  security headers for Netlify / Cloudflare Pages
css/app.css                               mobile-first styles; dark, high-contrast and large-text modes
js/app.js                                 router, auto-lock, privacy blur, share target, Trusted Types policy
js/dom.js                                 h(): the only way UI is built (text nodes only, no innerHTML)
js/icons.js                               inline SVG icons built with createElementNS (no emoji)
js/i18n.js + js/lang/{en,af,zu}.js        translations and t() lookup with placeholders
js/prefs.js                               display preferences (localStorage)
js/idb.js                                 small IndexedDB wrapper
js/vault.js                               encrypted storage: create / unlock / lock / save / backup / restore
js/core/                                  pure logic with no DOM, all unit-tested
  budget.js      safe-to-spend, income gap, bill due dates
  buckets.js     Needs / Safety / Free, income split, release notice
  goals.js       goals with a deadline: per-payday amount, capacity, cuts, alternatives
  credit.js      repayment, effective rate, loan risk assessment
  crypto.js      PBKDF2 + AES-GCM helpers
  security.js    PIN and backup-password rules
  money.js       parse and format rand amounts as integer cents
  dates.js       ISO date arithmetic
  categories.js  categories and transaction icons
js/views/                                 one module per screen, plus shared ui.js helpers
scripts/serve.mjs                         zero-dependency dev server with production headers
scripts/build.mjs                         copies only the app files into dist/
scripts/scam-report.mjs                   scam checker hit rate on the test messages
scripts/make-icons.mjs                    generates the PNG app icons
tests/                                    node:test suites; tests/fixtures/scam-corpus.mjs has 100 test messages
.semgrep/imali.yml                        project-specific security rules
.claude/skills/security-scan/             Claude Code skill to run and triage the Semgrep scan
```

**Data flow:** views call `ctx` helpers, which change `vault.getData()`. `vault.save()` then encrypts the whole data object and writes it to IndexedDB. Saves are queued, so they never overlap. Everything decrypted from the vault or a backup goes through `normalize()` in [js/core/schema.js](js/core/schema.js), so malformed or older data never reaches the app.

### Security model
- **Encryption at rest:** AES-256-GCM. The key is derived from the PIN with PBKDF2-SHA256 (600,000 iterations) and a random 128-bit salt, and every save uses a new random IV. The key is a **non-extractable** `CryptoKey` that exists only in memory while the app is unlocked. Tampered data fails to decrypt.
- **Locking** drops the key and the decrypted data from memory and clears the screen.
- **No network:** after the app loads it sends no requests, has no analytics and loads no external URLs. The CSP `default-src 'none'` enforces this. The scam checker runs entirely on the phone.
- **No HTML injection:** all UI goes through `textContent`, and the CSP requires **Trusted Types**, so any `innerHTML` use would throw. Icons are built with `createElementNS`, and the only links allowed are in-app links and `tel:` links to fixed numbers.
- **Strict headers:** CSP, HSTS, `nosniff`, `no-referrer`, COOP/COEP/CORP and a locked-down Permissions-Policy. The CSP is identical in [index.html](index.html), [scripts/serve.mjs](scripts/serve.mjs) and [_headers](_headers), and a test checks that they match.
- **Input validation:** money is stored as integer cents, with range checks. Imported backups and saved scam checks are shape-checked, and iteration counts are bounded.
- **Known limits:**
  - Someone who copies the browser storage off a phone can try PINs offline, and a 6-digit PIN only slows them down.
  - The 3-day Needs notice is a self-discipline tool, not a security control: changing the phone's clock gets around it.
  - Next steps are WebAuthn/passkey unlock, Argon2id, and a native wrapper for screenshot blocking.

---

## 4. How to run it

### Requirements
- **Node.js 22 or newer** (`node --version`). It's used only for the dev server and tests; nothing needs to be installed with npm.
- A modern browser: Chrome, Edge, Firefox or Safari.

### Run locally
```bash
npm start
```
Open **http://127.0.0.1:8080**. The server sends the same security headers as production and serves only the app files (never `tests/`, `scripts/` or `.git`).

To use a different port:
```bash
PORT=3000 npm start                  # Git Bash / MSYS2 / macOS / Linux
$env:PORT=3000; npm start            # PowerShell
```

> Encryption (Web Crypto) and the service worker only work on **localhost or HTTPS**. Opening `index.html` straight from disk (`file://`) won't work, and neither will opening `http://<your-LAN-IP>:8080` from a phone. To use it on a phone, deploy it (see below).

### Run the tests
```bash
npm test
```
There are 117 tests, and they currently all pass. The main suites:
- **[tests/core.test.mjs](tests/core.test.mjs):** money parsing and formatting, date arithmetic, budget logic (income gaps, late income, bills in short months, shortfall, income split), credit maths and risk flags, scam checker (true positives, "never share" notices not flagged, huge input), PIN rules.
- **[tests/crypto.test.mjs](tests/crypto.test.mjs):** encrypt/decrypt round trip, a new IV each time, a wrong PIN, tampered data or wrong context all fail, keys can't be exported, iteration bounds, record shape checks.
- **[tests/project.test.mjs](tests/project.test.mjs):** every translation key exists in all three languages with matching placeholders, every app file is in the service-worker cache, no unsafe HTML or `eval` APIs are used, and the CSP is strict and identical in all three places.

### Security scan
You need [Semgrep](https://semgrep.dev) once, for example in a virtual environment in the project folder (it's git-ignored):
```bash
.venv/Scripts/python -m pip install semgrep    # once (bin/python on macOS/Linux)
source .venv/Scripts/activate                  # each new terminal
PYTHONUTF8=1 npm run security                  # PowerShell: $env:PYTHONUTF8=1; npm run security
```
This runs the project rules in [.semgrep/imali.yml](.semgrep/imali.yml) together with the community JavaScript, XSS, secrets and OWASP rule packs. It should end with `0 findings`. Semgrep only scans files tracked by git, so commit (or `git add`) new files before scanning. In Claude Code, the `/security-scan` skill runs the same scan, first checks that the rules really fire, and then triages the findings.

### Regenerate app icons
```bash
npm run icons
```

### Build for deployment
```bash
npm run build
```
This copies only the files the app needs into `dist/`. `dist/` is git-ignored.

### Deploy and install on a phone
1. Run `npm run build`.
2. Upload `dist/` to any static host over HTTPS:
   - **Netlify** or **Cloudflare Pages:** drag and drop `dist/`. Both read [_headers](_headers) automatically.
   - **GitHub Pages** also works, but it can't send custom headers, so only the CSP meta tag in `index.html` applies there.
3. Open the URL on the phone and add the app to the home screen:
   - **Android (Chrome):** menu ⋮ → *Add to Home screen* / *Install app*. Once installed, Imali appears in the **Share** menu of WhatsApp and Messages.
   - **iPhone (Safari):** Share → *Add to Home Screen*. iOS doesn't support sharing into web apps, so use Paste there.
4. Turn on flight mode and open the app: it still works.

### When you change app files
- Bump `VERSION` in [sw.js](sw.js) (it is `imali-v3` now) so installed copies pick up the new files.
- If you add a new file under `js/`, `css/` or `icons/`, add it to the `ASSETS` list in `sw.js`. `npm test` fails if you forget.
- If you add a new piece of text, add its key to all three files in `js/lang/`. `npm test` fails if a key or placeholder is missing.
- **Adding a scam rule:** add it to `RULES` in [js/core/scam.js](js/core/scam.js) with `en`, `af` and `zu` patterns (bounded repetition only), add `scam.r.<id>` and `scam.ex.<id>` in all three languages, then run `npm test` and `npm run scam-report`. The tests check that each example really triggers its rule.
- **Adding an icon:** copy the SVG's shapes from [lucide.dev](https://lucide.dev) into `SHAPES` in [js/icons.js](js/icons.js), using the `path()`, `circle()` and `rect()` helpers there. `npm test` fails if the code asks for an icon that doesn't exist.
- If you change the CSP, change it in `index.html`, `scripts/serve.mjs` and `_headers`.

---

## 5. Suggested demo flow (about 3 minutes)

1. **Lock screen:** switch the language to isiZulu and back, then create a PIN. Try `123456` first to show it being rejected.
2. **Money:** add an income of R1,500 from 10 days ago and one of R1,200 from today, then add a R400 bill due next week. Show "safe to spend today" and the estimated next payday.
3. **Save:** start the emergency fund and move R100 into it. The safe amount on Home goes down. With example data loaded, the Holiday goal shows a per-week amount, that it's a stretch, and two small cuts; tap "Use this plan".
4. **Credit:** check R5,000 at 60% over 6 months, with a R600 initiation fee and a R69 monthly fee, against an income of R3,000/month. The repayment is about R1,172/month (39% of income) and the real yearly cost is about 239%. It is flagged **danger**, with the reasons explained.
5. **Scams:** paste *"Congratulations! You've won R50 000. Pay a R250 release fee and send the OTP to claim: bit.ly/xyz"*. It is rated **high risk**, with each warning sign explained.
6. **Security:** set "Lock when I leave the app for" to 30 sec in Settings, go to the home screen and back after 30 seconds, and the app is locked. Show that the content is blurred in the app switcher, and that DevTools → IndexedDB contains only ciphertext.
7. **Offline:** turn on flight mode and reload. Everything still works.

---

## 6. Known gaps and next steps
- The isiZulu translations **and isiZulu scam patterns** should be reviewed by a native speaker. The Afrikaans patterns would also benefit from a review.
- **Check the report contact numbers before each release:** SAPS Crime Stop 08600 10111, SAFPS 011 867 2234, NCR 0860 627 627, SASSA 0800 60 10 11, and phishing@sars.gov.za ([js/core/scam-advice.js](js/core/scam-advice.js)).
- Grow the scam test messages with real, anonymised messages, so the hit rate isn't measured on messages written alongside the rules.
- An on-device machine-learning classifier could sit next to the rules once there are a few hundred real messages to train and test on. Rules stay better at explaining *why*.
- Add hardware-backed unlock (WebAuthn PRF / passkeys, biometrics) and move from PBKDF2 to Argon2id.
- A Capacitor wrapper would allow Android `FLAG_SECURE` screenshot blocking and app-store distribution.
- Add more languages (isiXhosa, Sesotho, Setswana); the i18n structure and the per-language scam patterns already support this.
- Turn the browser checks used during development (onboarding, payment check, scam check, share target, delete-income) into a committed end-to-end test suite.

*Imali gives guidance, not financial advice. The credit caps it uses are from the National Credit Act; check ncr.org.za for current rates.*
