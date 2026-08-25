import {
  SCATTER_CORNERS,
  SPAWN,
  TUNNEL_ROW,
  isInsideHouse,
  isWalkable,
  wrap,
  type Point,
} from './maze.ts';
import { pick, type Rng } from './rng.ts';
import {
  DELTA,
  DIRECTIONS,
  SPEED_SCALE,
  opposite,
  tileOf,
  type Dir,
  type GameState,
  type Ghost,
  type GhostName,
} from './state.ts';

/**
 * Ghost behaviour.
 *
 * Four ghosts that all chased the player identically would make one enemy
 * repeated four times. The differences below are the whole game: each ghost
 * picks a target tile every time it reaches a junction, then greedily steps
 * toward it. Simple rules, but because the targets differ the four produce
 * genuinely different pressure, and the player can learn to read them.
 *
 * Names are original to CHOMP. See the attribution note in README.md.
 */

// --- scatter / chase --------------------------------------------------------

/**
 * Ghosts alternate between scattering to their corners and chasing. The
 * alternation is what gives a level its rhythm — without it the game is a
 * uniform grind with no moments of relief. Later levels scatter less.
 */
const PHASE_TABLE: readonly (readonly number[])[] = [
  // seconds of scatter, chase, scatter, chase, ...
  [7, 20, 7, 20, 5, 20, 5],
  [7, 20, 7, 20, 5, 1033, 1],
  [5, 20, 5, 20, 5, 1037, 1],
];

export function phaseFor(level: number, tick: number): 'scatter' | 'chase' {
  const row =
    PHASE_TABLE[Math.min(level - 1, PHASE_TABLE.length - 1)] ?? PHASE_TABLE[0] ?? [];
  let elapsed = Math.floor(tick / 60);
  for (let i = 0; i < row.length; i += 1) {
    const span = row[i] ?? 0;
    if (elapsed < span) return i % 2 === 0 ? 'scatter' : 'chase';
    elapsed -= span;
  }
  // Past the table, ghosts chase indefinitely.
  return 'chase';
}

// --- house release ----------------------------------------------------------

/**
 * Ghosts leave the house as pellets are eaten rather than on a timer, so the
 * pressure tracks the player's progress instead of punishing a slow start.
 */
export function houseReleaseThreshold(name: GhostName, level: number): number {
  const base: Record<GhostName, number> = {
    hunter: 0,
    oracle: 6,
    drift: 30,
    tumble: 70,
  };
  // Higher levels crowd the board sooner.
  const scale = Math.max(0.25, 1 - (level - 1) * 0.15);
  return Math.floor((base[name] ?? 0) * scale);
}

// --- speed ------------------------------------------------------------------

/**
 * game-feel rule 6: ghosts are marginally slower than the player in the open
 * and markedly slower in the tunnel, which is what makes the tunnel a genuine
 * escape route rather than decoration.
 */
export function ghostSpeed(ghost: Ghost, level: number, tile: Point): number {
  if (ghost.mode === 'eaten') return SPEED_SCALE * 2;
  if (ghost.mode === 'house' || ghost.mode === 'leaving') return Math.round(SPEED_SCALE * 0.5);

  const levelBoost = Math.min(level - 1, 6) * 0.02;
  let factor = 0.94 + levelBoost;

  if (ghost.mode === 'frightened') factor = 0.55;
  else if (tile.y === TUNNEL_ROW && (tile.x <= 5 || tile.x >= 22)) factor *= 0.6;

  return Math.round(SPEED_SCALE * factor);
}

// --- targeting --------------------------------------------------------------

function ahead(tile: Point, dir: Dir, n: number): Point {
  const d = DELTA[dir];
  return { x: tile.x + d.x * n, y: tile.y + d.y * n };
}

/**
 * The tile each ghost is currently steering toward. Exported because it is
 * the clearest thing to assert in tests and to draw in a debug overlay — the
 * behaviour differences are visible as four different target tiles.
 */
export function targetFor(state: GameState, ghost: Ghost): Point {
  if (ghost.mode === 'eaten') return SPAWN.house;
  if (ghost.mode === 'house' || ghost.mode === 'leaving') return SPAWN.houseExit;
  if (ghost.mode === 'scatter') return SCATTER_CORNERS[ghost.name];

  const player = tileOf(state.player);

  switch (ghost.name) {
    // Relentless and readable. Hunter sets the pace and teaches the player
    // that something is always coming.
    case 'hunter':
      return player;

    // Aims where the player is going, not where they are. Punishes running in
    // straight lines and does the work of cutting off escape routes.
    case 'oracle':
      return ahead(player, state.player.dir, 4);

    // Uses Hunter as a pivot: reflect Hunter's tile through the point two
    // ahead of the player. Alone it wanders; alongside Hunter it pincers.
    case 'drift': {
      const pivot = ahead(player, state.player.dir, 2);
      const hunter = state.ghosts.find((g) => g.name === 'hunter');
      const anchor = hunter === undefined ? player : tileOf(hunter);
      return { x: pivot.x * 2 - anchor.x, y: pivot.y * 2 - anchor.y };
    }

    // Closes in, then loses its nerve within eight tiles and heads home. The
    // resulting false safety is the most interesting thing on the board.
    case 'tumble': {
      const dx = player.x - tileOf(ghost).x;
      const dy = player.y - tileOf(ghost).y;
      const far = dx * dx + dy * dy > 64;
      return far ? player : SCATTER_CORNERS.tumble;
    }
  }
}

// --- direction choice -------------------------------------------------------

function legalDirections(state: GameState, ghost: Ghost): Dir[] {
  const tile = tileOf(ghost);
  const passDoor = ghost.mode === 'eaten' || ghost.mode === 'leaving' || ghost.mode === 'house';
  const board = { ...state.maze, tiles: state.tiles };

  const options = DIRECTIONS.filter((dir) => {
    const d = DELTA[dir];
    const target = wrap({ x: tile.x + d.x, y: tile.y + d.y });
    if (!isWalkable(board, target.x, target.y, passDoor)) return false;
    // Ghosts may not re-enter the house once out.
    if (!passDoor && isInsideHouse(target)) return false;
    return true;
  });

  // Reversing is reserved for phase changes, which the reducer applies
  // directly. Without this rule ghosts dither at junctions.
  const forward = options.filter((dir) => dir !== opposite(ghost.dir));
  return forward.length > 0 ? forward : options;
}

export type Decision = { readonly dir: Dir; readonly rng: Rng };

export function chooseGhostDirection(state: GameState, ghost: Ghost, rng: Rng): Decision {
  const options = legalDirections(state, ghost);
  if (options.length === 0) return { dir: opposite(ghost.dir), rng };
  if (options.length === 1) return { dir: options[0] as Dir, rng };

  // Frightened ghosts pick at random — the one place the engine needs entropy,
  // and the reason the seeded PRNG is threaded through state.
  if (ghost.mode === 'frightened') {
    const chosen = pick(rng, options);
    return { dir: chosen.value, rng: chosen.rng };
  }

  const target = targetFor(state, ghost);
  const tile = tileOf(ghost);

  let best: Dir = options[0] as Dir;
  let bestDistance = Number.POSITIVE_INFINITY;

  // DIRECTIONS is ordered up, left, down, right. Iterating in that fixed order
  // makes ties resolve identically every run, which replay determinism needs.
  for (const dir of DIRECTIONS) {
    if (!options.includes(dir)) continue;
    const d = DELTA[dir];
    const nextTile = { x: tile.x + d.x, y: tile.y + d.y };
    const dx = nextTile.x - target.x;
    const dy = nextTile.y - target.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestDistance) {
      bestDistance = squared;
      best = dir;
    }
  }

  return { dir: best, rng };
}
