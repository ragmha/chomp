# CHOMP

CHOMP is a maze-chase browser game built with TypeScript and Canvas, and an
educational repository demonstrating selected AI-assisted software development
practices. Its GitHub-focused workflow brings together versioned planning
documents, guidance for Copilot CLI and app use, GitHub Actions, and optional
Copilot SDK experiments. Development can happen locally as well as on GitHub.

**[Play CHOMP](https://ragmha.github.io/chomp/)**

## Run locally

Requires **Node.js 22+** and npm, as declared in [`package.json`](package.json).

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. Other commands, run from the repository root:

```bash
npm run test:unit                 # Vitest unit tests
npx playwright install chromium  # Browser needed for E2E tests
npm run test:e2e                  # Playwright browser tests
npm run typecheck
npm run lint
npm run build                     # Static output in dist/
npm run preview                   # Preview dist/ after building
```

`npm test` runs both the unit and E2E suites. On Linux, use
`npx playwright install --with-deps chromium` if browser system libraries are
also needed. The [Playwright configuration](playwright.config.ts) starts a
build and preview server for E2E tests unless it reuses an existing local server.

## Game and architecture

Collect pellets while avoiding **Hunter, Oracle, Drift and Tumble**. Select the
start button, then use arrow keys or WASD to move, or swipe on the board.
The default pause keys are **P** and **Escape**.

Game rules live in `src/engine/`, keyboard and touch input in `src/input/`, and
Canvas drawing and HUD updates in `src/render/`. [`src/main.ts`](src/main.ts)
wires them together with a fixed 60-tick-per-second simulation loop.

The engine uses integer subpixel positions and a
[seeded PRNG](src/engine/rng.ts). Its [replay checks](src/engine/replay.test.ts)
compare state hashes across repeated runs of seeds and input sequences.
The browser/game package declares no runtime dependencies; the optional SDK
service below has its own package and dependencies.

## Development workflow

These documents and workflow definitions provide examples to explore, rather
than proof of historical human approvals or successful execution:

| Area | Repository files | Purpose |
|---|---|---|
| Planning | [Intent](intent/0001-chomp.md), [spec](spec/0001-chomp.md), [plan](plan/0001-chomp.md) | Versioned goals, requirements and implementation notes |
| Contributor guidance | [Copilot instructions](.github/copilot-instructions.md), [AGENTS.md](AGENTS.md), [game-feel skill](.github/skills/game-feel/SKILL.md), [REVIEW.md](REVIEW.md) | Agent guidance, an example skill and a documented review policy |
| Checks | [CI](.github/workflows/ci.yml), [CodeQL](.github/workflows/codeql.yml) | Type, lint, test and build steps; static-analysis configuration |
| Agent experiments | [Eval runner](evals/run.sh), [eval workflow](.github/workflows/agent-evals.yml), [intent-to-spec workflow](.github/workflows/intent-to-spec.yml) | Prompt-based evaluations and draft-spec generation |
| Deployment | [Pages workflow](.github/workflows/deploy.yml) | Build, artifact-attestation and Pages deployment steps |
| Monitoring | [Band definitions](monitoring/bands.yaml), [detector](monitoring/detect.ts), [watchtower service](tools/watchtower/watchtower.ts), [workflow](.github/workflows/watchtower.yml) | CI/deploy run-history detection and optional SDK diagnosis |

Instructions, skills and review policies are guidance, not guaranteed
compliance. Required checks, rulesets and `production` environment approvals
must be configured in GitHub; their enforcement depends on permissions and
bypass settings.

### Optional automation

The agent evals, intent-to-spec workflow and SDK watchtower are experimental
examples, not a verified autonomous development loop. Model-backed runs require
a working Copilot setup and credentials with Copilot access; the workflows'
Actions `GITHUB_TOKEN` alone does not establish that access. Evals may be
skipped when the CLI is unavailable or unauthenticated.

Watchtower's scheduled runs are detection-only (dry run), and manual runs
default to the same mode. With dry run disabled and authentication configured,
the SDK path can write draft intent files for human triage; the workflow
includes a step to propose those findings as a PR. It does not implement an
automatic fix-and-deploy cycle.

The separate [watchtower package](tools/watchtower/package.json) depends on
`@github/copilot-sdk` and is not needed to play or build the game. To try
detection, which reads GitHub Actions history without invoking a model:

```bash
npm --prefix tools/watchtower ci
npm --prefix tools/watchtower run dry-run -- --repo ragmha/chomp
```

For presentation material, see the [presenter runbook](demo/RUNBOOK.md).

## Inspiration

Credit to Anthropic's
[AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)
for inspiring this repository's exploration of intent, design, implementation,
review and maintenance practices.

## Licence

[MIT](LICENSE)
