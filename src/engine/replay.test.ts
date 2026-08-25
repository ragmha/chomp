import { describe, expect, it } from 'vitest';
import { createGame, hashState, step, type Intent } from './state.ts';

/**
 * Replay tapes.
 *
 * The engine's central promise is that a seed plus a sequence of inputs
 * reproduces a session exactly. These tests are how that promise is kept
 * honest, and they are what lets the eval suite in evals/ assert on an exact
 * outcome rather than asking a model whether the result looks about right.
 *
 * If one of these fails, something non-deterministic has leaked into
 * src/engine — a Math.random, a Date.now, or an iteration over a Set or Map
 * whose order is not guaranteed. See plan/0001-chomp.md risk R1.
 */

/** Builds a repeatable input sequence without using randomness. */
function tape(length: number, seed = 7): Intent[] {
  const moves: Intent[] = ['left', 'up', 'right', 'down', 'none'];
  const out: Intent[] = [];
  let s = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    // A tiny LCG, purely so the tape is varied but fixed.
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(moves[s % moves.length] as Intent);
  }
  return out;
}

function play(inputs: readonly Intent[], seed = 1): ReturnType<typeof createGame> {
  let state = createGame(seed);
  for (const intent of inputs) state = step(state, intent);
  return state;
}

describe('replay determinism', () => {
  it('produces an identical hash for the same tape run twice', () => {
    const inputs = tape(2_000);
    expect(hashState(play(inputs))).toBe(hashState(play(inputs)));
  });

  it('produces an identical hash across three runs of a long tape', () => {
    const inputs = tape(6_000, 99);
    const hashes = [play(inputs), play(inputs), play(inputs)].map(hashState);
    expect(new Set(hashes).size).toBe(1);
  });

  it('diverges when the seed changes', () => {
    // If this ever passes trivially, the seed is not actually reaching the
    // engine and the determinism guarantee is vacuous.
    const inputs = tape(3_000);
    const a = play(inputs, 1);
    const b = play(inputs, 424_242);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('diverges when the input tape changes', () => {
    expect(hashState(play(tape(1_500, 1)))).not.toBe(hashState(play(tape(1_500, 2))));
  });

  it('advances exactly one tick per step', () => {
    let state = createGame(1);
    for (let i = 0; i < 500; i += 1) state = step(state, 'none');
    expect(state.tick).toBe(500);
  });

  it('never mutates the state it was given', () => {
    const before = createGame(1);
    const snapshot = hashState(before);
    for (let i = 0; i < 300; i += 1) step(before, 'left');
    expect(hashState(before)).toBe(snapshot);
  });
});
