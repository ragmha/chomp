# Evals

Regression tests for the *configuration that steers the agent* — instructions,
skills, and subagents — the same way code gets regression-tested.

## Why this exists

An LLM grading another LLM is not a reliable oracle. A passing test suite is.
Each case here defines a concrete task and a set of **deterministic, machine-
verifiable checks** — shell commands, file-presence assertions, and pattern
matches. There is no model judging the output; either the check passes or it
doesn't.

The insight from the playbook: if you edit `.github/copilot-instructions.md`
or a skill and the pass rate drops, that is a broken change — the same bar
that a failing unit test sets for source code.

## Structure

```
evals/
  README.md          this file
  threshold.json     minimum pass rate to gate CI
  run.sh             orchestrator — iterates cases, manages worktrees
  check.sh           evaluates a single case's checks against a working dir
  cases/*.json       one file per eval case
```

## Case format

```json
{
  "id": "slug-for-the-case",
  "prompt": "Exact prompt given to the agent",
  "rationale": "Which skill or policy this regression-tests, and why",
  "checks": [
    { "type": "command", "run": "npm run lint", "description": "Lint passes" },
    { "type": "file_absent_pattern", "glob": "src/engine/**", "pattern": "Math\\.random", "description": "No Math.random in engine" },
    { "type": "file_present_pattern", "glob": "src/**", "pattern": "textContent", "description": "textContent used instead of innerHTML" },
    { "type": "file_exists", "path": "src/engine/rng.ts", "description": "PRNG module present" }
  ]
}
```

### Check types

| Type | Fields | Passes when |
|---|---|---|
| `command` | `run` | Shell command exits 0 |
| `file_absent_pattern` | `glob`, `pattern` | No file matching glob contains the regex |
| `file_present_pattern` | `glob`, `pattern` | At least one file matching glob contains the regex |
| `file_exists` | `path` | The path exists (file or dir) |

## How to add a case

1. Create `evals/cases/<slug>.json` with an `id`, `prompt`, `rationale`, and
   at least one `checks` entry.
2. Design checks that are **deterministic and mechanical** — grep a pattern,
   run a command, assert a file exists. Do not add checks that require judgment.
3. Ground the case in real policy: cite a skill rule, a `plan/` risk, or a
   `spec/` requirement in the `rationale`.
4. Run `evals/check.sh evals/cases/<slug>.json .` locally to confirm the
   checks work in the current repo before committing.

## Why determinism matters

The engine under `src/engine/` is a pure reducer — no DOM, no `Math.random`,
no `Date.now`. This constraint is load-bearing: it gives the eval suite a real
oracle. A replay tape recorded once will produce an identical state hash on
every run. If it doesn't, the engine has a non-determinism leak, and the eval
catches it mechanically rather than relying on a model to notice.

## Running locally

```bash
# Check a single case against the current working dir
./evals/check.sh evals/cases/engine-purity.json .

# Run the full suite (requires copilot CLI)
./evals/run.sh
```

The `run.sh` script detects when the `copilot` CLI is unavailable or
unauthenticated and exits with a distinct code (`2`) so CI can skip gracefully
rather than report false failures.
