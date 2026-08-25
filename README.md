# CHOMP

A maze-chase arcade game, built as a working demonstration of an
**AI-native software development lifecycle** running entirely on the GitHub
platform.

▶︎ **[Play it](https://ragmha.github.io/chomp/)**

---

## Why this repo exists

Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)
argues that when AI writes most of the code, the build stage stops being the
bottleneck — and the human-speed stages either side of it (plan, review,
deploy) become the constraint. Its answer is a loop where **every stage ends by
committing an artifact the next stage reads**, so the chain of commits doubles
as the audit trail.

This repo implements that loop with GitHub's tooling instead of Claude's:
Copilot CLI, the Copilot app, the Copilot SDK, GitHub Actions, and GitHub
Advanced Security.

The game is the hook. The machinery behind it is the point.

## The artifact chain

Read these in order — the commit timestamps are real, and the game was not
written until the third one existed.

| Stage | Artifact | What it is |
|---|---|---|
| 1. Plan | [`intent/`](intent/) | The idea, in the originator's own words |
| 2. Design | [`spec/`](spec/) | Requirements + design, constrained by skills |
| 3. Build | [`plan/`](plan/) | The implementation plan, approved before any code |
| 4. Test | [`evals/`](evals/) | Deterministic checks on the agent's own config |
| 5. Deploy | [`REVIEW.md`](REVIEW.md) | The review policy every PR is judged against |
| 6. Maintain | [`monitoring/`](monitoring/) | Control bands that reopen the loop |

## Stage → GitHub mapping

| Playbook play | GitHub implementation |
|---|---|
| Capture as `intent.md` | Copilot app chat + [`intent.yml`](.github/ISSUE_TEMPLATE/) issue form |
| Requirements & design | [`.github/skills/`](.github/skills/) + `copilot -p` |
| Plan mode | Copilot CLI plan mode |
| `CLAUDE.md` | [`.github/copilot-instructions.md`](.github/copilot-instructions.md) + [`AGENTS.md`](AGENTS.md) |
| Skills as institutional knowledge | [`.github/skills/`](.github/skills/) |
| Hooks as build guardrails | CLI deny rules + lefthook + rulesets |
| Parallel sessions & subagents | Copilot app worktrees + [`.github/agents/`](.github/agents/) |
| Feedback loop | `npm test` + Playwright screenshot diff |
| Continuous evals | [`agent-evals.yml`](.github/workflows/) |
| AI in the PR review loop | Copilot code review + [`REVIEW.md`](REVIEW.md) |
| Hooks as approval gates | Rulesets + gated `production` environment |
| CI/CD integration | Actions + OIDC + build attestations |
| Closing the loop | [`bands.yaml`](monitoring/) + Copilot SDK watchtower |

### Where GitHub goes further than the playbook

- **Copilot Autofix** doesn't just flag a CodeQL finding, it proposes the patch.
- **Push protection** blocks a secret at `git push`, before it exists in history.
- **Artifact attestations** give the shipped bundle cryptographic provenance.
- **Dependabot** and **OpenSSF Scorecard** cover supply chain, which the
  playbook doesn't address at all.

### Where it genuinely differs

Copilot CLI has no equivalent of Claude Code's `PreToolUse` hook. It has
granular tool permissions instead (`--deny-tool='shell(git push)'`). The
playbook describes *control objectives* rather than APIs, so the
"deterministic guardrail" objective is met with three layers here: CLI deny
rules per session, [lefthook](lefthook.yml) pre-commit locally, and repository
rulesets plus a gated environment at the org level — the last of which an
engineer cannot switch off.

## The game

TypeScript and HTML5 Canvas, built with Vite. No runtime dependencies.

The engine is a **pure deterministic reducer** — `step(state, input) => state`
with fixed-timestep integer physics and a seeded PRNG. No `Math.random`, no
wall-clock, no DOM below `src/render/`. That single constraint is what makes
the testing story real: unit tests never flake, replay tapes give the eval
suite an exact oracle, and CI needs no browser for the logic layer.

Four ghosts, each with genuinely different targeting:

| Ghost | Behaviour |
|---|---|
| **Hunter** | Chases your current tile directly |
| **Oracle** | Aims at where you're heading, not where you are |
| **Drift** | Flanks, using Hunter's position as a pivot |
| **Tumble** | Closes in, then loses nerve and scatters |

```bash
npm install
npm run dev      # play locally
npm test         # unit + e2e
npm run build    # static bundle
```

## Attribution

CHOMP is an original game in the maze-chase genre. Genre mechanics are not
protectable, but *Pac-Man*, its characters, ghost names and maze artwork are
trademarks and copyright of Bandai Namco Entertainment Inc. Nothing derived
from them appears in this repository — the maze, palette, sprites and the four
ghost names above are original to this project.

## Licence

[MIT](LICENSE)
