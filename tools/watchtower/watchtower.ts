/**
 * Watchtower — the Maintain stage, closing the loop.
 *
 * A scheduled, stateless run that:
 *   1. reads CI and deploy health from the Actions API,
 *   2. applies the deterministic control bands in ../../monitoring/bands.yaml,
 *   3. and only if a band is breached, invokes Copilot through the SDK with
 *      the powers that tier grants — read-only at 2 sigma, able to propose a
 *      change at 3 sigma.
 *
 * The finding is written as an `intent/` entry, which is the whole point: a
 * maintenance discovery re-enters the same pipeline as any other idea rather
 * than getting a private side channel. The loop closes on itself.
 *
 * There is no person in the invocation path. There is a person in the triage
 * path, and there is a person at the deploy gate. That is the boundary.
 *
 * Run: `node watchtower.ts --repo ragmha/chomp [--dry-run]`
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuiltInTools, CopilotClient, ToolSet, approveAll } from '@github/copilot-sdk';
import { actionFor, detect, toIntentMarkdown, type Breach } from '../../monitoring/detect.ts';
import { fetchRuns } from './metrics.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const TRACE_DIR = join(REPO_ROOT, '.watchtower');

type Watch = {
  readonly metric: string;
  readonly workflow: string;
  readonly limit: number;
  readonly minSamples: number;
};

const WATCHES: readonly Watch[] = [
  { metric: 'ci_failure_rate', workflow: 'ci.yml', limit: 30, minSamples: 8 },
  { metric: 'deploy_success_rate', workflow: 'deploy.yml', limit: 20, minSamples: 5 },
];

/**
 * What each tier may touch.
 *
 * This is the SDK equivalent of the playbook's permission tiers, and it is the
 * reason the agent's reach is an allowlist rather than a shell script holding
 * credentials. At 2 sigma it can look but not act. At 3 sigma it may write a
 * file and open a pull request — which still lands in front of the review gate
 * and the required reviewer on `production`. Nothing here can deploy.
 */
function toolsFor(tier: Breach['tier']): ToolSet {
  const readOnly = new ToolSet().addBuiltIn(BuiltInTools.Isolated).addBuiltIn('view').addBuiltIn('grep');

  if (tier === '3sigma') {
    return readOnly.addBuiltIn('create').addBuiltIn('edit');
  }
  return readOnly;
}

function diagnosePrompt(breach: Breach, repo: string): string {
  const action = actionFor(breach.tier);
  return `A control band just breached in ${repo}.

Metric: ${breach.metric}
Rule:   ${breach.rule}
Tier:   ${breach.tier} (you are authorised to: ${action})

Evidence:
${breach.evidence.map((e) => `- ${e}`).join('\n')}

Baseline: mean ${breach.baseline.mean.toFixed(3)}, standard deviation ${breach.baseline.stddev.toFixed(3)} over ${breach.baseline.samples} samples.

Investigate and report:
1. The most likely cause, and whether this looks like a real regression or noise.
2. Which files or workflows are implicated.
3. Whether this warrants a fix now, a scheduled fix, or a dismissal that should
   instead retune the band.
4. Whether it should become a permanent case in evals/ so it cannot recur silently.

Be concrete and cite what you actually read. If the evidence does not support a
conclusion, say so — a confident wrong diagnosis costs more than an honest
"insufficient evidence", because someone will act on it.

${
  action === 'propose'
    ? 'You may write files. Do not commit, do not push, and do not deploy.'
    : 'This is a read-only investigation. Do not modify any file.'
}`;
}

async function diagnose(breach: Breach, repo: string): Promise<string> {
  mkdirSync(TRACE_DIR, { recursive: true });

  // Telemetry is on. The playbook asks for hook and session decisions to reach
  // an observability stack with timestamps; the SDK exports OTel directly, so
  // every tool call in this run is auditable after the fact.
  const client = new CopilotClient({
    workingDirectory: REPO_ROOT,
    telemetry: {
      exporterType: 'file',
      filePath: join(TRACE_DIR, 'traces.jsonl'),
      sourceName: 'chomp-watchtower',
      captureContent: true,
    },
  });

  await client.start();
  try {
    const session = await client.createSession({
      availableTools: toolsFor(breach.tier),
      onPermissionRequest: approveAll,
    });

    const chunks: string[] = [];
    const finished = new Promise<void>((resolve) => {
      session.on('assistant.message', (event) => chunks.push(event.data.content));
      session.on('session.idle', () => resolve());
    });

    await session.send({ prompt: diagnosePrompt(breach, repo) });
    await finished;
    await session.disconnect();

    return chunks.join('\n').trim();
  } finally {
    await client.stop();
  }
}

function nextIntentPath(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return join(REPO_ROOT, 'intent', `auto-${stamp}-${Date.now().toString(36)}.md`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const repo = valueOf(args, '--repo') ?? process.env.GITHUB_REPOSITORY ?? 'ragmha/chomp';
  const dryRun = args.includes('--dry-run');
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  let breached = false;

  for (const watch of WATCHES) {
    const runs = await fetchRuns({
      repo,
      workflow: watch.workflow,
      branch: 'main',
      limit: watch.limit,
      token,
    });

    const breach = detect(runs, { metric: watch.metric, minSamples: watch.minSamples });

    if (breach === null) {
      console.log(`✓ ${watch.metric}: within band (${runs.length} runs)`);
      continue;
    }

    breached = true;
    const action = actionFor(breach.tier);
    console.log(`⚠ ${watch.metric}: ${breach.tier} — ${breach.rule} → ${action}`);

    // 1 sigma logs and wakes nobody. Invoking a model on every wobble is how a
    // monitoring loop becomes noise that people learn to ignore.
    if (action === 'log') continue;

    if (dryRun) {
      console.log('  (dry run: skipping agent invocation)');
      continue;
    }

    const findings = await diagnose(breach, repo);
    const path = nextIntentPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${toIntentMarkdown(breach)}\n## Agent findings\n\n${findings}\n`, 'utf8');
    console.log(`  wrote ${path}`);
  }

  // Exit 0 either way: a breach is a finding for triage, not a failure of the
  // watchtower. Failing the job here would only teach people to mute it.
  return breached ? 0 : 0;
}

function valueOf(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('watchtower failed:', error);
    process.exit(1);
  },
);
