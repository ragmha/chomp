import { describe, expect, it } from 'vitest';
import { COLS, SPAWN, TUNNEL_ROW } from './maze.ts';
import {
  DEATH_FREEZE_TICKS,
  createGame,
  frightenedDuration,
  step,
  tileOf,
  type GameState,
  type Intent,
} from './state.ts';
import { COMBO_LADDER, EXTRA_LIFE_AT } from './scoring.ts';

/** Runs `n` ticks, holding `intent` throughout. */
function run(state: GameState, n: number, intent: Intent = 'none'): GameState {
  let s = state;
  for (let i = 0; i < n; i += 1) s = step(s, intent);
  return s;
}

/** Skips the "ready" countdown so tests can get straight to play. */
function started(seed = 1): GameState {
  return run(createGame(seed), 61);
}

describe('game state', () => {
  it('holds the player still during the ready countdown', () => {
    const state = createGame(1);
    expect(state.status).toBe('ready');
    const after = run(state, 30, 'left');
    expect(tileOf(after.player)).toEqual(SPAWN.player);
  });

  it('starts playing once the countdown ends', () => {
    expect(started().status).toBe('playing');
  });

  it('moves the player in the requested direction', () => {
    const before = started();
    const after = run(before, 40, 'left');
    expect(after.player.x).toBeLessThan(before.player.x);
  });

  it('does not walk through walls', () => {
    // Straight up from spawn (13, 23) is wall at row 22, so the player must
    // keep heading left. The first legal up-turn is three tiles away at
    // column 10, so check before they could possibly have reached it.
    const before = started();
    const after = run(before, 8, 'up');
    expect(tileOf(after.player).y).toBe(SPAWN.player.y);
    expect(after.player.dir).toBe('left');
  });

  it('eats pellets and scores them', () => {
    const before = started();
    const after = run(before, 200, 'left');
    expect(after.score).toBeGreaterThan(0);
    expect(after.pelletsLeft).toBeLessThan(before.pelletsLeft);
    expect(after.pelletsEaten).toBeGreaterThan(0);
  });

  it('buffers a turn pressed shortly before a junction', () => {
    // game-feel rule 1. At column 11 heading left, "up" is illegal — row 22 is
    // wall there. The junction at column 10 is eight subpixels away, inside
    // the buffer window, so a single press now must still be honoured on
    // arrival even though the player has stopped pressing.
    let state = started();
    state = { ...state, player: { x: 11 * 8 + 4, y: 23 * 8 + 4, dir: 'left', credit: 0 } };
    state = step(state, 'up');
    expect(state.player.dir).toBe('left');

    const arrived = run(state, 10, 'none');
    expect(arrived.player.dir).toBe('up');
  });

  it('drops a buffered turn that never becomes legal', () => {
    let state = started();
    state = step(state, 'up');
    state = run(state, 20, 'none');
    expect(state.pendingDir).toBeNull();
  });

  it('wraps the player across the tunnel', () => {
    // Place the player at the tunnel mouth and walk left off the edge.
    let state = started();
    state = {
      ...state,
      player: { x: 1 * 8 + 4, y: TUNNEL_ROW * 8 + 4, dir: 'left', credit: 0 },
    };
    state = run(state, 40, 'left');
    expect(tileOf(state.player).x).toBeGreaterThan(COLS - 6);
  });

  it('emits events for the shell to react to', () => {
    const after = run(started(), 200, 'left');
    // Events are how the a11y announcer and audio stay decoupled from the
    // engine; if this is empty the shell has nothing to announce.
    const seen = new Set<string>();
    let s = started();
    for (let i = 0; i < 300; i += 1) {
      s = step(s, 'left');
      for (const e of s.events) seen.add(e.type);
    }
    expect(after.score).toBeGreaterThan(0);
    expect(seen.has('pellet')).toBe(true);
  });
});

describe('power pellets', () => {
  /**
   * Row 23 is walled at column 5, so the corner power pellet at (1, 23) is not
   * reachable by walking left from spawn — it sits in a pocket entered from
   * row 22 or 24. Placing the player on it directly keeps this test about
   * frightened mode rather than about pathfinding.
   */
  function onPowerPellet(): GameState {
    const state = started();
    return { ...state, player: { x: 1 * 8 + 4, y: 23 * 8 + 4, dir: 'left', credit: 0 } };
  }

  it('frightens the ghosts that are on the board', () => {
    const before = onPowerPellet();
    expect(before.ghosts.some((g) => g.mode === 'frightened')).toBe(false);

    const after = step(before, 'none');
    expect(after.ghosts.some((g) => g.mode === 'frightened')).toBe(true);
    expect(after.events.some((e) => e.type === 'power')).toBe(true);
    expect(after.score).toBeGreaterThanOrEqual(50);
  });

  it('leaves ghosts still in the house alone', () => {
    // A ghost that has not yet emerged cannot be eaten, so flipping it to
    // frightened would let the player bank points on something unreachable.
    const after = step(onPowerPellet(), 'none');
    for (const ghost of after.ghosts) {
      if (ghost.mode === 'house') expect(ghost.frightenedTicks).toBe(0);
    }
  });

  it('shortens the frightened window as levels rise', () => {
    expect(frightenedDuration(1)).toBeGreaterThan(frightenedDuration(5));
    expect(frightenedDuration(50)).toBe(0);
  });

  it('scores the combo ladder in order', () => {
    expect(COMBO_LADDER).toEqual([200, 400, 800, 1600]);
    expect(COMBO_LADDER.reduce((a, b) => a + b, 0)).toBe(3000);
  });
});

describe('lives and death', () => {
  it('freezes briefly on death rather than resetting instantly', () => {
    // game-feel rule 5: an instant reset reads as a glitch.
    let state = started();
    // Park a ghost directly on the player.
    state = {
      ...state,
      ghosts: state.ghosts.map((g, i) =>
        i === 0 ? { ...g, x: state.player.x, y: state.player.y, mode: 'chase' } : g,
      ),
    };
    state = step(state, 'none');
    expect(state.status).toBe('dying');
    expect(state.statusTicks).toBe(DEATH_FREEZE_TICKS);
    expect(state.lives).toBe(2);
  });

  it('ends the game when the last life is lost', () => {
    let state = started();
    state = { ...state, lives: 1 };
    state = {
      ...state,
      ghosts: state.ghosts.map((g, i) =>
        i === 0 ? { ...g, x: state.player.x, y: state.player.y, mode: 'chase' } : g,
      ),
    };
    state = step(state, 'none');
    expect(state.lives).toBe(0);
    state = run(state, DEATH_FREEZE_TICKS + 2);
    expect(state.status).toBe('gameOver');
  });

  it('awards an extra life once, at the threshold', () => {
    let state = started();
    state = { ...state, score: EXTRA_LIFE_AT - 5 };
    const after = run(state, 300, 'left');
    expect(after.lives).toBe(4);
    expect(after.awardedExtraLife).toBe(true);
    // And not again.
    const later = run(after, 300, 'left');
    expect(later.lives).toBe(4);
  });
});

describe('level progression', () => {
  it('clears the level when the last pellet goes', () => {
    let state = started();
    state = { ...state, pelletsLeft: 0 };
    state = step(state, 'none');
    expect(state.status).toBe('levelClear');
    expect(state.events.some((e) => e.type === 'levelClear')).toBe(true);
  });

  it('advances the level and refills the board', () => {
    let state = started();
    state = { ...state, pelletsLeft: 0 };
    state = step(state, 'none');
    state = run(state, 60);
    expect(state.level).toBe(2);
    expect(state.pelletsLeft).toBeGreaterThan(180);
  });
});
