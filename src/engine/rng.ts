/**
 * Seeded pseudo-random number generator.
 *
 * The engine may not call Math.random — see plan/0001-chomp.md risk R1 and the
 * ESLint rule that enforces it. Everything stochastic in CHOMP flows through
 * here, so a recorded seed plus a recorded input tape reproduces a session
 * exactly. That property is what the replay tests and the eval suite stand on.
 *
 * mulberry32: 32-bit state, fast, and good enough for deciding which way a
 * frightened ghost turns. Not suitable for anything cryptographic.
 */

export type Rng = {
  readonly seed: number;
};

export function createRng(seed: number): Rng {
  // Force to uint32 so a caller passing a float or a negative gets a stable,
  // predictable state rather than silently diverging behaviour.
  return { seed: seed >>> 0 };
}

/**
 * Returns the next value together with the advanced generator, rather than
 * mutating in place. Callers thread the new Rng through their state, which
 * keeps `step()` a pure function.
 */
export function next(rng: Rng): { rng: Rng; value: number } {
  const t = (rng.seed + 0x6d2b79f5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { rng: { seed: t }, value };
}

/** Integer in [0, bound). Returns 0 for a non-positive bound. */
export function nextInt(rng: Rng, bound: number): { rng: Rng; value: number } {
  if (bound <= 0) return { rng, value: 0 };
  const step = next(rng);
  return { rng: step.rng, value: Math.floor(step.value * bound) };
}

/** Picks one element, threading the generator. Throws on an empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): { rng: Rng; value: T } {
  if (items.length === 0) {
    throw new Error('pick() called with an empty list');
  }
  const step = nextInt(rng, items.length);
  const value = items[step.value];
  if (value === undefined) {
    throw new Error(`pick() produced an out-of-range index: ${step.value}`);
  }
  return { rng: step.rng, value };
}
