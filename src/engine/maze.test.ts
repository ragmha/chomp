import { describe, expect, it } from 'vitest';
import {
  COLS,
  ROWS,
  SPAWN,
  Tile,
  TUNNEL_ROW,
  createMaze,
  isInsideHouse,
  isWalkable,
  pelletsRemaining,
  tileAt,
  validateMaze,
  wrap,
} from './maze.ts';

describe('maze', () => {
  const maze = createMaze();

  it('is structurally sound', () => {
    // One assertion covering symmetry, power pellet count, tunnel placement
    // and pellet reachability. Reported as a list so a broken edit tells you
    // everything that is wrong at once rather than one thing per run.
    expect(validateMaze(maze)).toEqual([]);
  });

  it('has the expected dimensions', () => {
    expect(maze.tiles).toHaveLength(COLS * ROWS);
  });

  it('is enclosed except at the tunnel', () => {
    for (let x = 0; x < COLS; x += 1) {
      expect(tileAt(maze, x, 0)).toBe(Tile.Wall);
      expect(tileAt(maze, x, ROWS - 1)).toBe(Tile.Wall);
    }
    expect(isWalkable(maze, 0, TUNNEL_ROW)).toBe(true);
    expect(isWalkable(maze, COLS - 1, TUNNEL_ROW)).toBe(true);
  });

  it('wraps horizontally across the tunnel only', () => {
    expect(wrap({ x: -1, y: TUNNEL_ROW })).toEqual({ x: COLS - 1, y: TUNNEL_ROW });
    expect(wrap({ x: COLS, y: TUNNEL_ROW })).toEqual({ x: 0, y: TUNNEL_ROW });
    expect(wrap({ x: 5, y: 3 })).toEqual({ x: 5, y: 3 });
  });

  it('treats out-of-bounds rows as wall', () => {
    expect(tileAt(maze, 5, -1)).toBe(Tile.Wall);
    expect(tileAt(maze, 5, ROWS)).toBe(Tile.Wall);
  });

  it('lets ghosts through the house door but not the player', () => {
    const door = { x: 13, y: 12 };
    expect(tileAt(maze, door.x, door.y)).toBe(Tile.Door);
    expect(isWalkable(maze, door.x, door.y, false)).toBe(false);
    expect(isWalkable(maze, door.x, door.y, true)).toBe(true);
  });

  it('places the house where the ghosts spawn', () => {
    expect(isInsideHouse(SPAWN.house)).toBe(true);
    expect(isInsideHouse(SPAWN.player)).toBe(false);
  });

  it('does not put a pellet under the player spawn', () => {
    expect(tileAt(maze, SPAWN.player.x, SPAWN.player.y)).toBe(Tile.Floor);
  });

  it('starts the player somewhere they can move', () => {
    expect(isWalkable(maze, SPAWN.player.x, SPAWN.player.y)).toBe(true);
  });

  it('counts pellets consistently', () => {
    expect(pelletsRemaining(maze.tiles)).toBe(maze.pelletTotal);
    // A board with too few pellets is a board that clears in seconds.
    expect(maze.pelletTotal).toBeGreaterThan(180);
  });
});
