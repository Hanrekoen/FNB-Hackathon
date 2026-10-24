# Changelog

## 2026-10-24: scam checker upgrade, icons, delete-income fix

35 files changed: about 2,200 lines added and 265 removed. Tests went from 89 to **115**, and all pass. The Semgrep security scan found **0 findings** across 53 files.

### 1. Fixed: deleting an income left money stuck in Needs

**The bug:** add an income of R2,000 and apply its split (R1,200 goes to Needs for rent). Then delete that income from History. Before this fix:
- cash showed −R80, Needs R1,200 and Free −R1,280;
- safe-to-spend was R0;
- the only way out was a 3-day release, because Needs entries can't be deleted.

**The fix:**
- The Needs and Safety amounts set aside from an income now remember which income they came from (`fromIncome`).
- New `deleteTransaction()` in [js/core/buckets.js](js/core/buckets.js):
  - Deleting an income also removes the Needs and Safety amounts set aside from it.
  - Afterwards, Needs is trimmed so it never holds more than the cash really on hand. This covers older data saved before the link existed.
- The delete confirmation now says what else changes, for example "This also removes R1,280 that was set aside or saved from this income."
- **Data:** the version goes from 2 to 3 ([js/core/schema.js](js/core/schema.js)). The new `fromIncome` and `correction` fields are checked when data is loaded.

### 2. All emoji replaced with icons

- Every emoji in the app was replaced with an SVG icon from [Lucide](https://lucide.dev) (free, ISC licence; the notice is kept in the file).
  - [js/icon-data.js](js/icon-data.js) holds the shapes for 42 icons. They were downloaded once; only plain shapes were kept.
  - [js/icons.js](js/icons.js) builds the icons in the page, so nothing is fetched and the app still works offline and within the security policy.
- **Where they're used:** the tab bar, the settings and lock buttons, transaction rows, loan results, card headings, delete buttons, and the language picker.
- **Translations:** emoji were removed from 15 strings in each of the three language files.
- **Tests:** a test fails if an emoji appears anywhere in the app, and another checks that every icon name used in the code exists.

### 3. Scam checker: new engine

**Text preparation** ([js/core/scam-text.js](js/core/scam-text.js)):
- Cleans the message up (lowercase, Unicode normalisation, invisible characters removed, spaces collapsed). Every character keeps a link back to the original, so matches can be highlighted in what the user pasted.
- Undoes disguises: "0TP" → otp, "p1n" → pin, "f33" → fee, and "O.T.P" or "P I N" are joined up. Rand amounts and units ("R1 000", "24h") are left alone.

**Links and numbers** ([js/core/scam-links.js](js/core/scam-links.js)):
- Bank or brand names in someone else's domain, such as `fnb-verify.xyz`.
- Look-alike domains, such as `capltecbank.co.za` or `takeal0t.com`.
- Unicode and punycode tricks in domains.
- Links that are raw IP addresses.
- Foreign phone numbers in a message that names a South African bank.

This is all done offline, against a fixed list of real domains. The app never contacts any of these sites.

**Rules and scoring** ([js/core/scam.js](js/core/scam.js)):
- **30 warning signs** (up from 16). Each is stored as data with English, Afrikaans and isiZulu patterns, and all three are checked whatever language the app is in. The 14 new signs:
  - SASSA SRD grants and parcel or customs fees;
  - RICA / SIM blocking and cheap prepaid electricity;
  - money flips and pyramid "stokvels";
  - work from home, romance, rental deposits, and fake payments or overpayments;
  - "call this number" and premium-rate numbers;
  - foreign numbers, fake domains and IP links.
- **isiZulu** patterns match verb stems, because the verbs take prefixes and suffixes ("thumela" → "uthumele").
- **Dangerous combinations:** any of these makes a message high risk:
  - bank + OTP;
  - bank or SASSA + link;
  - bank + foreign number;
  - "new number" + money request;
  - remote-access app + bank.
- **Advice isn't a request:** "never share your OTP" is ignored when the negation is in the same clause, in all three languages (including isiZulu "ungathumeli", "don't send"). "We never ask for your PIN, **but** confirm your OTP" is still flagged.
- **Long messages:** only warning signs within 600 characters of each other add up.
- **Everyday congratulations** ("Congratulations on your new baby!") no longer count as a prize scam. "Congratulations" only counts near words like "won", "prize" or "claim".
- A **rules version date** is shown under the checker.

**Advice** ([js/core/scam-advice.js](js/core/scam-advice.js)):
- **Next steps** that depend on what was found.
- **Report contacts:** SAPS Crime Stop, SAFPS, NCR, SASSA, and the SARS phishing email. There are no bank-specific numbers; users are told to call the number on the back of their card.
- Finding the rand amount in a message, for the loan link.
- The payment-check rule, the practice answers, and the scam-of-the-week rotation.

### 4. Scam screen and links to the rest of the app

**Scam screen** ([js/views/scams.js](js/views/scams.js), rewritten):
- **Getting a message in:** **Paste** and **Try an example** buttons, and **sharing straight from WhatsApp or SMS**. Sharing works on Android once the app is installed; the shared text is removed from the address bar straight away.
- **The result:**
  - a big risk level and one sentence of advice;
  - combination warnings;
  - **"What to do now"** steps with **tap-to-call** numbers;
  - **"What gave it away"**: the message with the **exact words highlighted**;
  - **Read aloud**.
- **Saving:** **Save to my history** and **This result looks wrong**. Both are kept on the phone only, encrypted, and included in the backup. A **Saved checks** list lets you check again or delete (at most 30 are kept).
- **Learning:**
  - **Scam or real?**, a practice game with 10 messages per language;
  - **Learn the warning signs**, all 30 signs with an example each.

**Elsewhere in the app:**
- **Home:** a **Scam of the week** card.
- **Money:** a payment of R2,000 or more, R500 or more to family, debt or "other", or more than half your cash asks "Is this because of a message or call?" before it's saved.
- **Credit:** a loan scam's **"Check what this loan really costs"** button opens the loan checker with the amount filled in.
- **Supporting changes:**
  - [manifest.webmanifest](manifest.webmanifest) registers Imali as a share target;
  - [js/dom.js](js/dom.js) allows `tel:` links to fixed numbers (digits only);
  - [sw.js](sw.js) caches the 5 new files and is bumped to `imali-v3`.
- **Translations:** 106 new strings in each of English, Afrikaans and isiZulu.

### 5. Tests and tools

- **New [tests/scam.test.mjs](tests/scam.test.mjs)** (20 tests):
  - disguises, negation and combinations;
  - the 600-character window and highlight positions;
  - **every warning sign's example triggers it, in all three languages**;
  - the practice answers are right in all three languages;
  - domain checks, next steps and amount extraction;
  - worst-case input can't freeze the checker;
  - **at least 90% of test scams caught and at most 5% of real messages flagged**.
- **New [tests/fixtures/scam-corpus.mjs](tests/fixtures/scam-corpus.mjs):** 60 scam and 40 real messages, hand-written to look like South African SMS, WhatsApp and email.
- **New [scripts/scam-report.mjs](scripts/scam-report.mjs)** (`npm run scam-report`): hit rate, false alarms, misses, and how often each rule fires. Currently **60/60 caught and 0/40 false alarms**. This is optimistic, because the messages were written alongside the rules.
- **Added to existing tests:**
  - delete-income tests in [tests/buckets.test.mjs](tests/buckets.test.mjs);
  - saved-check and income-link validation in [tests/migrate.test.mjs](tests/migrate.test.mjs);
  - the no-emoji and icon checks in [tests/project.test.mjs](tests/project.test.mjs).
- **In the browser:** checked in headless Chrome. All 16 flows pass with no console errors or security-policy violations:
  - onboarding and example data;
  - the payment check, scam check, saving, practice and the loan link;
  - delete-income;
  - sharing into the app, and dark mode.

  The script used is not in the repo.

### 6. Docs

- [GUIDE.md](GUIDE.md) is fully rewritten. It covers the buckets, income, forecast and example-data features and everything above, plus how to run and test it, a demo flow, and known gaps.
- [README.md](README.md): the scam-awareness row is updated.

### Still to do

- **Have native speakers review the isiZulu and Afrikaans** scam patterns and translations.
- **Check the report contact numbers** in [js/core/scam-advice.js](js/core/scam-advice.js) before release:
  - SAPS Crime Stop 08600 10111;
  - SAFPS 011 867 2234;
  - NCR 0860 627 627;
  - SASSA 0800 60 10 11;
  - phishing@sars.gov.za.
- **Add real, anonymised scam messages** to the test set, so the hit rate isn't measured on messages written alongside the rules.
- **Known limit:** the 3-day Needs notice is a self-discipline tool, not a hard lock. Changing the phone's clock gets around it, and so does deleting an income and re-adding it without applying the split.

### How to check it

```bash
npm test               # 115 tests
npm run scam-report    # scam checker hit rate on the test messages
PYTHONUTF8=1 npm run security   # Semgrep (needs semgrep installed; see GUIDE.md)
```
