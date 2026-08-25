# Security policy

## Reporting a vulnerability

Please report security issues through
[private vulnerability reporting](https://github.com/ragmha/chomp/security/advisories/new)
rather than opening a public issue.

Expect an acknowledgement within a few days. CHOMP is a demonstration project
rather than production software, so there is no formal SLA — but reports are
genuinely welcome and will be acted on.

## Deliberate vulnerabilities

**This repository contains intentionally vulnerable code on branches named
`demo/*`.** They exist to demonstrate CodeQL, Copilot Autofix and secret
scanning push protection during a live talk, and each is marked with a header
comment saying so.

- These branches are **never merged to `main`**.
- `main` is expected to have **zero CodeQL alerts**; if CodeQL reports a
  finding there, that is a real bug and worth reporting.
- Any credential-shaped string in this repo is fake and was never valid.

### Reading the Security tab

OpenSSF Scorecard also uploads its results to code scanning, so the alert list
mixes two different things:

| Source | Meaning |
|---|---|
| **CodeQL** (`js/…`) | An actual vulnerability in the code. Should be zero on `main`. |
| **Scorecard** (`…ID`) | An advisory posture observation, not a bug. |

Some Scorecard findings here are accepted rather than fixed — `TokenPermissions`
flags the workflows that genuinely need `contents: write` to open a pull
request, for instance. Accepted findings are a deliberate choice, and the
reasoning belongs in the pull request that introduced them.

Please don't file reports for the `demo/*` branches — but do file one if
something from them ever reaches `main`, because that would be a genuine
process failure and exactly the sort of thing this repo is about catching.

## What is in scope

`main`, the workflows under `.github/workflows/`, and the deployed game at
https://ragmha.github.io/chomp/.

The game is a static bundle with no backend, no authentication and no user
data. It stores only a high score and key bindings in `localStorage`.

## Security posture

| Control | Status |
|---|---|
| CodeQL (`security-extended`) | on `main`, every PR, weekly |
| Copilot Autofix | enabled |
| Secret scanning + push protection | enabled |
| Dependabot alerts and updates | enabled, npm + Actions |
| OpenSSF Scorecard | weekly, published to code scanning |
| Actions pinned to commit SHAs | enforced, all workflows |
| Least-privilege workflow permissions | enforced, all workflows |
| Build provenance attestation | on every deploy |
| Runtime dependencies | none |

Verify what is deployed:

```bash
gh attestation verify --repo ragmha/chomp --owner ragmha <file-from-dist>
```
