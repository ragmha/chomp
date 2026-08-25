import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  actionFor,
  baselineOf,
  classify,
  detect,
  sigmaOf,
  toFailureSeries,
  toIntentMarkdown,
  type Run,
} from './detect.ts';

/**
 * The detector is the one part of the Maintain stage that must never involve a
 * model, so it is the one part that can be tested exhaustively. If these pass,
 * the trigger is trustworthy and the only judgement left is what the agent
 * does after it fires.
 */

const OPTIONS = { metric: 'ci_failure_rate', minSamples: 8 };

function runs(conclusions: readonly string[]): Run[] {
  return conclusions.map((conclusion, i) => ({
    id: i + 1,
    conclusion,
    createdAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  }));
}

describe('toFailureSeries', () => {
  it('maps failures to 1 and successes to 0', () => {
    expect(toFailureSeries(runs(['success', 'failure', 'success']))).toEqual([0, 1, 0]);
  });

  it('ignores cancelled and skipped runs', () => {
    // A cancelled run is an absence of evidence, not evidence of health.
    expect(toFailureSeries(runs(['success', 'cancelled', 'skipped', 'failure']))).toEqual([0, 1]);
  });
});

describe('baselineOf', () => {
  it('computes mean and standard deviation', () => {
    const b = baselineOf([0, 0, 0, 0]);
    expect(b.mean).toBe(0);
    expect(b.stddev).toBe(0);
    expect(b.samples).toBe(4);
  });

  it('handles an empty series without dividing by zero', () => {
    expect(baselineOf([])).toEqual({ mean: 0, stddev: 0, samples: 0 });
  });

  it('measures spread', () => {
    const b = baselineOf([0, 1, 0, 1]);
    expect(b.mean).toBeCloseTo(0.5);
    expect(b.stddev).toBeCloseTo(0.5);
  });
});

describe('sigmaOf', () => {
  it('treats any rise above a flat baseline as unbounded', () => {
    // With zero variance there is no scale, so a single failure after a
    // perfect run of successes is maximally surprising — which is correct.
    expect(sigmaOf(1, { mean: 0, stddev: 0, samples: 10 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports zero when the value matches a flat baseline', () => {
    expect(sigmaOf(0, { mean: 0, stddev: 0, samples: 10 })).toBe(0);
  });
});

describe('classify', () => {
  it('stays silent below the minimum sample count', () => {
    // Reporting a breach off three data points is how alerting loses trust.
    expect(classify([1, 1, 1], OPTIONS)).toBeNull();
  });

  it('stays silent on a healthy series', () => {
    expect(classify([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], OPTIONS)).toBeNull();
  });

  it('catches a single sharp spike at 3 sigma', () => {
    const result = classify([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], OPTIONS);
    expect(result?.tier).toBe('3sigma');
    expect(result?.rule).toBe('one point beyond 3 sigma');
  });

  it('catches slow drift that no fixed threshold would report', () => {
    // Four of the last five above 1 sigma. Each point on its own looks fine.
    const result = classify([0, 0, 0, 0, 0, 0, 1, 1, 1, 1], OPTIONS);
    expect(result).not.toBeNull();
    expect(['2sigma', '3sigma']).toContain(result?.tier);
  });

  it('reports the evidence it used', () => {
    const result = classify([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], OPTIONS);
    expect(result?.evidence.length).toBeGreaterThan(0);
    expect(result?.evidence[0]).toMatch(/sigma/);
  });

  it('measures the latest point against history, not against itself', () => {
    // If the newest sample were included in its own baseline it would drag the
    // mean toward itself and mask the very breach it represents.
    const result = classify([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], OPTIONS);
    expect(result?.baseline.samples).toBe(9);
    expect(result?.baseline.mean).toBe(0);
  });

  it('is deterministic', () => {
    const series = [0, 1, 0, 0, 1, 0, 0, 0, 1, 1];
    const a = JSON.stringify(classify(series, OPTIONS));
    const b = JSON.stringify(classify(series, OPTIONS));
    expect(a).toBe(b);
  });
});

describe('detect', () => {
  it('returns null when nothing is wrong', () => {
    expect(detect(runs(Array(10).fill('success')), OPTIONS)).toBeNull();
  });

  it('names the metric it breached', () => {
    const breach = detect(runs([...Array(9).fill('success'), 'failure']), OPTIONS);
    expect(breach?.metric).toBe('ci_failure_rate');
  });
});

describe('tiers', () => {
  it('maps each tier to the action bands.yaml grants it', () => {
    expect(actionFor('none')).toBe('none');
    expect(actionFor('1sigma')).toBe('log');
    expect(actionFor('2sigma')).toBe('diagnose');
    expect(actionFor('3sigma')).toBe('propose');
  });

  it('agrees with bands.yaml', () => {
    // Config and code drifting apart is how a governance control quietly
    // stops being one. Cheap to assert, so assert it.
    const yaml = readFileSync(new URL('./bands.yaml', import.meta.url), 'utf8');
    for (const [tier, action] of [
      ['1sigma', 'log'],
      ['2sigma', 'diagnose'],
      ['3sigma', 'propose'],
    ] as const) {
      expect(yaml).toMatch(new RegExp(`${tier}:\\s*\\n\\s*action:\\s*${action}`));
    }
  });
});

describe('toIntentMarkdown', () => {
  const breach = detect(runs([...Array(9).fill('success'), 'failure']), OPTIONS);

  it('writes a finding in the same shape as a human-authored intent', () => {
    // The loop only closes if maintenance findings re-enter the normal
    // pipeline rather than getting a private side channel.
    const md = toIntentMarkdown(breach as NonNullable<typeof breach>);
    expect(md).toContain('# Intent:');
    expect(md).toContain('## Problem');
    expect(md).toContain('## Proposed outcome');
    expect(md).toContain('## Constraints');
    expect(md).toContain('## Open questions');
  });

  it('records the tier and the action it authorises', () => {
    const md = toIntentMarkdown(breach as NonNullable<typeof breach>);
    expect(md).toContain('3sigma');
    expect(md).toContain('propose');
  });
});
