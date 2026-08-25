import { describe, expect, it } from 'vitest';
import { SCATTER_CORNERS, SPAWN, TUNNEL_ROW, isWalkable } from './maze.ts';
import { createGame, step, tileOf, type GameState, type Ghost, type GhostName } from './state.ts';
import { ghostSpeed, houseReleaseThreshold, phaseFor, targetFor } from './ghosts.ts';

function ghost(state: GameState, name: GhostName): Ghost {
  const found = state.ghosts.find((g) => g.name === name);
  if (found === undefined) throw new Error(`no ghost named ${name}`);
  return found;
}

/** Puts every ghost in chase mode at a known tile so targets are comparable. */
function chasing(): GameState {
  const base = createGame(1);
  return {
    ...base,
    status: 'playing',
    player: { x: 13 * 8 + 4, y: 23 * 8 + 4, dir: 'left', credit: 0 },
    ghosts: base.ghosts.map((g) => ({
      ...g,
      mode: 'chase' as const,
      x: 13 * 8 + 4,
      y: 11 * 8 + 4,
    })),
  };
}

describe('ghost targeting', () => {
  const state = chasing();
  const player = tileOf(state.player);

  it('sends Hunter straight at the player', () => {
    expect(targetFor(state, ghost(state, 'hunter'))).toEqual(player);
  });

  it('sends Oracle ahead of the player, not at them', () => {
    // The player faces left, so Oracle aims four tiles further left.
    expect(targetFor(state, ghost(state, 'oracle'))).toEqual({
      x: player.x - 4,
      y: player.y,
    });
  });

  it('reflects Drift through a point ahead of the player', () => {
    // pivot = two tiles ahead; target = pivot reflected about Hunter.
    const hunter = tileOf(ghost(state, 'hunter'));
    const pivot = { x: player.x - 2, y: player.y };
    expect(targetFor(state, ghost(state, 'drift'))).toEqual({
      x: pivot.x * 2 - hunter.x,
      y: pivot.y * 2 - hunter.y,
    });
  });

  it('makes Tumble lose its nerve inside eight tiles', () => {
    const near: Ghost = { ...ghost(state, 'tumble'), x: 13 * 8 + 4, y: 21 * 8 + 4 };
    const far: Ghost = { ...ghost(state, 'tumble'), x: 2 * 8 + 4, y: 3 * 8 + 4 };

    expect(targetFor(state, near)).toEqual(SCATTER_CORNERS.tumble);
    expect(targetFor(state, far)).toEqual(player);
  });

  it('gives the four ghosts genuinely different targets', () => {
    // The whole design rests on this: four ghosts sharing one target would be
    // one enemy drawn four times.
    const targets = state.ghosts.map((g) => JSON.stringify(targetFor(state, g)));
    expect(new Set(targets).size).toBeGreaterThanOrEqual(3);
  });

  it('sends every ghost to its own corner while scattering', () => {
    const corners = state.ghosts.map((g) =>
      JSON.stringify(targetFor(state, { ...g, mode: 'scatter' })),
    );
    expect(new Set(corners).size).toBe(4);
  });

  it('sends eaten ghosts home', () => {
    const eaten: Ghost = { ...ghost(state, 'hunter'), mode: 'eaten' };
    expect(targetFor(state, eaten)).toEqual(SPAWN.house);
  });
});

describe('scatter and chase phases', () => {
  it('opens on scatter so the player gets a moment to read the board', () => {
    expect(phaseFor(1, 0)).toBe('scatter');
  });

  it('alternates rather than chasing forever', () => {
    const seen = new Set<string>();
    for (let t = 0; t < 60 * 60; t += 60) seen.add(phaseFor(1, t));
    expect(seen).toEqual(new Set(['scatter', 'chase']));
  });

  it('settles into permanent chase eventually', () => {
    expect(phaseFor(1, 60 * 60 * 10)).toBe('chase');
  });

  it('scatters less on higher levels', () => {
    const scatterAt = (level: number): number => {
      let n = 0;
      for (let t = 0; t < 60 * 120; t += 60) if (phaseFor(level, t) === 'scatter') n += 1;
      return n;
    };
    expect(scatterAt(3)).toBeLessThan(scatterAt(1));
  });
});

describe('ghost speed', () => {
  const base = chasing();
  const hunter = ghost(base, 'hunter');
  const openTile = { x: 13, y: 20 };

  it('keeps chasing ghosts a little slower than the player', () => {
    // game-feel rule 6: the player must be able to outrun them in the open,
    // or a chase is not survivable, only random.
    expect(ghostSpeed({ ...hunter, mode: 'chase' }, 1, openTile)).toBeLessThan(256);
  });

  it('slows frightened ghosts markedly', () => {
    const frightened = ghostSpeed({ ...hunter, mode: 'frightened' }, 1, openTile);
    expect(frightened).toBeLessThan(ghostSpeed({ ...hunter, mode: 'chase' }, 1, openTile));
  });

  it('slows ghosts in the tunnel so it works as an escape route', () => {
    const inTunnel = ghostSpeed({ ...hunter, mode: 'chase' }, 1, { x: 2, y: TUNNEL_ROW });
    const outside = ghostSpeed({ ...hunter, mode: 'chase' }, 1, openTile);
    expect(inTunnel).toBeLessThan(outside);
  });

  it('rushes eyes back to the house so a kill is not a long rest', () => {
    expect(ghostSpeed({ ...hunter, mode: 'eaten' }, 1, openTile)).toBeGreaterThan(256);
  });

  it('speeds ghosts up on later levels', () => {
    expect(ghostSpeed({ ...hunter, mode: 'chase' }, 6, openTile)).toBeGreaterThan(
      ghostSpeed({ ...hunter, mode: 'chase' }, 1, openTile),
    );
  });
});

describe('house release', () => {
  it('puts Hunter out immediately and staggers the rest', () => {
    expect(houseReleaseThreshold('hunter', 1)).toBe(0);
    expect(houseReleaseThreshold('oracle', 1)).toBeGreaterThan(0);
    expect(houseReleaseThreshold('drift', 1)).toBeGreaterThan(houseReleaseThreshold('oracle', 1));
    expect(houseReleaseThreshold('tumble', 1)).toBeGreaterThan(houseReleaseThreshold('drift', 1));
  });

  it('crowds the board sooner on later levels', () => {
    expect(houseReleaseThreshold('tumble', 5)).toBeLessThan(houseReleaseThreshold('tumble', 1));
  });
});

describe('ghosts in play', () => {
  it('leave the house as the player eats pellets', () => {
    let state = createGame(1);
    for (let i = 0; i < 60 * 25; i += 1) {
      state = step(state, i % 40 < 20 ? 'left' : 'up');
    }
    expect(state.pelletsEaten).toBeGreaterThan(0);
    expect(state.ghosts.filter((g) => g.mode === 'house').length).toBeLessThan(4);
  });

  it('never leaves a ghost stuck inside a wall', () => {
    let state = createGame(1);
    for (let i = 0; i < 60 * 30; i += 1) {
      state = step(state, i % 40 < 20 ? 'left' : 'down');
      for (const g of state.ghosts) {
        const tile = tileOf(g);
        expect(isWalkable({ ...state.maze, tiles: state.tiles }, tile.x, tile.y, true)).toBe(true);
      }
    }
  });
});
