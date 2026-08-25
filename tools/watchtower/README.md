# Watchtower

The Maintain stage. A scheduled, stateless run that watches the repo's own
health and, when something drifts, writes what it finds back into `intent/` —
which is where this whole process started. That is what makes it a loop rather
than a pipeline.

## The shape of it

```
Actions API  →  monitoring/detect.ts  →  [band breached?]  →  Copilot SDK  →  intent/*.md
                (deterministic,                 │                                    │
                 unit tested,              no ──┘                                    ▼
                 no model)                                                    human triage
```

**Detection contains no model.** It is arithmetic over a rolling baseline,
version controlled and covered by 20 unit tests. This is deliberate: an agent
that decided for itself when to wake up would have no meaningful boundary. The
model is invoked *after* a band breaches, and the tier decides what it may do.

## Tiers

Set in [`monitoring/bands.yaml`](../../monitoring/bands.yaml) and enforced here
by scoping the SDK session's `availableTools`:

| Tier | Action | What the agent may touch |
|---|---|---|
| 1σ | `log` | Nothing. No session is created at all. |
| 2σ | `diagnose` | Read and search only. It looks; it cannot act. |
| 3σ | `propose` | Read, search, and write files — then stop. |

Nothing at any tier can deploy. A 3σ finding becomes a pull request, which
lands in front of the review gate and the required reviewer on the `production`
environment, exactly like a change written by a person.

Invoking a model on every wobble is how a monitoring loop turns into noise
people learn to mute, which is why 1σ deliberately wakes nobody.

## Why the SDK rather than `copilot -p`

Both would work, and the eval suite uses the CLI. The SDK earns its place here
for three things this service actually needs:

1. **Tool scoping as an allowlist.** `availableTools` is a first-class option,
   so the tier boundary is expressed in code rather than in a prompt asking the
   agent nicely not to do something.
2. **OpenTelemetry.** The playbook asks that agent decisions reach an
   observability stack with timestamps. The SDK exports OTel directly — every
   tool call in a run lands in `.watchtower/traces.jsonl`, so an auditor can
   reconstruct what happened without trusting the summary.
3. **It's a service, not a script.** Structured events (`assistant.message`,
   `session.idle`) rather than parsing stdout.

## Running it

```bash
npm install

# Detect only; never invokes a model. Safe anywhere.
npm run dry-run

# The real thing.
GITHUB_TOKEN=$(gh auth token) npm run watch
```

Requires Node 22+. On Node 22 the `--experimental-strip-types` flag in the
scripts is doing the work; on 24 it is a no-op.

Deliberately zero build step — the service reads the same
`monitoring/detect.ts` the unit tests do, so there is no possibility of the
tested detector and the running detector drifting apart.

## Tripping it on purpose

For a demo, the honest way is to make CI actually fail a few times on `main`
and let the band breach on its own. The faster way is to feed the detector a
synthetic series:

```bash
node --experimental-strip-types -e "
import('../../monitoring/detect.ts').then(m => {
  const runs = [...Array(9).fill('success'), 'failure']
    .map((c, i) => ({ id: i, conclusion: c, createdAt: new Date().toISOString() }));
  console.log(m.detect(runs, { metric: 'ci_failure_rate', minSamples: 8 }));
});"
```

## Files

| File | Purpose |
|---|---|
| `watchtower.ts` | Orchestration: fetch, detect, scope, invoke, write |
| `metrics.ts` | Actions API reads. Deliberately boring. |
| `../../monitoring/detect.ts` | The bands. Pure, tested, no model. |
| `../../monitoring/bands.yaml` | Tier configuration, asserted against the code |
