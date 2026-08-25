# REVIEW.md — CHOMP PR Review Policy

Read by Copilot code review and the verifier agent. Every PR is assessed
against all three passes below. Findings are ranked **Important** or **nit**;
the ranking rules are in the section that follows.

---

## The three passes

### Pass 1 — Bugs

Logic errors, broken edge cases, and regressions. Specifically:

- Does the change introduce a state mutation where a reducer return is required?
- Does `step(state, input) => state` still hold — no side effects, no mutation
  of the input object?
- Are junction and tunnel-wrap edge cases handled for the movement change?
- Does any replay tape break? (Run the tape twice and hash; the hashes must
  match.)
- Are new branches covered by unit tests, or does the change remove coverage
  without reason?

Tag findings: **[Bug]**

### Pass 2 — Security

Per the `secure-web-app` skill:

- Any `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or
  `element.srcdoc` — flag as **Important** regardless of context.
- Any `eval`, `new Function`, or `setTimeout`/`setInterval` with a string body.
- Any third-party CDN reference (scripts, fonts, styles) — breaks the CSP and
  the attestation story.
- Any token, secret, or credential in code or config.
- Player input not validated at the boundary (12-char cap, regex allowlist).
- A new GitHub Actions step that is not pinned to a full 40-char commit SHA
  with a version comment.
- A workflow that does not declare an explicit `permissions:` block.

Tag findings: **[Security]**

### Pass 3 — Compliance

Does the change match `spec/0001-chomp.md` and `plan/0001-chomp.md`, and do the
three skills' rules hold?

- **Engine purity** — is there any `Math.random`, `Date.now`, `document.`,
  `window.`, or `localStorage` reference under `src/engine/`? Flag every
  instance.
- **`game-feel` skill** — input budget ≤ 1 tick; turn buffer ≤ 8 ticks; fixed
  timestep; 30-tick death freeze; asymmetric speeds. Verify anything touching
  the input path or main loop.
- **`a11y-arcade` skill** — meaning not in hue alone; all keys remappable;
  `prefers-reduced-motion` honoured; `aria-live` announcer intact; canvas
  `role="img"` present; pause via `Escape`/`P` with focus trap; HUD contrast
  ≥ 4.5:1; no flashing above 3Hz.
- **Departure from `plan/`** — any implementation that diverges from
  `plan/0001-chomp.md` must be recorded in the plan's Departures table in the
  same commit. If the table has a new entry, check it explains *why*.

Tag findings: **[Compliance]**

---

## What "Important" means here

Reserve **Important** for findings that:

- **Break behaviour** — a logic error, a regression, a flaky test introduced.
- **Leak data** — a DOM XSS vector, a secret in code, a CSP bypass.
- **Breach a skill policy** — engine purity, `no-innerHTML`, action SHA pinning,
  an undocumented departure from `plan/`.

Style issues, naming preferences, missing comments, and test hygiene that
doesn't affect correctness are **nits**.

---

## Cap the nits

Report at most **five nits** per review. If there are more, write:

> *N additional nits not listed — style and naming only, none affect behaviour.*

Flooding a review with nits obscures the Important findings.

---

## Do not report

- **Generated files** — anything under `src/gen/`, `dist/`, `*.lock.yml`.
- **Items CI already enforces** — lint errors, type errors, formatting. If CI
  is red, the PR shouldn't be open; don't re-list those findings here.
- **Deliberate demo vulnerabilities** on `demo/*` branches — see `spec/0001-chomp.md`
  §6 C3. They are documented in `demo/RUNBOOK.md` and must never be merged to
  `main`.

---

## Repo-specific things to always check

1. **Engine purity.** Zero matches for `Math.random`, `Date.now`, `document.`,
   `window.`, `localStorage` under `src/engine/**`. One hit is an Important
   finding; the replay tape and the eval oracle depend on this invariant.

2. **No `innerHTML` anywhere.** The full list: `innerHTML`, `outerHTML`,
   `insertAdjacentHTML`, `document.write`, `element.srcdoc`. The `secure-web-app`
   skill forbids them and CodeQL flags them. If they appear, the PR does not
   merge.

3. **Actions SHA-pinned.** Every `uses:` must be a full 40-character commit
   SHA. A version tag (`@v4`) is not a pin — tags are mutable. Flag each
   unpinned action as **Important [Security]**.

4. **Departure from `plan/` is recorded.** Any diff that diverges from
   `plan/0001-chomp.md` and has no matching row in the Departures table is an
   Important finding. The requirement is in `AGENTS.md`.

---

*This file is read by Copilot code review automatically on every PR. Keep it
short — it is also read aloud on stage.*
