# Imali: what we built and how to run it

This is a full walkthrough of the Imali app built for the FNB Hackathon (theme: *financial inclusion and money confidence*). The [README](README.md) is the short pitch; this guide covers what each part does, how it fits together, and how to run, test and deploy it.

---

## 1. The idea in one paragraph

Imali (isiZulu/isiXhosa for "money") is a money companion for people with **irregular incomes, limited financial knowledge, or limited access to formal banking**. It is a **Progressive Web App (PWA)**: it opens in any phone browser and can be added to the home screen. It needs no app store, no account and no server, and it works **fully offline** after the first visit. All data stays on the phone, **encrypted with the user's PIN**. It is available in **English, Afrikaans and isiZulu**.

---

## 2. What the user sees

### First run and lock screen ([js/views/gate.js](js/views/gate.js))
- **Onboarding:** pick a language, enter a name (optional) and choose a PIN of at least 6 characters. Weak PINs such as `123456`, `111111` or `121212` are rejected.
- **Restore:** a backup file can be restored on a new phone from the same screen.
- **Unlock:** after the first run, the app always opens on the PIN screen. After 5 wrong tries it makes you wait (30 s, doubling each time up to 1 hour). There is an optional setting to erase all data after 10 wrong tries.

### Home ([js/views/home.js](js/views/home.js))
The main number is **"Safe to spend today"**, plus cash on hand, bills coming up and shortcuts to the other screens.

### Money / budget ([js/views/budget.js](js/views/budget.js), logic in [js/core/budget.js](js/core/budget.js))
Imali does not use a monthly budget, because a monthly budget doesn't fit someone whose pay is irregular. It works like this instead:

1. **Cash on hand** = money in − money out − money moved into savings.
2. **Next income date** is taken from one of these, in order:
   - a date the user entered;
   - an estimate: the median gap between recent incomes, added to the last income date;
   - if that estimate has passed and no money has arrived (income is "late"), today + 7 days;
   - with no history at all, today + 14 days.
3. **Bills due before then** (monthly bills on a day of the month; day 31 becomes the last day of short months) are set aside.
4. **Safe per day** = (cash − bills due) ÷ days until next income.

The screen also has:
- **Add income or expense**, with categories ([js/core/categories.js](js/core/categories.js)).
- **Income split:** when money comes in, Imali suggests how to divide it: cover any bills not yet covered, then savings (a percentage the user picks), then daily spending.
- **Bills:** add bills and mark them paid. Paying a bill doesn't count as daily spending.
- **This month:** income, spending and spending by category.
- **History:** a list of transactions, which can be deleted.
- A warning when the bills add up to more than the cash on hand.

### Save ([js/views/savings.js](js/views/savings.js))
- The "pay yourself first" rule and the savings percentage.
- **Savings goals** with progress bars. Users can move money into a goal or take it back out.
- A one-tap **emergency fund** starter goal.

### Credit / loan checker ([js/views/credit.js](js/views/credit.js), logic in [js/core/credit.js](js/core/credit.js))
The user enters a loan amount, interest rate, term, initiation fee and monthly fee. Imali shows:
- the monthly repayment, the total paid back, and **"for every R100 you borrow you pay back R…"**;
- the **real yearly cost including fees** (effective annual rate, found by bisection);
- how many months it would take to save the same amount instead.

It then rates the loan as **ok / caution / danger**:
- **Danger:** rate above 60%/year (the National Credit Act short-term cap, so the lender is probably illegal); repayment above 30% of income; or total cost at least equal to the amount borrowed.
- **Caution:** rate above 28%; repayment between 20% and 30% of income; income unknown; or fees adding more than 10 percentage points to the real rate.

Below the result are borrower rights and the warning signs of an illegal lender (*mashonisa*).

### Scams ([js/views/scams.js](js/views/scams.js), logic in [js/core/scam.js](js/core/scam.js))
- **Message checker:** paste an SMS, WhatsApp message or email. It is checked **on the phone** against about 18 weighted rules: requests for an OTP, PIN or CVV; remote-access apps (AnyDesk, TeamViewer); upfront fees; money-mule requests; prizes; urgency; "guaranteed returns"; gift cards and airtime; "no credit check" loans; secrecy; pretending to be SARS, SASSA, a bank or the police; "new number" scams; job fees; short links and suspicious domains. The rules include some Afrikaans keywords. The result is **none / low / medium / high** risk, with a plain-language explanation of each warning sign it found.
  - A real bank notice that says "*never* share your OTP" is **not** flagged.
  - Every regex has bounded repetition and input is capped at 5,000 characters, so a crafted message can't freeze the phone (ReDoS).
- Golden rules, a short quiz, and what to do if you've been scammed.

### Settings ([js/views/settings.js](js/views/settings.js))
- **Display:** language, larger text, high contrast and dark mode ([js/prefs.js](js/prefs.js), saved in `localStorage`; no financial data is stored there).
- **Profile** name.
- **Install** button (uses the browser's install prompt where available).
- **Change PIN.**
- **Backup and restore:** an encrypted backup file protected by a **separate password of at least 10 characters**, since the file can leave the phone.
- **Security:** auto-lock after 1, 3, 5 or 10 minutes, and the erase-after-10-wrong-tries option.
- **Danger zone:** erase everything.

### Across the whole app ([js/app.js](js/app.js))
- A hash router (`#/home`, `#/money`, `#/save`, `#/credit`, `#/scams`, `#/settings`) with a bottom tab bar.
- **Auto-lock** when idle, and whenever the app has been in the background for more than 30 seconds.
- Screen content is **blurred in the app switcher**.
- Toasts, confirm dialogs and focus management for screen readers.
- Service worker registration, so the app works offline.

---

## 3. How it's built

**No frameworks and no dependencies.** It is plain HTML, CSS and ES modules, about 600 KB on disk including icons, and works on cheap phones and expensive data.

```
index.html, manifest.webmanifest, sw.js   PWA shell, CSP meta tag, offline cache
_headers                                  security headers for Netlify / Cloudflare Pages
css/app.css                               mobile-first styles; dark, high-contrast and large-text modes
js/app.js                                 router, auto-lock, privacy blur, Trusted Types policy, SW registration
js/dom.js                                 h(): the only way UI is built (text nodes only, no innerHTML)
js/i18n.js + js/lang/{en,af,zu}.js        translations and t() lookup with placeholders
js/prefs.js                               display preferences (localStorage)
js/idb.js                                 small IndexedDB wrapper
js/vault.js                               encrypted storage: create / unlock / lock / save / backup / restore
js/core/                                  pure logic with no DOM, all unit-tested
  budget.js      safe-to-spend, income gap, bill due dates, income split
  credit.js      repayment, effective rate, loan risk assessment
  scam.js        offline scam rules
  crypto.js      PBKDF2 + AES-GCM helpers
  security.js    PIN and backup-password rules
  money.js       parse and format rand amounts as integer cents
  dates.js       ISO date arithmetic
  categories.js  spending categories
js/views/                                 one module per screen, plus shared ui.js helpers
scripts/serve.mjs                         zero-dependency dev server with production headers
scripts/build.mjs                         copies only the app files into dist/
scripts/make-icons.mjs                    generates the PNG icons
tests/                                    node:test suites
.semgrep/imali.yml                        project-specific security rules
.claude/skills/security-scan/             Claude Code skill to run and triage the Semgrep scan
```

**Data flow:** views call `ctx` helpers, which change `vault.getData()`. `vault.save()` then encrypts the whole data object and writes it to IndexedDB. Saves are queued, so they never overlap.

### Security model
- **Encryption at rest:** AES-256-GCM. The key is derived from the PIN with PBKDF2-SHA256 (600,000 iterations) and a random 128-bit salt, and every save uses a new random IV. The key is a **non-extractable** `CryptoKey` that exists only in memory while the app is unlocked. Tampered data fails to decrypt.
- **Locking** drops the key and the decrypted data from memory and clears the screen.
- **No network:** after the app loads it sends no requests, has no analytics and loads no external URLs. The CSP `default-src 'none'` enforces this.
- **No HTML injection:** all UI goes through `textContent`, and the CSP requires **Trusted Types**, so any `innerHTML` use would throw.
- **Strict headers:** CSP, HSTS, `nosniff`, `no-referrer`, COOP/COEP/CORP and a locked-down Permissions-Policy. The CSP is identical in [index.html](index.html), [scripts/serve.mjs](scripts/serve.mjs) and [_headers](_headers), and a test checks that they match.
- **Input validation:** money is stored as integer cents, with range checks. Imported backups are shape-checked and their iteration counts are bounded.
- **Known limit:** someone who copies the browser storage off a phone can try PINs offline, and a 6-digit PIN only slows them down. Next steps are WebAuthn/passkey unlock, Argon2id, and a native wrapper for screenshot blocking.

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
PORT=3000 npm start                  # Git Bash / macOS / Linux
$env:PORT=3000; npm start            # PowerShell
```

> Encryption (Web Crypto) and the service worker only work on **localhost or HTTPS**. Opening `index.html` straight from disk (`file://`) won't work, and neither will opening `http://<your-LAN-IP>:8080` from a phone. To use it on a phone, deploy it (see below).

### Run the tests
```bash
npm test
```
There are 40 tests in 6 suites, and they currently all pass:
- **[tests/core.test.mjs](tests/core.test.mjs):** money parsing and formatting, date arithmetic, budget logic (income gaps, late income, bills in short months, shortfall, income split), credit maths and risk flags, scam checker (true positives, "never share" notices not flagged, huge input), PIN rules.
- **[tests/crypto.test.mjs](tests/crypto.test.mjs):** encrypt/decrypt round trip, a new IV each time, a wrong PIN, tampered data or wrong context all fail, keys can't be exported, iteration bounds, record shape checks.
- **[tests/project.test.mjs](tests/project.test.mjs):** every translation key exists in all three languages with matching placeholders, every app file is in the service-worker cache, no unsafe HTML or `eval` APIs are used, and the CSP is strict and identical in all three places.

### Security scan (optional)
Needs [Semgrep](https://semgrep.dev) (`pip install semgrep`):
```bash
npm run security
```
This runs the project rules in [.semgrep/imali.yml](.semgrep/imali.yml) together with the community JavaScript, XSS, secrets and OWASP rule packs. In Claude Code, the `/security-scan` skill runs the same scan, first checks that the rules really fire, and then triages the findings.

### Regenerate icons
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
   - **Android (Chrome):** menu ⋮ → *Add to Home screen* / *Install app*.
   - **iPhone (Safari):** Share → *Add to Home Screen*.
4. Turn on flight mode and open the app: it still works.

### When you change app files
- Bump `VERSION` in [sw.js](sw.js) (for example `imali-v1` → `imali-v2`) so installed copies pick up the new files.
- If you add a new file under `js/`, `css/` or `icons/`, add it to the `ASSETS` list in `sw.js`. `npm test` fails if you forget.
- If you add a new piece of text, add its key to all three files in `js/lang/`. `npm test` fails if a key or placeholder is missing.
- If you change the CSP, change it in `index.html`, `scripts/serve.mjs` and `_headers`.

---

## 5. Suggested demo flow (about 3 minutes)

1. **Lock screen:** switch the language to isiZulu and back, then create a PIN. Try `123456` first to show it being rejected.
2. **Money:** add an income of R1,500 from 10 days ago and one of R1,200 from today, then add a R400 bill due next week. Show "safe to spend today" and the estimated next payday.
3. **Save:** start the emergency fund and move R100 into it. The safe amount on Home goes down.
4. **Credit:** check R5,000 at 60% over 6 months, with a R600 initiation fee and a R69 monthly fee, against an income of R3,000/month. The repayment is about R1,172/month (39% of income) and the real yearly cost is about 239%. It is flagged **danger**, with the reasons explained.
5. **Scams:** paste *"Congratulations! You've won R50 000. Pay a R250 release fee and send the OTP to claim: bit.ly/xyz"*. It is rated **high risk**, with each warning sign explained.
6. **Security:** go to the home screen and back after 30 seconds, and the app is locked. Show that the content is blurred in the app switcher, and that DevTools → IndexedDB contains only ciphertext.
7. **Offline:** turn on flight mode and reload. Everything still works.

---

## 6. Known gaps and next steps
- The isiZulu translation should be reviewed by a native speaker.
- Add hardware-backed unlock (WebAuthn PRF / passkeys, biometrics) and move from PBKDF2 to Argon2id.
- A Capacitor wrapper would allow Android `FLAG_SECURE` screenshot blocking and app-store distribution.
- Add more languages (isiXhosa, Sesotho, Setswana); the i18n structure already supports this.
- Add browser end-to-end tests (for example Playwright) to go with the unit tests.

*Imali gives guidance, not financial advice. The credit caps it uses are from the National Credit Act; check ncr.org.za for current rates.*
