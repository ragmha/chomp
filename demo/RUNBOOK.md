# CHOMP — presenter runbook

A ~30 minute live demo of an AI-native SDLC on GitHub, using a maze-chase game
as the payload.

**The argument:** when AI writes most of the code, build stops being the
bottleneck and the human-speed stages either side of it become the constraint.
The answer is a loop where every stage commits an artifact the next stage
reads, so the commit chain doubles as the audit trail.

**The tactic:** play the game first. It earns you the attention to talk about
process for twenty minutes. Nobody grants that upfront.

---

## Pre-flight

Run this the morning of, not five minutes before.

```bash
./demo/reset.sh --check
```

Manual checks it can't make for you:

- [ ] `https://ragmha.github.io/chomp/` loads and plays
- [ ] You are signed in to GitHub in the browser you'll present from
- [ ] `gh auth status` is green in the terminal you'll present from
- [ ] Terminal font ≥ 18pt; editor font ≥ 16pt
- [ ] Browser zoom at 125% — code on a projector is unreadable otherwise
- [ ] Notifications off, Slack quit, second monitor mirrored not extended
- [ ] The `production` environment still has a required reviewer
      (`gh api repos/ragmha/chomp/environments/production --jq '[.protection_rules[].type]'`)
- [ ] A phone hotspot, in case conference wifi dies during beat 5

**Everything below is pre-baked.** The only genuinely live moments are the
secret push (beat 5a) and Autofix (beat 5b), both of which are fast and
deterministic. Nothing depends on an agent thinking on stage.

---

## Beat 1 — Play it (2 min)

Open `https://ragmha.github.io/chomp/`. Play. Don't narrate.

Lose a life on purpose. Eat a power pellet and chase the ghosts down.

> "That's CHOMP. It's about four hundred lines of game logic, no runtime
> dependencies, and it deploys to Pages on every merge.
>
> I'm not here to talk about the game. I'm here to talk about how it got
> built — because none of the interesting parts are in the code."

**If Pages is down:** `npm run dev` locally. Same demo.

---

## Beat 2 — The artifact chain (5 min)

This is the spine. Take your time here.

```bash
git log --oneline --reverse | head -8
```

> "Read that bottom to top. Intent, then spec, then plan, then code. Those are
> real timestamps — the game did not exist until the third one did."

Open the three files side by side:

| File | Point to make |
|---|---|
| `intent/0001-chomp.md` | Written by a person, in their own words. Four open questions, unresolved. No technical solution in it. |
| `spec/0001-chomp.md` | Written by an agent reading that intent *plus the skills*. Note it **answers all four open questions** and flags five concerns. |
| `plan/0001-chomp.md` | Names the files, the order, the risks, and — the bit people miss — **four options considered and rejected, with reasons.** |

Land the key idea:

> "Every stage ends by committing something the next stage reads. That's not
> documentation discipline. It's that the handoff stops being a person
> remembering to do something, and starts being a file arriving in a repo."

Then show the handoff is real:

```bash
cat .github/workflows/intent-to-spec.yml | head -30
```

> "A new intent file landing on main triggers the design pass automatically.
> The product owner's first involvement is the review. They never start the
> stage."

Show `spec/0001-chomp.md` §6 — the flagged concerns:

> "C1 is a genuine conflict. The game-feel skill wants a flash on level clear.
> The accessibility skill forbids flashing. The agent didn't pick one and move
> on — it flagged it, and a human decided. Accessibility won."

---

## Beat 3 — Skills as institutional knowledge (4 min)

```bash
ls .github/skills/
cat .github/skills/a11y-arcade/SKILL.md
```

> "Three skills. Policy as versioned files, not as a wiki page nobody reads."

Now the payoff — go back to the game and show what nobody asked for:

1. **Tab to the canvas.** It has `role="img"` and a live label.
2. **Play with WASD**, then with arrows. Both work, simultaneously.
3. **System Settings → Accessibility → Reduce Motion**, reload, play.
   The flash is gone; the game still plays.
4. `view-source:` — point at the CSP with no `unsafe-inline`.

> "I never asked for any of that. It's in the game because it's in a skill, and
> the skill was loaded when the code was written.
>
> Compare that to a checklist in a wiki. Same information. One of them gets
> applied while the code is being written; the other gets applied never."

Then the honest caveat — this lands well, don't skip it:

> "A skill is an *advisory* control. Nothing forces a session to obey it.
> That's why there's a deterministic layer behind it."

```bash
cat lefthook.yml | head -25
npx eslint --print-config src/engine/state.ts | grep -A3 no-restricted-syntax | head
```

> "The skill makes violations rare. The lint rule and the pre-commit hook make
> them close to impossible."

---

## Beat 4 — Parallel sessions (3 min)

Show the Copilot app with worktree sessions side by side.

> "Three sessions, three worktrees, three branches, one engineer. The
> constraint isn't how many agents you can run — it's how many you can review
> properly. Two or three is honest. Ten is a fantasy."

Also show `.github/agents/verifier.md`:

> "This subagent runs the build and the tests and reports. It's explicitly
> forbidden from fixing anything. That's the whole point — the agent that wrote
> the code carries the assumptions that produced it. A verdict from a fresh
> context window is worth something. A verdict from the author isn't."

---

## Beat 5 — Security (6 min) ⚡ LIVE

The strongest beat. Two live moments, both fast.

### 5a — Layered guardrails, then push protection (2 min)

This is a three-act beat, and each act fails one layer further out. It maps
exactly onto the table in `spec/0001-chomp.md` §5 — worth having open.

**Act 1 — the local hook stops you.**

```bash
git checkout -b demo/secret
cat > src/config.ts <<'EOF'
const GITHUB_TOKEN = "ghp_S0meFakeT0kenF0rTheDem0AAAAAAAAAAAA";
EOF
git add -A && git commit -m "chore: add config"
```

lefthook rejects it — eslint flags the unused variable before the commit is
even made.

> "That's the machine layer. Useful, and completely bypassable."

**Act 2 — bypass it.**

```bash
git commit --no-verify -m "chore: add config"
```

Commit succeeds.

> "Every local hook has a `--no-verify`. Claude Code's `PreToolUse` hook has
> the same property — it runs on the machine the agent runs on. If your control
> lives there, a determined person or a confused agent gets past it."

**Act 3 — push protection stops you anyway.**

```bash
git push origin demo/secret
```

**Rejected.** Read the error aloud.

> "That one isn't running on my laptop. GitHub rejected the push server-side,
> and the secret never entered the repository's history. Not caught in review —
> never committed to the remote at all.
>
> Three layers, and only the third is one I can't switch off. That's the whole
> argument about where to put a control."

```bash
git reset --hard HEAD~1 && git checkout main && git branch -D demo/secret
```

**If push protection doesn't fire:** don't retry live. Acts 1 and 2 still make
the point on their own; show the Security settings page and move on.

### 5b — CodeQL and Autofix (4 min)

The branch is pre-baked. Open the existing PR from `demo/vuln-xss`.

> "Someone rendered the high-score name with `innerHTML`. Classic DOM XSS."

Show, in order:

1. **CodeQL alert** — `js/xss-through-dom`, found by `security-extended`
2. **Copilot Autofix** — it proposes the patch, with an explanation
3. **Copilot code review** — flagged it independently, citing `REVIEW.md`
4. `cat .github/skills/secure-web-app/SKILL.md` — rule 1 names this exact case

> "Four layers caught one bug. The skill tried to prevent it. Lint would have
> caught it locally. CodeQL caught it in CI. And Autofix wrote the patch.
>
> That last part has no equivalent in the playbook. It doesn't just tell you
> you're wrong — it hands you the fix."

Also worth 20 seconds:

```bash
gh attestation verify --repo ragmha/chomp --owner ragmha dist/index.html || true
```

> "Cryptographic provenance for the bytes on Pages. Dependabot and Scorecard
> cover the supply chain. The playbook doesn't address supply chain at all."

---

## Beat 6 — The gate (4 min)

Open the Actions tab, most recent `Deploy to Pages` run.

Show the `build` job green, and `deploy` **waiting**.

> "The agent wrote the code. CI verified it. The artifact is attested. And it
> stops here, because the `production` environment requires a named reviewer."

```bash
gh api repos/ragmha/chomp/environments/production --jq '[.protection_rules[].type]'
```

Click **Approve**. Watch it deploy. Reload the game.

> "This is the play the playbook calls hooks-as-approval-gates. Copilot CLI
> doesn't have Claude Code's `PreToolUse` hook, so I'll be straight with you
> about the mapping."

Show `spec/0001-chomp.md` §5, Q1 — the three-layer table.

> "Session-level deny rules, which the engineer can change. A pre-commit hook,
> which `--no-verify` defeats. And a repository ruleset plus a gated
> environment, which nobody can switch off because GitHub enforces it
> server-side, not a script on the laptop the agent is running on.
>
> That third layer is stronger than a local hook. The honest comparison
> happens to favour GitHub — but say the honest thing either way, because
> someone in the room will check."

---

## Beat 7 — Closing the loop (4 min)

```bash
cat monitoring/bands.yaml | head -35
```

> "Control bands. One sigma logs. Two sigma lets an agent investigate,
> read-only. Three sigma lets it propose a change. Detection is arithmetic —
> there is no model anywhere in the trigger path, and it has twenty unit
> tests."

```bash
npm run test:unit -- monitoring
```

Then the SDK service:

```bash
cd tools/watchtower && npm run dry-run
```

> "That's the Copilot SDK. The tier boundary is `availableTools` on the
> session — an allowlist in code, not a prompt asking the agent nicely. And
> OpenTelemetry is on, so every tool call lands in a trace file. That's the
> audit record."

Show a pre-baked `watchtower/*` PR containing a generated `intent/auto-*.md`.

> "A breach becomes an intent file. Which is where we started, twenty minutes
> ago."

Scroll back to beat 2.

> "That's the loop. Not a pipeline — a loop. And a person is still in it: at
> triage, at review, and at that deploy gate. What changed is that they no
> longer have to *start* anything."

---

## Close (1 min)

> "Three things to take away.
>
> **One.** Commit the artifact at every stage. The chain of commits becomes
> your audit trail for free, and you can scroll it in front of an auditor.
>
> **Two.** Put policy in skills, and put a deterministic check behind every
> skill that actually matters. Advisory plus enforced. Neither alone.
>
> **Three.** Decide where the human gate is, and make it server-side. Not a
> convention. Not a hook on a laptop. A gate the agent cannot reach past.
>
> If you turn on one thing on Monday: push protection. It's a checkbox and it
> stops a whole class of incident."

---

## Q&A cheat sheet

| Question | Answer |
|---|---|
| "Does Copilot have hooks?" | No `PreToolUse` equivalent. Granular tool permissions (`--deny-tool='shell(git push)'`), plus lefthook and rulesets. Rulesets are the strongest layer. |
| "How do you stop the agent breaking tests to go green?" | `REVIEW.md` flags test edits; lefthook blocks determinism leaks; the verifier subagent can't edit at all. |
| "What does this cost?" | Evals run on config changes and nightly, not per commit. Watchtower runs every six hours and only invokes a model past 2σ. |
| "Is the game a Pac-Man clone?" | Genre mechanics aren't protectable; the name, characters, ghost names and maze are Bandai Namco's. Original maze, palette and ghost names here. |
| "What if the eval suite is wrong?" | It's version controlled and reviewed like code. A skill change that drops the pass rate gets reviewed before merge. |
| "Why not CodeQL default setup?" | One click, but a UI setting can't be read aloud on stage. Config-as-code is the argument. |
| "Do you trust the agent to write the spec?" | No — a human reviews it. The change is that they review instead of starting from a blank page. |
| "What broke while building this?" | The maze validator caught two real defects on first run. Three engine tests failed and all three were wrong *tests*, not wrong code. Worth telling — it's what a real feedback loop looks like. |

---

## If something dies

| Failure | Fallback |
|---|---|
| Pages down | `npm run dev` |
| Wifi down | Everything except beats 5a and 6 works offline. Screenshots in `demo/fallback/`. |
| Push protection doesn't fire | Show the Security tab settings and the docs. Don't retry live. |
| Autofix hasn't generated | The alert itself is the point. Show the CodeQL finding and `REVIEW.md`. |
| Approval gate already approved | `gh workflow run deploy.yml` to queue a fresh one. |
| Running long | Cut beat 4 (parallel sessions). It's the most expendable. |
| Running very long | Cut beats 4 and 7; close after the gate. The argument survives. |

## Reset between runs

```bash
./demo/reset.sh
```

Restores `main`, deletes local demo branches, reopens the pre-baked PRs, and
re-arms the deploy gate.
