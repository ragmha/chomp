/**
 * Scoring rules.
 *
 * Separated from the reducer because these are the numbers most likely to be
 * tuned, and tuning shouldn't mean editing control flow.
 */

export const POINTS = {
  pellet: 10,
  power: 50,
} as const;

/**
 * Eating ghosts during one power pellet doubles each time. The ladder resets
 * on the next power pellet, not on the next level — clearing all four on a
 * single pellet is the skill ceiling of the game, and worth 3000.
 */
export const COMBO_LADDER: readonly number[] = [200, 400, 800, 1600];

export const EXTRA_LIFE_AT = 10_000;

/** Total available from one perfect power pellet, used in tests and the HUD. */
export function comboTotal(): number {
  return COMBO_LADDER.reduce((sum, n) => sum + n, 0);
}

export function comboValue(index: number): number {
  if (index < 0) return COMBO_LADDER[0] ?? 200;
  return COMBO_LADDER[Math.min(index, COMBO_LADDER.length - 1)] ?? 200;
}
