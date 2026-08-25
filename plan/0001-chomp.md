# Plan 0001: CHOMP

**From:** [`spec/0001-chomp.md`](../spec/0001-chomp.md) · [`intent/0001-chomp.md`](../intent/0001-chomp.md)
**Status:** approved
**Approved by:** @ragmha

Produced in Copilot CLI plan mode, which cannot edit files until the plan is
accepted — so this document existed before any source file did.

The test of this plan is whether an engineer who never saw the conversation
could implement CHOMP from it alone.

---

## Files that change

### The game

| Path | Purpose |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts` | toolchain, strict TS, no runtime deps |
| `index.html` | shell, CSP meta, `aria-live` region, canvas |
| `src/engine/rng.ts` | mulberry32 seeded PRNG |
| `src/engine/maze.ts` | 28×31 grid, tile kinds, tunnels, pellet placement |
| `src/engine/ghosts.ts` | four targeting policies, scatter/chase timetable |
| `src/engine/collision.ts` | tile overlap, pellet eating, ghost contact |
| `src/engine/scoring.ts` | pellets, combo ladder, extra-life threshold |
| `src/engine/state.ts` | `GameState`, `step(state, input) => state` |
| `src/render/canvas.ts`, `sprites.ts`, `hud.ts` | drawing; reads state only |
| `src/input/keyboard.ts`, `touch.ts` | normalise to `Intent` union |
| `src/main.ts` | accumulator, RAF loop, wiring |
| `src/a11y/announcer.ts` | throttled `aria-live` updates |

### The loop

| Path | Purpose |
|---|---|
| `.github/workflows/{ci,codeql,deploy,scorecard,agent-evals}.yml` | Test + Deploy stages |
| `.github/dependabot.yml` | supply chain |
| `.github/workflows/intent-to-spec.yml` | the automated Stage 1→2 handoff |
| `REVIEW.md` | review policy |
| `lefthook.yml` | pre-commit guardrail layer |
| `evals/**` | eval tasks + deterministic checks |
| `monitoring/bands.yaml`, `monitoring/detect.ts` | control bands + detector |
| `tools/watchtower/**` | Copilot SDK service |
| `demo/RUNBOOK.md`, `demo/reset.sh` | presenter material |

## Order of work

Ordered so that **stopping after step 6 still leaves a complete, honest demo**.

1. **Toolchain.** Vite + TS strict + Vitest + Playwright + ESLint. Prove
   `npm run typecheck && npm run lint && npm test && npm run build` runs green
   on an empty project before writing game code — an agent needs its feedback
   loop working before it can use it.

2. **Engine, bottom up.** `rng` → `maze` → `state` → `collision` → `scoring` →
   `ghosts`. Unit tests alongside each, not after. The engine is finished when
   a headless game can be driven to completion by a scripted input tape with no
   renderer in existence.

3. **Replay tape harness.** Record input sequences, hash final state, assert
   stability. This is the determinism proof and the eval oracle. It must exist
   before the renderer, or determinism will quietly rot.

4. **Renderer and input.** Canvas drawing, sprites, HUD, keyboard, touch.
   Accessibility built in here rather than retrofitted — A1–A8 are in scope for
   these files, not a later pass.

5. **CI, CodeQL, Dependabot, Scorecard, Pages deploy behind `production`.**

6. **`REVIEW.md`, ruleset, Copilot code review.** *The demo is coherent from
   here.*

7. Eval suite and `agent-evals.yml`.
8. `monitoring/` — bands, deterministic detector, and its unit tests.
9. `tools/watchtower/` — SDK service with OpenTelemetry, plus a `gh aw` variant.
10. `demo/RUNBOOK.md`, pre-baked `demo/*` branches, `demo/reset.sh`.

### Parallelism

Steps 2 and 5 touch no common files and run as concurrent Copilot app worktree
sessions. Step 4 depends on the types from step 2, so it follows rather than
parallelises. Steps 8 and 9 are independent of the game entirely.

## Risks

**R1 — Determinism leaks.** One `Math.random` or `Date.now` below `src/render/`
silently breaks replay, and the failure looks like a flaky test rather than a
design violation. *Mitigation:* an ESLint `no-restricted-globals` rule scoped to
`src/engine/**` that makes it a lint error, plus a replay test that runs the
same tape twice and compares hashes.

**R2 — The game isn't fun.** The highest-impact risk and the least testable.
Ghost targeting and the scatter/chase timetable are where fun lives; both are
tuning problems no unit test will settle. *Mitigation:* play it after step 2
using a debug renderer, before committing to sprite work. Budget real time for
tuning constants.

**R3 — Integer subpixel maths is fiddly.** Off-by-one at junctions produces
ghosts that stick to walls or tunnel through them. *Mitigation:* `maze.ts` gets
exhaustive junction tests first; movement is expressed as "advance one subpixel,
then resolve" rather than teleporting to targets.

**R4 — Playwright in CI is the slowest, flakiest link.** *Mitigation:* Chromium
only, screenshot diffs pinned to a fixed viewport and a seeded game, and the
report uploaded on failure so a red run is diagnosable without a rerun.

**R5 — The `production` gate blocks the demo itself.** A required reviewer on
`production` means the deploy waits for a human — including during rehearsal.
*Mitigation:* rehearse the approval; it's a demo beat, not an obstacle.

**R6 — Deliberate vulnerabilities in a public repo** (spec C3). Confined to
`demo/*` branches, never merged, header-commented.

## Options considered and rejected

- **A framework (React/Svelte).** Rejected: a canvas game gains nothing from a
  vdom, and zero runtime dependencies makes the supply-chain story about the
  toolchain rather than the bundle.
- **Float positions.** Simpler and conventional, but breaks replay determinism
  and therefore the eval oracle. Rejected deliberately; see spec §3.1.
- **CodeQL default setup.** One click, less to maintain. Rejected in favour of
  a workflow file, because this repo's argument is that configuration is a
  reviewable artifact — a setting in the UI can't be read on stage.
- **ECS architecture.** Overkill at four ghosts and one player.

## Proof

Each is checkable, and each maps to an acceptance criterion in the spec:

| Claim | Proof |
|---|---|
| Engine is pure | ESLint rule + zero matches for `Math.random\|Date.now\|document` under `src/engine/` |
| Deterministic | `replay.test.ts` runs a tape twice, asserts identical hash |
| Ghosts differ | `ghosts.test.ts` asserts each policy's target tile for a fixed board |
| Feel budgets met | `step()` benchmarked under 2ms; buffered-turn test |
| Accessible | axe-core clean; greyscale separability test; reduced-motion E2E |
| Secure | CodeQL `security-extended` clean on `main`; no `innerHTML` in tree |
| Provenance | `gh attestation verify` passes against the deployed bundle |
| Loop closes | tripping a band produces a new `intent/` entry unaided |

## Departures

Per `AGENTS.md`, any departure from this plan is recorded here in the same
commit that makes it.

| Date | Departure | Why |
|---|---|---|
| — | — | — |
