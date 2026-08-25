import { describe, expect, it } from 'vitest';
import { PALETTE } from './sprites.ts';

/**
 * a11y-arcade rule 1, the checkable half.
 *
 * The silhouettes are what actually make the four ghosts separable without
 * colour — you cannot assert a silhouette in a `node` test environment, so the
 * E2E screenshot covers that. What *is* testable here is the second line of
 * defence: the four hues must also land on four clearly different lightness
 * values, so a player with deuteranopia or protanopia, or anyone on a
 * washed-out projector, still reads four distinct sprites.
 *
 * If someone "just tweaks the pink", this fails and tells them why.
 */

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = Number.parseInt(match[1] ?? '', 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 2.x relative luminance — the same maths behind a contrast ratio. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Chosen empirically: the tightest pair in the palette sits at 0.13, and 0.10
 * is roughly where two greys stop being tellable apart side by side on a
 * mid-quality display. Raising this is fine; lowering it needs an argument.
 */
const MIN_LUMINANCE_GAP = 0.1;

describe('ghost palette in greyscale', () => {
  const entries = Object.entries(PALETTE.ghosts);

  it('has all four ghosts', () => {
    expect(entries.map(([name]) => name).sort()).toEqual([
      'drift',
      'hunter',
      'oracle',
      'tumble',
    ]);
  });

  it.each(entries)('%s is a six-digit hex colour', (_name, hex) => {
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('keeps every pair of ghosts apart by lightness alone', () => {
    const gaps: string[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i];
        const b = entries[j];
        if (a === undefined || b === undefined) continue;
        const gap = Math.abs(relativeLuminance(a[1]) - relativeLuminance(b[1]));
        gaps.push(`${a[0]}/${b[0]} = ${gap.toFixed(3)}`);
        expect(
          gap,
          `${a[0]} (${a[1]}) and ${b[0]} (${b[1]}) are ${gap.toFixed(3)} apart in luminance`,
        ).toBeGreaterThanOrEqual(MIN_LUMINANCE_GAP);
      }
    }
    expect(gaps).toHaveLength(6);
  });

  it('separates every ghost from the board background', () => {
    for (const [name, hex] of entries) {
      expect(contrastRatio(hex, PALETTE.background), `${name} against the board`).toBeGreaterThan(3);
    }
  });

  it('separates the frightened body from every normal ghost', () => {
    // Frightened ghosts change silhouette too, but the colour must not collide
    // with a ghost that is still dangerous.
    for (const [name, hex] of entries) {
      const gap = Math.abs(relativeLuminance(hex) - relativeLuminance(PALETTE.frightened));
      expect(gap, `frightened against ${name}`).toBeGreaterThan(0.05);
    }
  });
});

describe('HUD contrast', () => {
  // a11y-arcade rule 7.
  it.each([
    ['hudText', PALETTE.hudText],
    ['hudLabel', PALETTE.hudLabel],
    ['accent', PALETTE.accent],
    ['danger', PALETTE.danger],
  ])('%s clears 4.5:1 against the panel', (_name, hex) => {
    expect(contrastRatio(hex, PALETTE.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps pellets readable against the board', () => {
    expect(contrastRatio(PALETTE.pellet, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.power, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.player, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
  });
});
