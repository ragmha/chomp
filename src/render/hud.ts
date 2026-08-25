import type { GameState } from '../engine/state.ts';

/**
 * The HUD.
 *
 * Four numbers, written with `textContent` and nothing else. secure-web-app
 * rule 1 forbids building markup from data anywhere, and the score is the
 * canonical example: it is player-influenced state rendered back into the
 * page, which is exactly the shape of `js/xss-through-dom`. ESLint fails the
 * build on `innerHTML`, so this is enforced rather than merely intended.
 */

export type HudElements = {
  readonly score: HTMLElement;
  readonly best: HTMLElement;
  readonly level: HTMLElement;
  readonly lives: HTMLElement;
};

function required(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing HUD element #${id}`);
  return el;
}

export function findHud(): HudElements {
  return {
    score: required('score'),
    best: required('best'),
    level: required('level'),
    lives: required('lives'),
  };
}

/** Only writes when a value actually changed, to keep layout thrash off the frame. */
export function createHud(elements: HudElements = findHud()): (state: GameState, best: number) => void {
  const last = { score: -1, best: -1, level: -1, lives: -1 };

  return function update(state: GameState, best: number): void {
    if (state.score !== last.score) {
      elements.score.textContent = String(state.score);
      last.score = state.score;
    }
    if (best !== last.best) {
      elements.best.textContent = String(best);
      last.best = best;
    }
    if (state.level !== last.level) {
      elements.level.textContent = String(state.level);
      last.level = state.level;
    }
    if (state.lives !== last.lives) {
      elements.lives.textContent = String(Math.max(0, state.lives));
      last.lives = state.lives;
    }
  };
}
