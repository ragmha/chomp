import { Tile, index, type Point } from './maze.ts';
import { SUB, tileOf, type Actor, type Ghost } from './state.ts';

/**
 * Collision resolution.
 *
 * Both checks are tile-and-proximity based rather than pixel-perfect. An
 * arcade maze game that demanded exact overlap would feel unfair, because the
 * player cannot see subpixels.
 */

export type EatResult = {
  readonly tiles: readonly Tile[];
  readonly kind: 'pellet' | 'power';
};

/**
 * Removes a pellet at `tile`, returning the new board. Returns null when there
 * was nothing to eat, so the caller can skip copying the array.
 */
export function eatTile(tiles: readonly Tile[], tile: Point): EatResult | null {
  const i = index(tile.x, tile.y);
  const current = tiles[i];
  if (current !== Tile.Pellet && current !== Tile.Power) return null;

  const copy = tiles.slice();
  copy[i] = Tile.Floor;
  return { tiles: copy, kind: current === Tile.Power ? 'power' : 'pellet' };
}

/**
 * How close, in subpixels, the player and a ghost must be to count as touching.
 * Slightly under half a tile: generous enough not to feel arbitrary, tight
 * enough that passing through a junction together doesn't always kill you.
 */
const CONTACT_DISTANCE = 3;

/** Indices of every ghost currently touching the player. */
export function ghostCollisions(player: Actor, ghosts: readonly Ghost[]): number[] {
  const hits: number[] = [];
  const playerTile = tileOf(player);

  for (let i = 0; i < ghosts.length; i += 1) {
    const ghost = ghosts[i];
    if (ghost === undefined) continue;

    const ghostTile = tileOf(ghost);
    if (ghostTile.x !== playerTile.x || ghostTile.y !== playerTile.y) continue;

    // Same tile is necessary but not sufficient — check subpixel proximity so
    // two actors crossing in opposite directions don't always collide.
    const dx = Math.abs(ghost.x - player.x);
    const dy = Math.abs(ghost.y - player.y);
    if (dx <= CONTACT_DISTANCE && dy <= CONTACT_DISTANCE) hits.push(i);
  }

  return hits;
}

/** Straight-line distance in subpixels, for tests and debug overlays. */
export function distance(a: Actor, b: Actor): number {
  const dx = (a.x - b.x) / SUB;
  const dy = (a.y - b.y) / SUB;
  return Math.sqrt(dx * dx + dy * dy);
}
