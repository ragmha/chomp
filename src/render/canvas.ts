import { COLS, ROWS, Tile, index } from '../engine/maze.ts';
import { SUB } from '../engine/state.ts';
import type { Actor, GameState } from '../engine/state.ts';
import { PALETTE, TILE, drawGhost, drawPlayer, drawPlayerDying } from './sprites.ts';

/**
 * The renderer.
 *
 * Reads `GameState` and never mutates it — the engine is a pure reducer and
 * this file is the only place allowed to know that a subpixel is two canvas
 * pixels wide.
 *
 * Two things here are policy rather than taste:
 *
 * - The power-pellet pulse and the level-clear flash are capped at 2Hz and go
 *   completely static under `prefers-reduced-motion` (a11y-arcade rules 3 and
 *   8, and spec §6 C1 — a *static colour hold of equal duration*, so the
 *   pacing survives even though the flash doesn't).
 * - The maze is rasterised once into an offscreen layer. Re-tracing 400-odd
 *   wall segments every frame would eat most of the 8ms frame budget in
 *   game-feel, and the walls only change when the level does.
 */

export const BOARD_WIDTH = COLS * TILE;
export const BOARD_HEIGHT = ROWS * TILE;

/** Canvas pixels per engine subpixel. */
const SCALE = TILE / SUB;

export type RenderOptions = {
  readonly reducedMotion: boolean;
  /** 0..1 through the current tick, for smooth motion between steps. */
  readonly interpolation: number;
  /** The state one tick ago, if there is one, used only for interpolation. */
  readonly previous?: GameState | undefined;
  readonly paused?: boolean | undefined;
};

// --- the cached maze layer --------------------------------------------------

type MazeLayer = { readonly canvas: HTMLCanvasElement; readonly key: string };
let cachedLayer: MazeLayer | null = null;

/** Walls only — pellets change every tick and are drawn live. */
function layerKey(tiles: readonly Tile[]): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const solid = tiles[i] === Tile.Wall ? 1 : tiles[i] === Tile.Door ? 2 : 0;
    h ^= solid + i;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function isWall(tiles: readonly Tile[], x: number, y: number): boolean {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  return tiles[index(x, y)] === Tile.Wall;
}

/**
 * Walls are drawn as a stroked skeleton rather than as 16×16 blocks: for every
 * wall tile, a line runs from its centre to the centre of each orthogonal wall
 * neighbour. Stroke that path thick and round, then stroke it again thinner in
 * the background colour, and what comes out is a connected, rounded, hollow
 * wall — the arcade look — instead of a grid of squares.
 */
function traceWalls(ctx: CanvasRenderingContext2D, tiles: readonly Tile[]): void {
  ctx.beginPath();
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!isWall(tiles, x, y)) continue;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;

      let joined = false;
      if (isWall(tiles, x + 1, y)) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + TILE, cy);
        joined = true;
      }
      if (isWall(tiles, x, y + 1)) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + TILE);
        joined = true;
      }
      if (!joined && !isWall(tiles, x - 1, y) && !isWall(tiles, x, y - 1)) {
        // A lone block. Give it a stub so the round cap draws something.
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 0.01, cy);
      }
    }
  }
}

/** A blank offscreen canvas the size of the board. */
function scratch(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  return canvas;
}

/** The wall region as a solid white mask: skeleton stroked a full tile wide. */
function solidMask(tiles: readonly Tile[]): HTMLCanvasElement {
  const canvas = scratch();
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = TILE;
  traceWalls(ctx, tiles);
  ctx.stroke();
  return canvas;
}

/**
 * Erodes a mask by `radius`, by intersecting it with copies of itself nudged
 * in eight directions. Subtracting the result from the original leaves an even
 * outline of constant thickness, which is the whole point: stroking the
 * skeleton twice at different widths *looks* like it should work and doesn't —
 * it leaves square islands stranded in the middle of thick wall blocks, where
 * the thinner strokes no longer overlap.
 */
function erode(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const canvas = scratch();
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;

  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  const diagonal = Math.round(radius * 0.7071);
  const offsets: readonly (readonly [number, number])[] = [
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
    [diagonal, diagonal],
    [diagonal, -diagonal],
    [-diagonal, diagonal],
    [-diagonal, -diagonal],
  ];
  for (const [dx, dy] of offsets) ctx.drawImage(mask, dx, dy);
  return canvas;
}

/** Paints a mask in a flat colour. */
function tint(mask: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const canvas = scratch();
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;

  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  return canvas;
}

/** Wall outline thickness, in canvas pixels. */
const WALL_EDGE = 3;

function buildMazeLayer(tiles: readonly Tile[]): HTMLCanvasElement {
  const canvas = scratch();
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;

  const solid = solidMask(tiles);
  const inner = erode(solid, WALL_EDGE);

  // A dim body inside the walls first, so corridors read as corridors rather
  // than as the same black as the surround.
  ctx.globalAlpha = 0.5;
  ctx.drawImage(tint(inner, PALETTE.wallGlow), 0, 0);
  ctx.globalAlpha = 1;

  // Then the bright edge: the solid region minus its own erosion.
  const edge = tint(solid, PALETTE.wall);
  const edgeCtx = edge.getContext('2d');
  if (edgeCtx !== null) {
    edgeCtx.globalCompositeOperation = 'destination-out';
    edgeCtx.drawImage(inner, 0, 0);
  }
  ctx.drawImage(edge, 0, 0);

  // The ghost-house door: a flat bar, deliberately unlike a wall.
  ctx.fillStyle = PALETTE.door;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (tiles[index(x, y)] !== Tile.Door) continue;
      ctx.fillRect(x * TILE, y * TILE + TILE / 2 - 2, TILE, 4);
    }
  }

  return canvas;
}

function mazeLayer(tiles: readonly Tile[]): HTMLCanvasElement {
  const key = layerKey(tiles);
  if (cachedLayer !== null && cachedLayer.key === key) return cachedLayer.canvas;
  const canvas = buildMazeLayer(tiles);
  cachedLayer = { canvas, key };
  return canvas;
}

/** Exposed so a level change or a hot reload can drop the cache. */
export function invalidateMazeLayer(): void {
  cachedLayer = null;
}

// --- pellets ----------------------------------------------------------------

function drawPellets(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  reducedMotion: boolean,
): void {
  // a11y-arcade rule 8: 2Hz, and only when motion is welcome. Under reduced
  // motion the power pellets simply sit at their mid size.
  const phase = reducedMotion ? 0 : Math.sin((state.tick / 60) * Math.PI * 2 * 2);
  const powerRadius = TILE * 0.3 + phase * TILE * 0.07;

  ctx.fillStyle = PALETTE.pellet;
  ctx.beginPath();
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (state.tiles[index(x, y)] !== Tile.Pellet) continue;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      ctx.moveTo(cx + 2, cy);
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  ctx.fillStyle = PALETTE.power;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (state.tiles[index(x, y)] !== Tile.Power) continue;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, powerRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// --- actors -----------------------------------------------------------------

/**
 * Positions land between ticks, so we lerp — but only over short hops. A jump
 * of more than a couple of subpixels means a tunnel wrap or a respawn, and
 * interpolating across those would drag the sprite over the whole board.
 */
function lerpActor<T extends Actor>(current: T, previous: Actor | undefined, alpha: number): T {
  if (previous === undefined) return current;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) return current;
  return { ...current, x: previous.x + dx * alpha, y: previous.y + dy * alpha };
}

function toCanvasX(subpixel: number): number {
  return subpixel * SCALE;
}

function drawActors(ctx: CanvasRenderingContext2D, state: GameState, options: RenderOptions): void {
  const alpha = state.status === 'playing' ? Math.min(1, Math.max(0, options.interpolation)) : 0;
  const previous = options.previous;

  for (let i = 0; i < state.ghosts.length; i += 1) {
    const ghost = state.ghosts[i];
    if (ghost === undefined) continue;
    const before = previous?.ghosts[i];
    const drawn = lerpActor(ghost, before, alpha);
    drawGhost(ctx, {
      cx: toCanvasX(drawn.x),
      cy: toCanvasX(drawn.y),
      radius: TILE * 0.46,
      name: ghost.name,
      mode: ghost.mode,
      dir: ghost.dir,
      frightenedTicks: ghost.frightenedTicks,
      reducedMotion: options.reducedMotion,
      tick: state.tick,
    });
  }

  const player = lerpActor(state.player, previous?.player, alpha);
  const px = toCanvasX(player.x);
  const py = toCanvasX(player.y);

  if (state.status === 'dying') {
    // statusTicks counts down through the game-feel rule 5 freeze.
    const progress = 1 - state.statusTicks / 30;
    drawPlayerDying(ctx, px, py, TILE * 0.44, progress);
    return;
  }

  // A ~2.5Hz chomp. Static when the player is stopped or motion is reduced, so
  // nothing animates that doesn't need to.
  const moving = state.status === 'playing';
  const openness =
    options.reducedMotion || !moving ? 0.55 : Math.abs(Math.sin(state.tick * 0.26));
  drawPlayer(ctx, { cx: px, cy: py, radius: TILE * 0.44, dir: player.dir, openness });
}

// --- overlays ---------------------------------------------------------------

function centreText(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size: number,
  colour: string,
): void {
  ctx.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(text, BOARD_WIDTH / 2, y);
}

function banner(ctx: CanvasRenderingContext2D, y: number, height: number): void {
  ctx.fillStyle = 'rgba(5, 6, 26, 0.82)';
  ctx.fillRect(0, y - height / 2, BOARD_WIDTH, height);
}

function drawOverlay(ctx: CanvasRenderingContext2D, state: GameState, options: RenderOptions): void {
  const mid = BOARD_HEIGHT / 2 + TILE * 2;

  switch (state.status) {
    case 'ready': {
      banner(ctx, mid, 44);
      centreText(ctx, 'READY', mid, 22, PALETTE.accent);
      break;
    }
    case 'dying': {
      banner(ctx, mid, 44);
      centreText(ctx, 'OUCH', mid, 22, PALETTE.danger);
      break;
    }
    case 'levelClear': {
      // spec §6 C1: under reduced motion the flash becomes a static hold of the
      // same duration, so the beat is preserved without the flicker.
      const on = options.reducedMotion ? true : Math.floor(state.tick / 15) % 2 === 0;
      if (on) {
        ctx.fillStyle = options.reducedMotion ? 'rgba(59, 77, 224, 0.28)' : 'rgba(59, 77, 224, 0.4)';
        ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      }
      banner(ctx, mid, 44);
      centreText(ctx, `LEVEL ${state.level} CLEAR`, mid, 20, PALETTE.accent);
      break;
    }
    case 'gameOver': {
      ctx.fillStyle = 'rgba(5, 6, 26, 0.74)';
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      centreText(ctx, 'GAME OVER', mid - 18, 30, PALETTE.danger);
      centreText(ctx, `SCORE ${state.score}`, mid + 18, 18, PALETTE.hudText);
      break;
    }
    case 'playing':
      break;
  }

  if (options.paused === true) {
    ctx.fillStyle = 'rgba(5, 6, 26, 0.74)';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    centreText(ctx, 'PAUSED', BOARD_HEIGHT / 2, 30, PALETTE.accent);
  }
}

// --- entry point ------------------------------------------------------------

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  options: RenderOptions,
): void {
  ctx.save();
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  ctx.drawImage(mazeLayer(state.tiles), 0, 0);
  drawPellets(ctx, state, options.reducedMotion);
  drawActors(ctx, state, options);
  drawOverlay(ctx, state, options);
  ctx.restore();
}
