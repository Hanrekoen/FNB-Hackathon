# Imali: money confidence for everyone

**FNB Hackathon: Financial inclusion and money confidence**

> How might we make everyday money management simpler, safer and more useful for people with irregular incomes, limited financial knowledge or limited access to formal services?

Imali (isiZulu/isiXhosa for "money") is a private, offline-first, multilingual money companion. It installs on any phone straight from the browser. There's no app store and no account, and after the first visit it uses almost no data.

## How it covers each focus area

| Focus area | What Imali does |
|---|---|
| **Budgeting** (irregular income) | No monthly budget. Imali works out a **"safe to spend today"** amount: free money, minus bills due before the next income that aren't set aside yet, divided by the days left. Users say how they're paid (monthly, every two weeks, weekly or "it varies"); for "it varies" it learns the gap between incomes, plans from a longer-than-usual gap, and plans 7 more days when income is late. It nudges if real income doesn't match the stated pattern. Bills can be monthly, weekly or once-off, and amounts that vary (taxi, fuel) are estimated from the last 6 weeks. |
| **Three buckets** | When money arrives, one tap splits it: **Needs** (bills due before the next income; hard-guarded, released only after a 3-day notice that warns if a bill would be left short), **Safety** (emergency fund and goals; available instantly after a screen showing what withdrawing means) and **Free** (becomes safe-to-spend). Money is set aside *in Imali*: it never moves at a bank. |
| **Saving** | "Pay yourself first": the savings % of each income goes to the emergency fund first. Goals can have a deadline: Imali works out how much to put aside each payday (or each week if income varies), checks it against a careful estimate of income (the 25th percentile of rolling 30-day totals) minus bills, normal spending and other commitments, and says whether it's on track. If not, it suggests specific cuts (only to extras like fun, clothing and food, never rent, school, health, transport or family), a later date, or a lower amount. Each income split then sets aside every dated goal's per-payday amount, nearest deadline first. |
| **Intelligence** | Run-out forecast ("at this pace you run out on the 3rd, 5 days before your next income") and the user's biggest spending weekday. Every insight shows the numbers it used. |
| **Responsible credit** | Loan checker shows the monthly repayment, total payback, "for every R100 you pay back R…", the real yearly cost including fees, and affordability against income. It flags rates above the National Credit Act maximum, explains borrower rights and lists signs of an illegal lender. |
| **Scam awareness** | Paste or share any SMS, WhatsApp or email to get an **offline** risk check in English, Afrikaans or isiZulu. It highlights the exact words that gave it away, catches disguises ("0TP", "O.T.P"), fake bank domains and dangerous combinations, and gives next steps with tap-to-call report numbers. 30 warning signs including SASSA SRD, parcel-fee, RICA, money-flip and rental scams. Also a "scam or real?" practice game, scam of the week, and a check before big payments. Catches 60/60 test scams with 0/40 false alarms (`npm run scam-report`). |
| **Low-data tools** | Under 300 KB in total (less when compressed), no web fonts, no frameworks. A service worker caches everything, so the app works fully offline. |
| **Multilingual** | English, Afrikaans and isiZulu, switchable on the lock screen and in Settings. The language picker is labelled in all three languages. |
| **Icons** | Inline SVG line icons (no emoji), so they look the same on every phone and follow dark and high-contrast modes. Shapes adapted from [Lucide](https://lucide.dev) (ISC licence). |
| **Accessible design** | Semantic HTML, labelled inputs, screen-reader announcements, focus management, 44–48 px tap targets, larger text and high-contrast modes, dark mode and reduced motion. Works from 320 px phones up to desktop. |

## Security

Everything stays on the device. There is no server, no account and no network requests after load, so there is no central database to breach.

- **Encryption at rest:** all data sits in IndexedDB encrypted with **AES-256-GCM**. The key comes from the user's PIN via **PBKDF2-SHA256 with 600,000 iterations** (the OWASP 2023 figure) and a random 128-bit salt. A fresh random IV is used on every save. Keys are non-extractable `CryptoKey`s that exist only in memory while unlocked. GCM authentication means tampered data fails to decrypt.
- **Lock behaviour:** auto-lock after 1–10 minutes idle, and whenever the app is in the background for longer than the chosen grace period (30 s, 2 min or 5 min; 5 min by default so judges switching apps aren't locked out repeatedly). Locking drops the key and data from memory and removes them from the screen. Content is blurred in the app switcher. Reloading always asks for the PIN.
- **Brute-force protection:** exponential back-off after 5 wrong PINs (30 s, doubling up to 1 h). There's an optional "erase after 10 wrong tries" setting, and weak PINs (123456, 111111, 121212…) are rejected.
- **Backups** use a separate password of at least 10 characters, because the file can leave the phone.
- **Injection-proof UI:** no `innerHTML` anywhere. All text goes in through `textContent`, and the CSP enforces **Trusted Types**, so HTML sinks throw even if a bug tried to use one.
- **Strict CSP:** `default-src 'none'`, `script-src 'self'`, no inline or eval code, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`. Plus HSTS, `nosniff`, `no-referrer`, COOP/COEP/CORP and a locked-down Permissions-Policy (see [_headers](_headers)).
- **Zero dependencies:** no npm packages at runtime or build time, so there is no supply-chain risk.
- **Input validation:** money is stored as integer cents (no float errors), with range checks. Imported data is shape-checked, and iteration counts are bounded so a crafted backup can't freeze the phone. Regexes use bounded repetition only, so they can't be used for a ReDoS attack.

**Known limits (be upfront with judges):** someone who extracts the browser storage from a phone can try PINs offline, and a 6-digit PIN only slows them down. Encourage longer PINs or "use letters too". Production next steps: bind the key to device hardware with **WebAuthn PRF / passkeys** (biometric unlock); move to Argon2id via WASM; and add a native wrapper (Capacitor) for `FLAG_SECURE` screenshot blocking on Android.

## Run it

Requires Node 22+ for the dev server and tests. The app itself is static files.

```bash
npm start          # http://127.0.0.1:8080, with production security headers
npm test           # unit + project checks (logic, buckets, forecasts, migration, example data, crypto, translations, CSP, offline cache)
npm run icons      # regenerate PNG icons
```

**On a phone:** browsers only allow encryption and offline mode over **HTTPS** (or localhost). Deploy the folder to any static host, such as **Netlify** or **Cloudflare Pages** (both read [_headers](_headers)) or GitHub Pages. Then open the URL and choose *Add to Home screen* (Android: browser menu; iPhone: Share → Add to Home Screen).

**For judges:** create any PIN, choose how you're paid (or skip), then tap **Load example data** on Home for a realistic month. Settings → Example data clears it.

When you change any app file, bump `VERSION` in [sw.js](sw.js) so installed copies update. `npm test` fails if a file is missing from the offline cache list.

## Project layout

```
index.html, manifest.webmanifest, sw.js   PWA shell, offline cache
css/app.css                               mobile-first styles, dark / high-contrast / large-text
js/app.js                                 router, auto-lock, privacy blur, SW registration
js/vault.js, js/idb.js                    encrypted storage
js/core/*                                 pure logic (budget, buckets, goals, income, forecast, schema, demo, credit, scam rules, crypto, PIN rules), unit tested
js/icons.js                               SVG icon set (no emoji)
js/views/*                                screens
js/lang/{en,af,zu}.js                     translations (isiZulu should get a native-speaker review)
scripts/serve.mjs, scripts/make-icons.mjs dev server, icon generator
tests/                                    node:test suites
```

*Imali gives guidance, not financial advice. Credit limits referenced are those set under the National Credit Act; check ncr.org.za for current rates.*
