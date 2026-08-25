/**
 * Control-band detection for the Maintain stage.
 *
 * There is deliberately no model in this file. Detection is arithmetic, it is
 * unit tested, and it is version controlled — an agent that decided for itself
 * when to wake up would have no meaningful boundary. The agent is invoked
 * *after* a band is breached, and the tier decides what it may do.
 *
 * The rules are the Western Electric set, which catch slow drift as well as
 * spikes. A single point past 3 sigma is the obvious case; the others exist
 * because a metric that sits just past 1 sigma for a week is a real problem
 * that a threshold alone would never report.
 */

export type Conclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | string;

export type Run = {
  readonly id: number;
  readonly conclusion: Conclusion;
  /** ISO 8601. Used only for ordering and for the report. */
  readonly createdAt: string;
};

export type Baseline = {
  readonly mean: number;
  readonly stddev: number;
  readonly samples: number;
};

export type Tier = 'none' | '1sigma' | '2sigma' | '3sigma';

export type Breach = {
  readonly metric: string;
  readonly tier: Tier;
  readonly rule: string;
  readonly value: number;
  readonly baseline: Baseline;
  readonly evidence: readonly string[];
};

export type DetectOptions = {
  readonly metric: string;
  readonly minSamples: number;
};

/**
 * Turns a run list into a per-run failure series: 1 for a failure, 0 for a
 * success. Cancelled and skipped runs are excluded rather than counted as
 * either — a cancelled run is an absence of evidence, not evidence of health.
 */
export function toFailureSeries(runs: readonly Run[]): number[] {
  return runs
    .filter((r) => r.conclusion === 'success' || r.conclusion === 'failure')
    .map((r) => (r.conclusion === 'failure' ? 1 : 0));
}

export function baselineOf(series: readonly number[]): Baseline {
  const samples = series.length;
  if (samples === 0) return { mean: 0, stddev: 0, samples: 0 };

  const mean = series.reduce((a, b) => a + b, 0) / samples;
  const variance = series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples;
  return { mean, stddev: Math.sqrt(variance), samples };
}

/** How many standard deviations `value` sits above the mean. */
export function sigmaOf(value: number, baseline: Baseline): number {
  if (baseline.stddev === 0) return value > baseline.mean ? Number.POSITIVE_INFINITY : 0;
  return (value - baseline.mean) / baseline.stddev;
}

/** Counts how many of the most recent `n` points exceed `k` sigma above mean. */
function recentBeyond(series: readonly number[], baseline: Baseline, n: number, k: number): number {
  return series
    .slice(-n)
    .filter((v) => sigmaOf(v, baseline) >= k)
    .length;
}

/**
 * Applies the Western Electric rules to a series, most severe first.
 *
 * `series` is ordered oldest to newest. The series is compared against a
 * baseline built from everything *except* the newest point, so a breach is
 * measured against history rather than against itself.
 */
export function classify(
  series: readonly number[],
  options: DetectOptions,
): Omit<Breach, 'metric'> | null {
  if (series.length < options.minSamples) return null;

  const history = series.slice(0, -1);
  const latest = series[series.length - 1];
  if (latest === undefined) return null;

  const baseline = baselineOf(history);
  const sigma = sigmaOf(latest, baseline);

  const base = { value: latest, baseline };

  // Rule 1 — one point beyond 3 sigma.
  if (sigma >= 3) {
    return {
      ...base,
      tier: '3sigma',
      rule: 'one point beyond 3 sigma',
      evidence: [`latest ${fmt(latest)} is ${fmt(sigma)} sigma above a mean of ${fmt(baseline.mean)}`],
    };
  }

  // Rule 2 — two of the last three beyond 2 sigma.
  if (recentBeyond(series, baseline, 3, 2) >= 2) {
    return {
      ...base,
      tier: '2sigma',
      rule: 'two of three beyond 2 sigma',
      evidence: [`2 of the last 3 samples sit beyond 2 sigma (mean ${fmt(baseline.mean)})`],
    };
  }

  // Rule 3 — four of the last five beyond 1 sigma. This is the slow-drift
  // case a fixed threshold would never report.
  if (recentBeyond(series, baseline, 5, 1) >= 4) {
    return {
      ...base,
      tier: '2sigma',
      rule: 'four of five beyond 1 sigma',
      evidence: [`4 of the last 5 samples sit beyond 1 sigma (mean ${fmt(baseline.mean)})`],
    };
  }

  // Rule 4 — eight consecutive above the mean, however slightly.
  const lastEight = series.slice(-8);
  if (lastEight.length === 8 && lastEight.every((v) => v > baseline.mean)) {
    return {
      ...base,
      tier: '1sigma',
      rule: 'eight consecutive above the mean',
      evidence: [`the last 8 samples all sit above a mean of ${fmt(baseline.mean)}`],
    };
  }

  if (sigma >= 1) {
    return {
      ...base,
      tier: '1sigma',
      rule: 'one point beyond 1 sigma',
      evidence: [`latest ${fmt(latest)} is ${fmt(sigma)} sigma above the mean`],
    };
  }

  return null;
}

export function detect(runs: readonly Run[], options: DetectOptions): Breach | null {
  const series = toFailureSeries(runs);
  const result = classify(series, options);
  return result === null ? null : { ...result, metric: options.metric };
}

/** What the tier permits. Mirrors bands.yaml, and is asserted against it. */
export function actionFor(tier: Tier): 'none' | 'log' | 'diagnose' | 'propose' {
  switch (tier) {
    case '3sigma':
      return 'propose';
    case '2sigma':
      return 'diagnose';
    case '1sigma':
      return 'log';
    case 'none':
      return 'none';
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toFixed(2);
}

/** Renders a breach as the body of an intent.md, closing the loop. */
export function toIntentMarkdown(breach: Breach, extra: readonly string[] = []): string {
  const action = actionFor(breach.tier);
  return `# Intent: ${breach.metric} breached ${breach.tier}

**Author:** watchtower (automated)
**Status:** draft — awaiting triage
**Tier:** ${breach.tier} → ${action}

## Problem

The \`${breach.metric}\` control band was breached: ${breach.rule}.

${breach.evidence.map((e) => `- ${e}`).join('\n')}

Baseline over ${breach.baseline.samples} samples: mean ${fmt(breach.baseline.mean)}, standard deviation ${fmt(breach.baseline.stddev)}.

## Proposed outcome

The metric returns to its baseline band, and the cause is either fixed or
explicitly accepted with the band retuned to match reality.

## Affected users and systems

${extra.length > 0 ? extra.map((e) => `- ${e}`).join('\n') : '- To be established during triage.'}

## Constraints

Detection is deterministic and this finding was raised without a human in the
path. Triage is not: a person decides whether to fix now, schedule, or dismiss.
A dismissal should retune the band rather than be repeated.

## Open questions

1. Is this a real regression or has the baseline drifted legitimately?
2. If real, does it warrant a fix now or a scheduled one?
3. Should this become a permanent case in \`evals/\` so it cannot recur silently?
`;
}
