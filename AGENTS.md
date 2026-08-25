# AGENTS.md

Shared agent memory for CHOMP. Tool-agnostic; read by Copilot CLI, the Copilot
app, the Copilot coding agent and the SDK watchtower service.

The detailed working notes live in
[`.github/copilot-instructions.md`](.github/copilot-instructions.md) — read that
first. This file records the rules that govern *how work moves*, which the
instructions file doesn't cover.

## The loop

This repo runs the [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook).
Each stage ends by committing an artifact the next stage reads:

```
intent/  →  spec/  →  plan/  →  code + tests  →  PR + review  →  monitoring/
   ↑                                                                   │
   └───────────────────  new intent.md on breach  ─────────────────────┘
```

**Never write code without an approved `plan/` entry.** If you're asked to
implement something that has no plan, say so and offer to write one first.

**Never backfill an artifact.** The commit timestamps are the audit trail and
this repo is demonstrated live by scrolling through them. Writing a `spec/`
entry after the code exists would be dishonest, not merely untidy.

## Numbering

Artifacts share a four-digit change number: `intent/0001-chomp.md` becomes
`spec/0001-chomp.md` becomes `plan/0001-chomp.md`. Keep the slug identical
across the three so the chain is greppable.

## Skills

Policy lives in [`.github/skills/`](.github/skills/), not in prompts:

- **`game-feel`** — input latency and frame budget. Applies to anything in the
  input path or main loop.
- **`secure-web-app`** — CSP and DOM safety. Applies to any DOM write.
- **`a11y-arcade`** — keyboard, colour and motion accessibility. Applies to any
  visible or interactive change.

If a skill contradicts a request, flag the conflict rather than silently
picking one. The playbook calls these advisory controls; the deterministic
backstops are lefthook, CI checks and the branch ruleset.

## Boundaries

- The agent may act up to the production gate and not past it. Deploys to the
  `production` environment require a named human reviewer.
- Everything an agent writes arrives as a pull request. There is no direct
  push to `main`.
- Don't weaken a check to make it pass. Fixing the check *is* the task, or the
  task is blocked and should be reported as blocked.
