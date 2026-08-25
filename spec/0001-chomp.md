# Spec 0001: CHOMP

**From:** [`intent/0001-chomp.md`](../intent/0001-chomp.md)
**Status:** accepted
**Reviewed by:** @ragmha

<details>
<summary>Provenance — the prompt and the policy in force when this was written</summary>

Produced in a Copilot app session with the repo's skills loaded, from this
prompt:

> Read `intent/0001-chomp.md` and produce a requirements and design spec.
> Apply the skills available to you so the design conforms to our game-feel,
> security and accessibility standards. Document it fully as `spec/0001-chomp.md`,
> ready to hand to engineering. Describe clearly any areas of concern,
> especially where you cannot satisfy contradicting policies.

Skills in force at `6bdbfd0`: `game-feel`, `secure-web-app`, `a11y-arcade`.
Instructions in force: `.github/copilot-instructions.md`, `AGENTS.md`.

</details>

---

## 1. Summary

Build **CHOMP**, an original maze-chase arcade game, and use it as the payload
for a live demonstration of the AI-native SDLC on GitHub.

The spec covers two products that must both be good, because each is the
other's evidence:

- **The game.** If it isn't fun, the claim that this process produces quality
  is refuted in the first ten seconds.
- **The loop.** If the artifact chain isn't honest, the whole thing is theatre.

## 2. Functional requirements — the game

### 2.1 Core loop

| ID | Requirement |
|---|---|
| G1 | Player navigates a maze on a 28×31 tile grid, eating pellets |
| G2 | Four ghosts pursue with visibly different behaviour |
| G3 | Four power pellets flip ghosts to a frightened state for a level-dependent duration |
| G4 | Eating frightened ghosts scores 200/400/800/1600, resetting each power pellet |
| G5 | Clearing all pellets advances the level; difficulty rises |
| G6 | Contact with a non-frightened ghost costs a life; three lives; extra life at 10,000 |
| G7 | Horizontal tunnel wraps left↔right; ghosts move at reduced speed inside it |
| G8 | High score persists in `localStorage` |

### 2.2 Ghost behaviour

Distinct targeting is the design's centre of gravity — it's what separates a
maze-chase game from a game about being chased by four identical things. Each
ghost computes a target tile each frame and greedily steps toward it, never
reversing except on a phase change.

| Ghost | Target while chasing | Feel |
|---|---|---|
| **Hunter** | The player's current tile | Relentless, predictable, the pace-setter |
| **Oracle** | Four tiles ahead of the player's facing | Cuts you off; punishes straight lines |
| **Drift** | Reflect Hunter's tile through the point two ahead of the player | Erratic; only dangerous when Hunter is close |
| **Tumble** | The player's tile — but scatters home within 8 tiles | Loiters; creates false safety |

Ghosts alternate **scatter** and **chase** on a per-level timetable, each
retreating to its own corner while scattering. The alternation is what creates
rhythm; without it the game is a uniform grind.

### 2.3 Feel — derived from the `game-feel` skill

| ID | Requirement | Source |
|---|---|---|
| F1 | Input to state change ≤ 1 tick (16.7ms) | game-feel budget |
| F2 | Direction pressed before a junction buffers for 8 ticks | game-feel rule 1 |
| F3 | Corner cut allowed within 2 subpixels of centre | game-feel rule 2 |
| F4 | Fixed timestep; no delta-scaled movement | game-feel rule 3 |
| F5 | 30-tick freeze on death before reset | game-feel rule 5 |
| F6 | Player marginally faster in corridors, slower in tunnels | game-feel rule 6 |

### 2.4 Accessibility — derived from the `a11y-arcade` skill

| ID | Requirement |
|---|---|
| A1 | Ghosts separable in greyscale by silhouette, not hue alone |
| A2 | All keys remappable; arrows and WASD both active by default |
| A3 | `prefers-reduced-motion` disables shake, squash, particles, flash |
| A4 | `aria-live` region announces score milestones, lives, level, game over |
| A5 | Canvas carries `role="img"` and a live `aria-label` |
| A6 | `Escape` and `P` pause; focus moves to and is trapped in the dialog |
| A7 | HUD contrast ≥ 4.5:1; palette safe for deuteranopia and protanopia |
| A8 | No flashing above 3Hz |

### 2.5 Security — derived from the `secure-web-app` skill

| ID | Requirement |
|---|---|
| S1 | No `innerHTML` or any markup-from-data API anywhere |
| S2 | No `eval`, `new Function`, or string-bodied timers |
| S3 | CSP with no `'unsafe-inline'`; everything self-hosted |
| S4 | Player name validated at the boundary: ≤12 chars, `/^[\p{L}\p{N} _-]*$/u` |
| S5 | `localStorage` holds scores and bindings only |
| S6 | Actions SHA-pinned; workflows declare least-privilege `permissions:` |

## 3. Design

### 3.1 The determinism constraint

**The engine is a pure reducer with no access to the DOM, the clock, or
unseeded randomness.**

This is the single most consequential decision in the spec, and it is made for
process reasons as much as game reasons. It buys:

- Unit tests that cannot flake, because there is nothing non-deterministic to
  flake on.
- **Replay tapes** — record an input sequence, assert an exact final state
  hash. This gives the eval suite (§4.2) a real oracle instead of an LLM
  grading another LLM.
- Headless CI for all game logic; no browser needed below `src/render/`.

The cost is that positions must be integers in an 8-subpixel grid rather than
floats, which reads as awkward. That awkwardness is load-bearing and the
`simplifier` agent is instructed to leave it alone.

### 3.2 Layers

```
src/engine/     pure. no DOM, no Math.random, no Date.now
  rng.ts        seeded PRNG (mulberry32)
  maze.ts       grid, tiles, tunnels, pellet placement
  ghosts.ts     the four targeting policies + scatter/chase timetable
  collision.ts  tile-level overlap resolution
  scoring.ts    pellets, combo ladder, extra-life threshold
  state.ts      GameState type + step(state, input) => state

src/render/     reads state, never mutates. owns the canvas
src/input/      keyboard + touch, normalised to an Intent union
src/main.ts     accumulator, animation frame, wiring
```

Dependencies point strictly downward. `src/engine` imports nothing from the
other three.

### 3.3 Tick model

60 ticks per second, fixed. `main.ts` accumulates real elapsed time and runs
whole ticks, rendering interpolated between them. Below `main.ts`, all timing
is in ticks; milliseconds do not appear.

## 4. The loop — how each stage maps to GitHub

This section is the actual deliverable for the audience.

### 4.1 Stage mapping

| Play | GitHub implementation | Artifact |
|---|---|---|
| Capture as `intent.md` | Copilot app chat; `intent.yml` issue form | `intent/NNNN-*.md` |
| Requirements & design | `.github/skills/**` + `copilot -p` | `spec/NNNN-*.md` |
| Plan mode | Copilot CLI plan mode | `plan/NNNN-*.md` |
| `CLAUDE.md` | `.github/copilot-instructions.md` + `AGENTS.md` | committed |
| Skills | `.github/skills/**` | committed |
| Build guardrails | CLI deny rules + lefthook + rulesets | see §5.1 |
| Parallel sessions | Copilot app worktree sessions | branches |
| Subagents | `.github/agents/**` | committed |
| Feedback loop | `npm test` + Playwright screenshot diff | CI run |
| Continuous evals | `agent-evals.yml` | eval report |
| PR review loop | Copilot code review + `REVIEW.md` | PR thread |
| Approval gates | rulesets + `production` environment reviewer | deployment record |
| CI/CD | Actions + OIDC + build attestations | attestation |
| Closing the loop | `bands.yaml` + SDK watchtower + `gh aw` | new `intent/` |

### 4.2 Evals

12–15 tasks drawn from real work on this repo, each a prompt plus a
**deterministic** check — tests pass, lint clean, a replay tape still hashes to
the same value, a policy from a skill was followed. Run on any change to
`copilot-instructions.md`, `.github/skills/**` or `.github/agents/**`, and
nightly.

The point is that the config steering the agent gets regression-tested like the
code it writes. A skill edit that drops the pass rate is a broken change.

## 5. Answers to the open questions from intent

**Q1 — What's the honest mapping for Claude Code's `PreToolUse` hook?**

There isn't a direct one, and the spec declines to pretend otherwise. Copilot
CLI has granular tool permissions (`--deny-tool='shell(git push)'`) but no
pre-tool callback. The playbook describes *control objectives*, so the
objective — "a deterministic guardrail the agent cannot talk its way past" — is
met in three layers:

| Layer | Mechanism | Bypassable by |
|---|---|---|
| Session | CLI `--deny-tool` rules | the engineer, per session |
| Machine | lefthook pre-commit | `--no-verify` |
| **Repository** | **ruleset + gated environment** | **nobody** |

The third is stronger than a local hook, because it's enforced server-side by
GitHub rather than by a script on a laptop the agent is running on. **Say this
plainly on stage** — the honest comparison is more persuasive than a claimed
parity, and it happens to favour GitHub.

**Q2 — Is Copilot code review available?**

To be verified in Phase 0. If unavailable, fall back to `copilot -p` running
the `REVIEW.md` passes as a CI job that posts findings as a PR comment. The
play is "every PR gets identical review passes with ranked findings", and both
routes satisfy it; only the ergonomics differ.

**Q3 — Live versus pre-baked?**

Pre-bake everything; keep two or three short live moments. Specifically, the
secret-push block and the CodeQL/Autofix beat are fast, deterministic and
visually striking, so they run live. Anything requiring an agent to think for
30+ seconds is pre-baked with the result on a branch.

**Q4 — What does the Maintain stage monitor with no production traffic?**

CI test-failure rate and Pages deployment health, both from the Actions API.
This is not a substitute for real telemetry and shouldn't be presented as one —
but the playbook's own third example is PR cycle time, explicitly to show the
harness works for process metrics too. Monitoring CI health is squarely within
the pattern, and it has the advantage of being trippable on demand during a
demo.

## 6. Flagged concerns

Areas where policies pull against each other, or where risk is concentrated.
Per the playbook these go to a human before engineering starts.

> **C1 — `game-feel` versus `a11y-arcade` on motion.** Rule 5 of `game-feel`
> requires a 30-tick death freeze for readability; rule 3 of `a11y-arcade`
> requires reduced motion on request. These don't actually conflict — a freeze
> is the absence of motion — but the level-clear *flash* does. **Resolution:**
> under `prefers-reduced-motion`, replace the flash with a static colour hold
> of equal duration, preserving timing and pacing while removing the flash.
> Accessibility wins; feel is preserved by other means.

> **C2 — Determinism versus the frame budget.** Integer subpixel maths is
> slower than float. Measured risk is low at this grid size, but if `step()`
> exceeds the 2ms budget, determinism wins and the budget is renegotiated.
> Determinism is load-bearing for the eval suite; 2ms is a comfort target.

> **C3 — The demo's deliberate vulnerabilities.** The spec requires planting a
> DOM XSS and a fake credential to demonstrate CodeQL/Autofix and push
> protection. In a public repo this is a footgun — someone will find the XSS
> branch and file a report, or worse, copy it. **Resolution:** confine them to
> clearly-named `demo/*` branches, never merge to `main`, add a prominent
> header comment in the file, and document them in `demo/RUNBOOK.md`. Revisit
> if it still feels wrong at review.

> **C4 — Scope.** Six stages is a lot for one demo. Phases are ordered so
> stopping after the Deploy stage still yields a complete story. Maintain and
> the runbook are the flourish, not the foundation.

> **C5 — The eval suite costs model calls.** Gated to config changes plus a
> nightly run rather than every commit. Worth watching if the repo gets busy.

## 7. Acceptance criteria

- [ ] Game playable at a public URL, 60fps, no runtime dependencies
- [ ] Four ghosts demonstrably behave differently under observation
- [ ] `npm run typecheck && npm run lint && npm test` green from a clean clone
- [ ] Engine has zero DOM, `Math.random` or `Date.now` references
- [ ] A replay tape reproduces an identical state hash across runs
- [ ] All of A1–A8 verified, axe-core clean
- [ ] All of S1–S6 verified; CodeQL clean on `main`
- [ ] Deploy to Pages blocked pending a human reviewer on `production`
- [ ] Build attestation present and verifiable via `gh attestation verify`
- [ ] A tripped control band produces a new `intent/` entry unaided
- [ ] `demo/RUNBOOK.md` runnable end to end by someone who isn't the author

## 8. Out of scope

Multiplayer, any backend, native builds, and the playbook's regulated-enterprise
managed-settings example (worth a mention on stage, not worth building).
