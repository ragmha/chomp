import type { Rng } from './rng.ts';

/**
 * The CHOMP board.
 *
 * 28×31 tiles. The dimensions are the genre convention and are not anyone's
 * property, but this layout is original to CHOMP — see the attribution note in
 * README.md. Nothing here is derived from Bandai Namco's maze.
 *
 * Legend:
 *   `#`  wall
 *   `.`  pellet
 *   `o`  power pellet
 *   `-`  ghost house door (ghosts pass, the player does not)
 *   ` `  open floor, no pellet
 *
 * Structural notes:
 *   - Left/right symmetric, which is what makes the board readable at speed.
 *   - Row 14 is the only row open at both edges: that is the tunnel, and
 *     movement wraps across it.
 *   - The ghost house occupies rows 13–15, columns 11–16, with its door at
 *     row 12, columns 13–14.
 *   - Four power pellets, in the four corner approaches.
 *
 * `validateMaze()` below checks every one of these claims, and
 * `maze.test.ts` runs it. If you edit the layout, the tests tell you what you
 * broke rather than the game doing so at runtime.
 */
const LAYOUT = [
  '############################',
  '#o...........##...........o#',
  '#.###.####.######.####.###.#',
  '#.###.####.######.####.###.#',
  '#..........................#',
  '#.###.####.######.####.###.#',
  '#......##..........##......#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '######.##.########.##.######',
  '######.##.########.##.######',
  '######.##..........##.######',
  '######.##.###--###.##.######',
  '######.##.#      #.##.######',
  '      ....#      #....      ',
  '######.##.#      #.##.######',
  '######.##.########.##.######',
  '######.##..........##.######',
  '######.##.########.##.######',
  '######.##.########.##.######',
  '#............##............#',
  '#.###.####.######.####.###.#',
  '#.###.####.######.####.###.#',
  '#o..##.......  .......##..o#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##..........##......#',
  '#.########.######.########.#',
  '#.########.######.########.#',
  '#..........................#',
  '############################',
] as const;

export const COLS = 28;
export const ROWS = 31;

/** The row that wraps left↔right. */
export const TUNNEL_ROW = 14;

export const enum Tile {
  Wall = 0,
  Floor = 1,
  Pellet = 2,
  Power = 3,
  Door = 4,
}

export type Point = { readonly x: number; readonly y: number };

/** Where each actor starts, and where each ghost retreats during scatter. */
export const SPAWN = {
  player: { x: 13, y: 23 },
  house: { x: 13, y: 14 },
  houseExit: { x: 13, y: 11 },
} as const;

export const SCATTER_CORNERS = {
  hunter: { x: 25, y: 1 },
  oracle: { x: 2, y: 1 },
  drift: { x: 25, y: 29 },
  tumble: { x: 2, y: 29 },
} as const;

export type Maze = {
  readonly tiles: readonly Tile[];
  readonly pelletTotal: number;
};

function parseTile(ch: string): Tile {
  switch (ch) {
    case '#':
      return Tile.Wall;
    case '.':
      return Tile.Pellet;
    case 'o':
      return Tile.Power;
    case '-':
      return Tile.Door;
    case ' ':
      return Tile.Floor;
    default:
      throw new Error(`unknown maze character: ${JSON.stringify(ch)}`);
  }
}

export function createMaze(): Maze {
  const tiles: Tile[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    const row = LAYOUT[y];
    if (row === undefined || row.length !== COLS) {
      throw new Error(`maze row ${y} is ${row?.length ?? 0} wide, expected ${COLS}`);
    }
    for (let x = 0; x < COLS; x += 1) {
      tiles.push(parseTile(row[x] as string));
    }
  }

  // The player starts on a tile, and standing on a pellet at frame zero would
  // score before anyone pressed anything.
  tiles[index(SPAWN.player.x, SPAWN.player.y)] = Tile.Floor;

  const pelletTotal = tiles.filter((t) => t === Tile.Pellet || t === Tile.Power).length;
  return { tiles, pelletTotal };
}

export function index(x: number, y: number): number {
  return y * COLS + x;
}

/** Wraps x across the tunnel; y is clamped since there is no vertical wrap. */
export function wrap(p: Point): Point {
  let { x } = p;
  if (x < 0) x += COLS;
  else if (x >= COLS) x -= COLS;
  return { x, y: p.y };
}

export function tileAt(maze: Maze, x: number, y: number): Tile {
  if (y < 0 || y >= ROWS) return Tile.Wall;
  const wrapped = wrap({ x, y });
  return maze.tiles[index(wrapped.x, wrapped.y)] ?? Tile.Wall;
}

/**
 * `passDoor` is the difference between a ghost leaving home and the player
 * walking into it. Only ghosts get `true`.
 */
export function isWalkable(maze: Maze, x: number, y: number, passDoor = false): boolean {
  const tile = tileAt(maze, x, y);
  if (tile === Tile.Wall) return false;
  if (tile === Tile.Door) return passDoor;
  return true;
}

export function isInsideHouse(p: Point): boolean {
  return p.x >= 11 && p.x <= 16 && p.y >= 13 && p.y <= 15;
}

// --- validation -------------------------------------------------------------

export type MazeProblem = string;

/**
 * Structural checks on the layout. Run by the unit tests rather than at
 * runtime — a broken maze should fail CI, not the player's session.
 */
export function validateMaze(maze: Maze): MazeProblem[] {
  const problems: MazeProblem[] = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const left = maze.tiles[index(x, y)];
      const right = maze.tiles[index(COLS - 1 - x, y)];
      if (left !== right) {
        problems.push(`row ${y} is not symmetric at column ${x}`);
      }
    }
  }

  const powers = maze.tiles.filter((t) => t === Tile.Power).length;
  if (powers !== 4) problems.push(`expected 4 power pellets, found ${powers}`);

  if (!isWalkable(maze, 0, TUNNEL_ROW) || !isWalkable(maze, COLS - 1, TUNNEL_ROW)) {
    problems.push(`tunnel row ${TUNNEL_ROW} is not open at both edges`);
  }
  for (let y = 0; y < ROWS; y += 1) {
    if (y === TUNNEL_ROW) continue;
    if (isWalkable(maze, 0, y) || isWalkable(maze, COLS - 1, y)) {
      problems.push(`row ${y} is open at an edge but is not the tunnel row`);
    }
  }

  // Every pellet must be reachable from the player's spawn, or the level can
  // never be cleared. Flood fill from spawn and compare counts.
  const seen = new Set<number>();
  const queue: Point[] = [SPAWN.player];
  seen.add(index(SPAWN.player.x, SPAWN.player.y));
  while (queue.length > 0) {
    const p = queue.pop() as Point;
    for (const d of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const nextPoint = wrap({ x: p.x + d.x, y: p.y + d.y });
      if (nextPoint.y < 0 || nextPoint.y >= ROWS) continue;
      if (!isWalkable(maze, nextPoint.x, nextPoint.y)) continue;
      const key = index(nextPoint.x, nextPoint.y);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(nextPoint);
    }
  }

  let unreachable = 0;
  for (let i = 0; i < maze.tiles.length; i += 1) {
    const tile = maze.tiles[i];
    if (tile !== Tile.Pellet && tile !== Tile.Power) continue;
    if (!seen.has(i)) unreachable += 1;
  }
  if (unreachable > 0) {
    problems.push(`${unreachable} pellets are unreachable from the player spawn`);
  }

  return problems;
}

/** Kept so the module's signature is stable if placement ever varies by seed. */
export function pelletsRemaining(tiles: readonly Tile[]): number {
  let n = 0;
  for (const t of tiles) if (t === Tile.Pellet || t === Tile.Power) n += 1;
  return n;
}

export type { Rng };
