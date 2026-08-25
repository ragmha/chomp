import {
  SCATTER_CORNERS,
  SPAWN,
  Tile,
  createMaze,
  index,
  isInsideHouse,
  isWalkable,
  wrap,
  type Maze,
  type Point,
} from './maze.ts';
import { createRng, type Rng } from './rng.ts';
import { chooseGhostDirection, ghostSpeed, houseReleaseThreshold, phaseFor } from './ghosts.ts';
import { eatTile, ghostCollisions } from './collision.ts';
import { COMBO_LADDER, EXTRA_LIFE_AT, POINTS } from './scoring.ts';

/**
 * The CHOMP engine.
 *
 * `step(state, intent)` is a pure function: same state and same intent give
 * the same next state, always. There is no DOM, no wall clock and no unseeded
 * randomness anywhere below this file — ESLint enforces it, because a leak
 * here shows up as a flaky test rather than as the design violation it is.
 *
 * Positions are integers in subpixels rather than floats. Float drift would
 * make two replays of the same tape diverge, which would cost us the eval
 * suite's oracle. The awkwardness is deliberate; see plan/0001-chomp.md.
 */

/** Subpixels per tile. A tile centre sits at `tile * SUB + CENTRE`. */
export const SUB = 8;
export const CENTRE = SUB / 2;

/** Movement is credited in 1/256ths so speeds can differ by a few percent. */
export const SPEED_SCALE = 256;

/** game-feel rule 2: how close to a junction centre a turn is still allowed. */
export const CORNER_CUT = 2;

/** game-feel rule 1: how long a direction press survives before a junction. */
export const INPUT_BUFFER_TICKS = 8;

/** game-feel rule 5: freeze after death so the player sees what happened. */
export const DEATH_FREEZE_TICKS = 30;
const READY_TICKS = 60;
const LEVEL_CLEAR_TICKS = 48;

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Intent = Dir | 'none';

export const DIRECTIONS: readonly Dir[] = ['up', 'left', 'down', 'right'];

export const DELTA: Readonly<Record<Dir, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function opposite(dir: Dir): Dir {
  switch (dir) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

export type Actor = {
  /** Subpixel position. Tile is `Math.floor(x / SUB)`. */
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
  /** Accumulated movement credit, in 1/SPEED_SCALE subpixels. */
  readonly credit: number;
};

export type GhostName = 'hunter' | 'oracle' | 'drift' | 'tumble';
export const GHOST_NAMES: readonly GhostName[] = ['hunter', 'oracle', 'drift', 'tumble'];

export type GhostMode =
  | 'house'
  | 'leaving'
  | 'scatter'
  | 'chase'
  | 'frightened'
  /** Eyes returning home after being eaten. */
  | 'eaten';

export type Ghost = Actor & {
  readonly name: GhostName;
  readonly mode: GhostMode;
  readonly frightenedTicks: number;
};

export type Status = 'ready' | 'playing' | 'dying' | 'levelClear' | 'gameOver';

/**
 * Emitted by `step` for the shell to react to — sound, screen shake, and the
 * `aria-live` announcements the a11y-arcade skill requires. Keeping them as
 * data rather than callbacks is what lets the engine stay pure.
 */
export type GameEvent =
  | { readonly type: 'pellet' }
  | { readonly type: 'power' }
  | { readonly type: 'ghostEaten'; readonly points: number }
  | { readonly type: 'death'; readonly livesLeft: number }
  | { readonly type: 'levelClear'; readonly level: number }
  | { readonly type: 'extraLife' }
  | { readonly type: 'gameOver'; readonly score: number };

export type GameState = {
  readonly tick: number;
  readonly maze: Maze;
  /** Working copy of the board; pellets are removed as they are eaten. */
  readonly tiles: readonly Tile[];
  readonly player: Actor;
  readonly pendingDir: Dir | null;
  readonly pendingTicks: number;
  readonly ghosts: readonly Ghost[];
  readonly score: number;
  readonly lives: number;
  readonly level: number;
  readonly pelletsEaten: number;
  readonly pelletsLeft: number;
  readonly comboIndex: number;
  readonly status: Status;
  readonly statusTicks: number;
  readonly awardedExtraLife: boolean;
  readonly rng: Rng;
  readonly events: readonly GameEvent[];
};

// --- construction -----------------------------------------------------------

export function actorAtTile(p: Point, dir: Dir): Actor {
  return { x: p.x * SUB + CENTRE, y: p.y * SUB + CENTRE, dir, credit: 0 };
}

function spawnGhosts(): Ghost[] {
  // Hunter starts outside so there is pressure from the first second; the
  // others emerge as pellets are eaten. A board where nothing chases you for
  // ten seconds teaches the player the wrong rhythm.
  const seats: Record<GhostName, Point> = {
    hunter: SPAWN.houseExit,
    oracle: { x: 13, y: 14 },
    drift: { x: 11, y: 14 },
    tumble: { x: 16, y: 14 },
  };
  return GHOST_NAMES.map((name) => ({
    ...actorAtTile(seats[name], name === 'hunter' ? 'left' : 'up'),
    name,
    mode: name === 'hunter' ? 'scatter' : 'house',
    frightenedTicks: 0,
  }));
}

export function createGame(seed = 1, level = 1): GameState {
  const maze = createMaze();
  return {
    tick: 0,
    maze,
    tiles: maze.tiles,
    player: actorAtTile(SPAWN.player, 'left'),
    pendingDir: null,
    pendingTicks: 0,
    ghosts: spawnGhosts(),
    score: 0,
    lives: 3,
    level,
    pelletsEaten: 0,
    pelletsLeft: maze.pelletTotal,
    comboIndex: 0,
    status: 'ready',
    statusTicks: READY_TICKS,
    awardedExtraLife: false,
    rng: createRng(seed),
    events: [],
  };
}

/** Resets actor positions after a death, keeping score and board state. */
function resetActors(state: GameState): GameState {
  return {
    ...state,
    player: actorAtTile(SPAWN.player, 'left'),
    pendingDir: null,
    pendingTicks: 0,
    ghosts: spawnGhosts(),
    comboIndex: 0,
    status: 'ready',
    statusTicks: READY_TICKS,
  };
}

// --- geometry helpers -------------------------------------------------------

export function tileOf(actor: Actor): Point {
  return { x: Math.floor(actor.x / SUB), y: Math.floor(actor.y / SUB) };
}

function offsetInTile(actor: Actor): Point {
  return { x: actor.x % SUB, y: actor.y % SUB };
}

/** True when the actor is close enough to a tile centre to turn. */
function nearCentre(actor: Actor): boolean {
  const o = offsetInTile(actor);
  return Math.abs(o.x - CENTRE) <= CORNER_CUT && Math.abs(o.y - CENTRE) <= CORNER_CUT;
}

function exactlyCentred(actor: Actor): boolean {
  const o = offsetInTile(actor);
  return o.x === CENTRE && o.y === CENTRE;
}

// Generic over the actor type so a Ghost stays a Ghost: these helpers are
// used for both, and widening to Actor would silently drop ghost fields.
function snapToCentre<T extends Actor>(actor: T): T {
  const t = tileOf(actor);
  return { ...actor, x: t.x * SUB + CENTRE, y: t.y * SUB + CENTRE };
}

export function canEnter(
  state: GameState,
  from: Point,
  dir: Dir,
  passDoor: boolean,
): boolean {
  const d = DELTA[dir];
  const target = wrap({ x: from.x + d.x, y: from.y + d.y });
  return isWalkable({ ...state.maze, tiles: state.tiles }, target.x, target.y, passDoor);
}

/** Advances one subpixel, wrapping across the tunnel. Blocked moves stall. */
function advance<T extends Actor>(state: GameState, actor: T, passDoor: boolean): T {
  const d = DELTA[actor.dir];
  const tile = tileOf(actor);
  const o = offsetInTile(actor);

  // Only the step that leaves a tile centre needs a wall check; the rest of
  // the traversal is already known to be legal.
  const leavingCentre =
    (d.x !== 0 && o.x === CENTRE) || (d.y !== 0 && o.y === CENTRE);
  if (leavingCentre && !canEnter(state, tile, actor.dir, passDoor)) {
    return snapToCentre(actor);
  }

  let x = actor.x + d.x;
  const y = actor.y + d.y;

  const width = state.maze.tiles.length / 31;
  const span = width * SUB;
  if (x < 0) x += span;
  else if (x >= span) x -= span;

  return { ...actor, x, y };
}

// --- the reducer ------------------------------------------------------------

/**
 * Advances the game by exactly one tick.
 *
 * Every call returns a fresh state; nothing is mutated. `intent` is the
 * direction the player is asking for this tick, or 'none'.
 */
export function step(state: GameState, intent: Intent): GameState {
  const events: GameEvent[] = [];
  let next: GameState = { ...state, tick: state.tick + 1, events: [] };

  next = bufferIntent(next, intent);

  switch (state.status) {
    case 'ready':
      return countdown(next, 'playing');
    case 'dying':
      return next.statusTicks > 1
        ? { ...next, statusTicks: next.statusTicks - 1 }
        : afterDeath(next);
    case 'levelClear':
      return next.statusTicks > 1
        ? { ...next, statusTicks: next.statusTicks - 1 }
        : nextLevel(next);
    case 'gameOver':
      return next;
    case 'playing':
      break;
  }

  next = movePlayer(next);
  next = consumeTile(next, events);
  next = moveGhosts(next);
  next = resolveContacts(next, events);

  if (next.status === 'playing' && next.pelletsLeft === 0) {
    events.push({ type: 'levelClear', level: next.level });
    next = { ...next, status: 'levelClear', statusTicks: LEVEL_CLEAR_TICKS };
  }

  return { ...next, events };
}

function bufferIntent(state: GameState, intent: Intent): GameState {
  if (intent !== 'none') {
    // game-feel rule 1: a direction pressed slightly early is honoured at the
    // next junction rather than dropped. Dropping it is the single most common
    // way a maze-chase game comes to feel unresponsive.
    return { ...state, pendingDir: intent, pendingTicks: INPUT_BUFFER_TICKS };
  }
  if (state.pendingTicks > 0) {
    const pendingTicks = state.pendingTicks - 1;
    return {
      ...state,
      pendingTicks,
      pendingDir: pendingTicks === 0 ? null : state.pendingDir,
    };
  }
  return state;
}

function countdown(state: GameState, then: Status): GameState {
  if (state.statusTicks > 1) {
    return { ...state, statusTicks: state.statusTicks - 1 };
  }
  return { ...state, status: then, statusTicks: 0 };
}

function movePlayer(state: GameState): GameState {
  let player = state.player;
  let { pendingDir, pendingTicks } = state;

  // Apply a buffered turn when one is possible.
  if (pendingDir !== null && pendingDir !== player.dir && nearCentre(player)) {
    const tile = tileOf(player);
    if (canEnter(state, tile, pendingDir, false)) {
      player = { ...snapToCentre(player), dir: pendingDir };
      pendingDir = null;
      pendingTicks = 0;
    }
  }

  const speed = playerSpeed(state);
  let credit = player.credit + speed;
  while (credit >= SPEED_SCALE) {
    credit -= SPEED_SCALE;
    player = advance({ ...state, player }, player, false);
  }

  return { ...state, player: { ...player, credit }, pendingDir, pendingTicks };
}

/**
 * game-feel rule 6: the player is marginally faster than the ghosts in open
 * corridors, which is what makes a chase feel survivable rather than random.
 */
function playerSpeed(state: GameState): number {
  const base = 256;
  const levelBoost = Math.min(state.level - 1, 4) * 4;
  return base + levelBoost;
}

function consumeTile(state: GameState, events: GameEvent[]): GameState {
  if (!exactlyCentred(state.player)) return state;

  const tile = tileOf(state.player);
  const result = eatTile(state.tiles, tile);
  if (result === null) return state;

  const { tiles, kind } = result;
  let score = state.score;
  let comboIndex = state.comboIndex;
  let ghosts = state.ghosts;

  if (kind === 'pellet') {
    score += POINTS.pellet;
    events.push({ type: 'pellet' });
  } else {
    score += POINTS.power;
    comboIndex = 0;
    const duration = frightenedDuration(state.level);
    ghosts = state.ghosts.map((g) =>
      g.mode === 'eaten' || g.mode === 'house' || g.mode === 'leaving'
        ? g
        : { ...g, mode: 'frightened', frightenedTicks: duration, dir: opposite(g.dir) },
    );
    events.push({ type: 'power' });
  }

  let { lives, awardedExtraLife } = state;
  if (!awardedExtraLife && score >= EXTRA_LIFE_AT) {
    lives += 1;
    awardedExtraLife = true;
    events.push({ type: 'extraLife' });
  }

  return {
    ...state,
    tiles,
    ghosts,
    score,
    lives,
    awardedExtraLife,
    comboIndex,
    pelletsEaten: state.pelletsEaten + 1,
    pelletsLeft: state.pelletsLeft - 1,
  };
}

/** Frightened time shrinks as levels rise; by level 9 there is none left. */
export function frightenedDuration(level: number): number {
  return Math.max(0, 8 * 60 - (level - 1) * 50);
}

function moveGhosts(state: GameState): GameState {
  const phase = phaseFor(state.level, state.tick);
  let rng = state.rng;

  const ghosts = state.ghosts.map((ghost) => {
    let g = ghost;

    if (g.frightenedTicks > 0) {
      const frightenedTicks = g.frightenedTicks - 1;
      g = {
        ...g,
        frightenedTicks,
        mode: frightenedTicks === 0 && g.mode === 'frightened' ? phase : g.mode,
      };
    } else if (g.mode === 'scatter' || g.mode === 'chase') {
      g = { ...g, mode: phase };
    }

    if (g.mode === 'house') {
      g = releaseFromHouse(g, state);
    }

    const speed = ghostSpeed(g, state.level, tileOf(g));
    let credit = g.credit + speed;

    while (credit >= SPEED_SCALE) {
      credit -= SPEED_SCALE;
      const passDoor = g.mode === 'eaten' || g.mode === 'leaving' || g.mode === 'house';

      if (exactlyCentred(g)) {
        const decision = chooseGhostDirection(state, g, rng);
        rng = decision.rng;
        g = { ...g, dir: decision.dir };
      }
      g = advance(state, g, passDoor);

      if (g.mode === 'eaten' && isInsideHouse(tileOf(g))) {
        g = { ...g, mode: 'leaving', frightenedTicks: 0 };
      } else if (g.mode === 'leaving' && tileOf(g).y <= SPAWN.houseExit.y) {
        g = { ...g, mode: phase };
      }
    }

    return { ...g, credit };
  });

  return { ...state, ghosts, rng };
}

function releaseFromHouse(ghost: Ghost, state: GameState): Ghost {
  const threshold = houseReleaseThreshold(ghost.name, state.level);
  return state.pelletsEaten >= threshold ? { ...ghost, mode: 'leaving' } : ghost;
}

function resolveContacts(state: GameState, events: GameEvent[]): GameState {
  const hits = ghostCollisions(state.player, state.ghosts);
  if (hits.length === 0) return state;

  let score = state.score;
  let comboIndex = state.comboIndex;
  const ghosts = [...state.ghosts];
  let killed = false;

  for (const i of hits) {
    const ghost = ghosts[i];
    if (ghost === undefined) continue;

    if (ghost.mode === 'frightened') {
      const points = COMBO_LADDER[Math.min(comboIndex, COMBO_LADDER.length - 1)] ?? 200;
      score += points;
      comboIndex += 1;
      ghosts[i] = { ...ghost, mode: 'eaten', frightenedTicks: 0 };
      events.push({ type: 'ghostEaten', points });
    } else if (ghost.mode !== 'eaten') {
      killed = true;
    }
  }

  let { lives, awardedExtraLife } = state;
  if (!awardedExtraLife && score >= EXTRA_LIFE_AT) {
    lives += 1;
    awardedExtraLife = true;
    events.push({ type: 'extraLife' });
  }

  if (killed) {
    const livesLeft = state.lives - 1;
    events.push({ type: 'death', livesLeft });
    if (livesLeft <= 0) events.push({ type: 'gameOver', score });
    return {
      ...state,
      ghosts,
      score,
      lives: livesLeft,
      awardedExtraLife,
      comboIndex,
      status: 'dying',
      statusTicks: DEATH_FREEZE_TICKS,
    };
  }

  return { ...state, ghosts, score, lives, awardedExtraLife, comboIndex };
}

function afterDeath(state: GameState): GameState {
  if (state.lives <= 0) {
    return { ...state, status: 'gameOver', statusTicks: 0 };
  }
  return resetActors(state);
}

function nextLevel(state: GameState): GameState {
  const maze = createMaze();
  return resetActors({
    ...state,
    maze,
    tiles: maze.tiles,
    level: state.level + 1,
    pelletsEaten: 0,
    pelletsLeft: maze.pelletTotal,
  });
}

// --- introspection ----------------------------------------------------------

/**
 * A cheap order-sensitive digest of everything that defines a session. Two
 * runs of the same input tape must produce the same value; `replay.test.ts`
 * asserts exactly that, and the eval suite leans on it.
 */
export function hashState(state: GameState): string {
  let h = 2166136261 >>> 0;
  const push = (n: number): void => {
    h ^= n >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };

  push(state.tick);
  push(state.score);
  push(state.lives);
  push(state.level);
  push(state.pelletsLeft);
  push(state.comboIndex);
  push(state.player.x);
  push(state.player.y);
  push(DIRECTIONS.indexOf(state.player.dir));
  push(state.rng.seed);
  for (const g of state.ghosts) {
    push(g.x);
    push(g.y);
    push(DIRECTIONS.indexOf(g.dir));
    push(g.frightenedTicks);
    push(g.mode.length);
  }
  for (let i = 0; i < state.tiles.length; i += 1) {
    if (state.tiles[i] === Tile.Pellet || state.tiles[i] === Tile.Power) push(i);
  }
  return h.toString(16).padStart(8, '0');
}

export { index, SCATTER_CORNERS, Tile, isInsideHouse, wrap };
export type { Maze, Point, Rng };
