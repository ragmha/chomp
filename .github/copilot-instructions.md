# CHOMP

A maze-chase arcade game in TypeScript and Canvas. Also a live demonstration of
an AI-native SDLC, so the process artifacts in `intent/`, `spec/` and `plan/`
are part of the product, not scaffolding.

## Commands

| Task | Command | Healthy output |
|---|---|---|
| Install | `npm ci` | no `ERR!` lines |
| Dev server | `npm run dev` | `Local: http://localhost:5173/` |
| Unit tests | `npm run test:unit` | `Test Files N passed` |
| E2E tests | `npm run test:e2e` | `N passed` |
| All tests | `npm test` | both of the above, exit 0 |
| Lint | `npm run lint` | no output |
| Types | `npm run typecheck` | `Found 0 errors` |
| Build | `npm run build` | `built in Nms`, writes `dist/` |

## Verifying your work

Run `npm run typecheck && npm run lint && npm test` before reporting any task
complete, and paste the output. If a test fails, fix the code, not the test.
Never skip, delete or weaken a failing test to get green.

## Architecture

- `src/engine/` — pure game logic. **No DOM, no `Math.random`, no `Date.now`.**
- `src/render/` — Canvas drawing. Reads state, never mutates it.
- `src/input/` — keyboard and touch, normalised to an `Intent` union.
- `src/main.ts` — wires the three together and owns the animation frame.
- `tools/watchtower/` — Copilot SDK monitoring service (Stage 6).

## Conventions

- The engine is a pure reducer: `step(state, input) => state`. Never mutate
  state in place; return a new object.
- All randomness goes through the seeded PRNG in `src/engine/rng.ts`. A test
  must be able to replay any session exactly.
- Fixed timestep. Positions are integers in a 8-subpixel grid, never floats —
  float drift breaks replay determinism.
- Timing is measured in **ticks** (60/s), never milliseconds, below `src/main.ts`.
- Prefer discriminated unions over booleans for mode (`GhostMode`, `Phase`).
- TypeScript strict. No `any`, no non-null `!` assertions.
- No runtime dependencies. Dev dependencies need a line in the PR description.

## Things to get right

- **Ghost names are Hunter, Oracle, Drift and Tumble.** Never use Bandai
  Namco's names (Blinky, Pinky, Inky, Clyde) or refer to this game as
  Pac-Man — this repo is public and deliberately non-derivative.
- Don't reach for `innerHTML`; the `secure-web-app` skill explains why.
- Don't add a UI framework. Canvas plus a handful of DOM nodes is the whole
  front end.
- Don't edit files under `src/gen/` or `*.lock.yml` — both are generated.
- When implementation departs from `plan/`, update the plan in the same commit.
- **Adding a dependency? Regenerate `package-lock.json` in the same commit.**
  A desynced lock breaks `npm ci`, which fails every workflow at once.
- **Playwright screenshots are per-platform.** A baseline written on macOS
  (`-darwin.png`) will not satisfy CI, which runs Linux and wants
  `-linux.png`. Generate the Linux one in the official container rather than
  deleting the assertion:

  ```bash
  PWV=$(node -p "require('./node_modules/@playwright/test/package.json').version")
  docker run --rm -v "$PWD":/work -v /work/node_modules -w /work --network host \
    mcr.microsoft.com/playwright:v${PWV}-jammy \
    bash -lc "npm ci && npx playwright test --update-snapshots"
  ```

  The bare `-v /work/node_modules` is load-bearing: it masks the host's
  `node_modules` with an anonymous volume. Without it the container's
  `npm ci` overwrites your macOS binaries with Linux ones and every local
  command breaks until you reinstall.

  Commit both baselines.
