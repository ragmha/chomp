# Intent 0001: CHOMP

**Author:** @ragmha
**Date:** 2026-08-25
**Status:** accepted

## Problem

I want to show engineering teams what an AI-native SDLC actually looks like
when it's running, not described. The
[playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) is a good
document, but it's written against Claude's tooling, and every team I talk to
asks the same two questions: *what does this look like on GitHub?* and *is any
of it real, or is it a slide?*

Talks about process don't land. People nod, and nothing changes on Monday. The
reason is that process is invisible — you can't see a control objective. So the
demo needs something people can look at and immediately judge, with the process
visible underneath it.

Building a game solves that. Everyone can tell within ten seconds whether a
game is good. That earns the attention needed for the actual argument, which is
about how it got built.

## Proposed outcome

A maze-chase arcade game, playable in a browser at a public URL, where every
stage of the playbook's loop has a real GitHub implementation behind it and the
git history is a genuine audit trail.

Someone watching should come away able to answer:

- Which GitHub feature corresponds to each play in the playbook?
- Which parts does GitHub do better, and where does it genuinely differ?
- What would I turn on first in my own repo on Monday?

The last one matters most. A demo that impresses but doesn't tell you where to
start has failed.

## Affected users and systems

- **Audience:** engineering leads and platform teams evaluating agentic
  workflows. Assume they know GitHub well and the playbook barely.
- **Systems:** GitHub Actions, Advanced Security (CodeQL, secret scanning,
  Dependabot), Pages, rulesets and environments, Copilot CLI, the Copilot app,
  the Copilot SDK, and `gh` extensions (`agent-task`, `aw`).
- **Me**, presenting it live, which means every beat needs a fallback that
  doesn't depend on an agent responding quickly on conference wifi.

## Constraints

- **The artifact chain must be honest.** Each stage's artifact gets committed
  before the next stage starts. No backfilling. If I'm going to scroll through
  the history on stage and claim it's an audit trail, it has to be one.
- **Public repo**, both because the security features I want to show are free
  there and because people should be able to read it afterwards.
- **Nothing derivative.** Pac-Man's name, characters, ghost names and maze are
  Bandai Namco's. Genre mechanics aren't. The game must be original work —
  original maze, palette, sprites and ghost names.
- **The game has to be genuinely good.** A janky demo game undermines the whole
  argument, because the implicit claim is that this process produces quality.
- **No runtime dependencies**, so the supply chain story is about the
  toolchain rather than the bundle.
- **Live-demo safe.** Pre-baked branches, a reset script, and no beat that
  can't survive a failed network call.

## Constraints I'm explicitly *not* imposing

- Framework choice, engine architecture, and how the ghosts behave are the
  spec's business, not mine.
- I don't need every play in the playbook implemented. I need the loop to
  close, and the gaps to be named honestly rather than papered over.

## Open questions

1. Copilot CLI has no direct equivalent of Claude Code's `PreToolUse` hook.
   What's the honest mapping — is it tool permissions, git hooks, rulesets, or
   all three at different layers?
2. Is Copilot code review available on my plan? If not, what's the fallback
   that still demonstrates the review play?
3. How much should run live versus pre-baked? Live is more convincing and more
   likely to fail on stage.
4. The playbook's Maintain stage assumes a metrics store. With no production
   traffic to monitor, what's the most honest substitute — CI failure rate and
   deploy health from the Actions API?

## Out of scope

- Multiplayer, leaderboards with a backend, or anything needing a server.
- Mobile-native builds.
- Reproducing the playbook's regulated-enterprise managed-settings example.
  Worth a mention on stage, not worth building.
