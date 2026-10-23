---
name: security-scan
description: Run a Semgrep security scan of the Imali app (community rule packs plus the project's own rules in .semgrep/), check the rules really fire, then triage and fix findings. Use before commits, demos or releases, after any change touching js/, sw.js, scripts/serve.mjs or security headers, or when asked to "check security" or "run semgrep".
---

# Security scan with Semgrep

Imali has **no backend**: it is a client-side PWA whose data lives encrypted on the device. The attack surface is therefore the browser code (`js/`, `sw.js`), the dev server (`scripts/serve.mjs`) and the security headers (`index.html` CSP, `_headers`). Scan all of them.

## 1. Get Semgrep

Use `semgrep` if it is on PATH (`semgrep --version`). Otherwise install it into an isolated virtualenv in the scratchpad (never globally):

```bash
python -m venv <scratchpad>/semgrep-venv
<scratchpad>/semgrep-venv/Scripts/pip install -q semgrep   # bin/pip on macOS/Linux
```

On Windows, set `PYTHONUTF8=1` before running Semgrep, or it can crash on non-ASCII output.

## 2. Prove the project rules work

A rule file with a YAML error makes Semgrep report **0 findings**, which looks like a pass. Before trusting a scan, write a throwaway file `<scratchpad>/rulecheck/js/bad.js` containing one violation per rule in `.semgrep/imali.yml` (`el.innerHTML = x`, `eval(x)`, `fetch(url)`, `localStorage.setItem(k, v)`, `Math.random()`, `crypto.subtle.deriveKey(a, b, c, true, d)`, `{ name: 'AES-CBC' }`, `console.log(x)`, `h('a', { href: 'https://x' })`). Then run, from inside that folder:

```bash
semgrep scan --metrics=off --no-git-ignore --config <repo>/.semgrep/imali.yml --json .
```

Every rule id must appear in the results and `errors` must be empty. If not, fix the rule file first.

## 3. Scan

```bash
npm run security
```

This runs the project rules plus `p/javascript p/nodejs p/xss p/secrets p/owasp-top-ten p/security-audit p/insecure-transport`, with `--metrics=off` (no code or telemetry leaves the machine; only the public rules are downloaded) and `--error` (non-zero exit on findings). For machine-readable triage, add `--json --output <scratchpad>/semgrep.json`. Also check the summary: `Targets scanned` should cover the files in `js/`, and there should be no parse errors.

Then run `npm test` too. It enforces things Semgrep can't see: the CSP is identical in all three places, every file is in the offline cache, and the translations are complete.

## 4. Triage

For each finding, read the code and decide:

- **True positive:** fix the code, never the rule. Re-run until clean.
- **False positive:** only if you can explain why the input can't be attacker-controlled. Suppress it on that line with `// nosemgrep: <rule-id> -- <reason>`. Never suppress a whole file or rule.
- **New invariant:** if a fix reveals a security property the project relies on, add a rule to `.semgrep/imali.yml` (with `paths` scoping) and extend the step-2 fixture to cover it.

Report the result to the user with the number of rules and files scanned, the findings and what was done about each, and anything not covered (Semgrep doesn't check runtime behaviour; the browser e2e checks and `npm test` cover that).

## The project's security guarantees (what `.semgrep/imali.yml` enforces)

| Rule | Guarantee |
|---|---|
| `imali-no-html-sinks` | UI is built only with `h()` text nodes; Trusted Types stays enforceable |
| `imali-no-dynamic-code` | no `eval` / `new Function` / string timers / dynamic `import()` |
| `imali-no-network-calls` | app code never sends data off the device (only `sw.js` fetches its own files) |
| `imali-storage-only-via-vault` | user data is stored only through `js/vault.js` (AES-GCM); only prefs use localStorage |
| `imali-no-math-random` | randomness comes from `crypto` |
| `imali-no-extractable-keys` | CryptoKeys are non-extractable and never exported |
| `imali-weak-crypto` | AES-GCM + SHA-256 only |
| `imali-no-console` | no logging of financial data |
| `imali-no-external-urls` | no external resources (offline, no tracking, matches CSP) |
