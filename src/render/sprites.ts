import type { Dir } from '../engine/state.ts';
import type { Ghost, GhostName } from '../engine/state.ts';

/**
 * Sprites and palette.
 *
 * a11y-arcade rule 1 is the constraint that shapes this whole file: meaning
 * must never live in hue alone. So each ghost gets a *silhouette* as well as a
 * colour, and the four silhouettes are chosen to survive being flattened to
 * grey — pointed, round, blocky, lopsided. Print the board in black and white
 * and you can still tell Hunter from Oracle.
 *
 * The colours are then chosen a second time, for luminance separation rather
 * than for looks, so that a deuteranope or protanope reading only lightness
 * still gets four distinct values. `greyscale.test.ts` asserts the pairwise
 * gaps and will fail if someone "just tweaks the pink".
 *
 * Everything is drawn with Canvas 2D primitives. No image assets and no web
 * fonts, because secure-web-app rule 3 says every byte served is a byte in
 * this repository.
 */

/** One tile, in canvas pixels. 28×16 = 448, 31×16 = 496. */
export const TILE = 16;

export const PALETTE = {
  /** Page and board background. */
  background: '#05061a',
  /** Panel behind the HUD. */
  panel: '#0b0e2a',

  /** Maze wall outline, and the darker glow laid under it. */
  wall: '#3b4de0',
  wallGlow: '#1b2170',
  /** The ghost-house door. */
  door: '#ff9ecb',

  pellet: '#f2e8d5',
  power: '#ffc857',

  player: '#ffd23f',
  playerEye: '#05061a',

  /** a11y-arcade rule 1 & 7: separated by luminance, not just by hue. */
  ghosts: {
    hunter: '#e01b3c',
    tumble: '#e07c12',
    drift: '#3fd0d6',
    oracle: '#ffd6ec',
  } as const satisfies Record<GhostName, string>,

  frightened: '#8fa6ff',
  frightenedFlash: '#f4f6ff',
  /** Face and mouth drawn on the frightened body; dark, for contrast. */
  frightenedTrim: '#12184a',

  eye: '#f7f9ff',
  pupil: '#12184a',

  hudText: '#f2f5ff',
  hudLabel: '#9fb0d8',
  accent: '#ffd23f',
  danger: '#ff6b81',
} as const;

export type GhostPalette = typeof PALETTE.ghosts;

/** Facing angle in radians, screen coordinates (y grows downward). */
export function dirAngle(dir: Dir): number {
  switch (dir) {
    case 'right':
      return 0;
    case 'down':
      return Math.PI / 2;
    case 'left':
      return Math.PI;
    case 'up':
      return -Math.PI / 2;
  }
}

function dirVector(dir: Dir): { x: number; y: number } {
  switch (dir) {
    case 'right':
      return { x: 1, y: 0 };
    case 'left':
      return { x: -1, y: 0 };
    case 'up':
      return { x: 0, y: -1 };
    case 'down':
      return { x: 0, y: 1 };
  }
}

// --- the player -------------------------------------------------------------

export type PlayerSprite = {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly dir: Dir;
  /** 0 = closed, 1 = fully open. */
  readonly openness: number;
};

/**
 * A wedge that opens and closes as it travels, rotated to face `dir`. The
 * mouth cycle is a shape change rather than a luminance change, and its
 * period is well under the 3Hz ceiling of a11y-arcade rule 8 either way.
 */
export function drawPlayer(ctx: CanvasRenderingContext2D, sprite: PlayerSprite): void {
  const { cx, cy, radius, dir, openness } = sprite;
  const half = 0.02 * Math.PI + openness * 0.33 * Math.PI;
  const facing = dirAngle(dir);

  ctx.save();
  ctx.fillStyle = PALETTE.player;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, facing + half, facing - half + Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // A single eye, set back from the mouth, so the facing is legible even when
  // the wedge is nearly closed.
  const v = dirVector(dir);
  const eyeX = cx - v.x * radius * 0.18 - v.y * radius * 0.42;
  const eyeY = cy - v.y * radius * 0.18 - v.x * radius * 0.42;
  ctx.fillStyle = PALETTE.playerEye;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, Math.max(1, radius * 0.16), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The death animation: the wedge opens all the way out until nothing is left.
 * `progress` runs 0 → 1 over the game-feel rule 5 freeze.
 */
export function drawPlayerDying(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  progress: number,
): void {
  const t = Math.min(1, Math.max(0, progress));
  const half = 0.05 * Math.PI + t * 0.95 * Math.PI;
  if (half >= Math.PI) return;

  ctx.save();
  ctx.fillStyle = PALETTE.player;
  ctx.globalAlpha = 1 - t * 0.35;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, -Math.PI / 2 + half, -Math.PI / 2 - half + Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- ghosts -----------------------------------------------------------------

export type GhostSprite = {
  readonly cx: number;
  readonly cy: number;
  /** Half-width of the body. */
  readonly radius: number;
  readonly name: GhostName;
  readonly mode: Ghost['mode'];
  readonly dir: Dir;
  /** Ticks of fright left; drives the warning flash. */
  readonly frightenedTicks: number;
  readonly reducedMotion: boolean;
  /** Frame counter, used only for the skirt sway and the fright flash. */
  readonly tick: number;
};

/**
 * Four silhouettes, chosen to stay apart in greyscale:
 *
 * | ghost  | dome              | skirt              |
 * |--------|-------------------|--------------------|
 * | hunter | single sharp peak | 3 triangular teeth |
 * | oracle | smooth half-round | 4 soft waves       |
 * | drift  | flat with antenna | 4 square teeth     |
 * | tumble | lopsided, 1 horn  | 2 broad scallops   |
 */
function bodyPath(
  ctx: CanvasRenderingContext2D,
  name: GhostName,
  cx: number,
  cy: number,
  r: number,
  sway: number,
): void {
  const left = cx - r;
  const right = cx + r;
  const waist = cy + r * 0.5;
  const foot = cy + r * 1.02;

  ctx.beginPath();
  ctx.moveTo(left, waist);

  switch (name) {
    case 'hunter': {
      ctx.lineTo(left, cy + r * 0.05);
      ctx.quadraticCurveTo(left + r * 0.06, cy - r * 0.62, cx, cy - r * 1.24);
      ctx.quadraticCurveTo(right - r * 0.06, cy - r * 0.62, right, cy + r * 0.05);
      ctx.lineTo(right, waist);
      zigzagSkirt(ctx, left, right, waist, foot, 3, sway);
      break;
    }
    case 'oracle': {
      ctx.lineTo(left, cy - r * 0.05);
      ctx.arc(cx, cy - r * 0.05, r, Math.PI, 0);
      ctx.lineTo(right, waist);
      waveSkirt(ctx, left, right, waist, foot, 4, sway);
      break;
    }
    case 'drift': {
      ctx.lineTo(left, cy - r * 0.5);
      ctx.lineTo(left + r * 0.3, cy - r * 0.92);
      ctx.lineTo(cx - r * 0.14, cy - r * 0.92);
      ctx.lineTo(cx - r * 0.14, cy - r * 1.34);
      ctx.lineTo(cx + r * 0.14, cy - r * 1.34);
      ctx.lineTo(cx + r * 0.14, cy - r * 0.92);
      ctx.lineTo(right - r * 0.3, cy - r * 0.92);
      ctx.lineTo(right, cy - r * 0.5);
      ctx.lineTo(right, waist);
      squareSkirt(ctx, left, right, waist, foot, 4, sway);
      break;
    }
    case 'tumble': {
      ctx.lineTo(left, cy - r * 0.16);
      ctx.lineTo(cx - r * 0.92, cy - r * 1.3);
      ctx.lineTo(cx - r * 0.3, cy - r * 0.82);
      ctx.quadraticCurveTo(cx + r * 0.34, cy - r * 1.16, right, cy - r * 0.18);
      ctx.lineTo(right, waist);
      scallopSkirt(ctx, left, right, waist, foot, 2, sway);
      break;
    }
  }

  ctx.closePath();
}

/** Sharp triangular teeth. Path runs right → left along the hem. */
function zigzagSkirt(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  waist: number,
  foot: number,
  teeth: number,
  sway: number,
): void {
  const steps = teeth * 2;
  const width = (right - left) / steps;
  for (let k = 1; k <= steps; k += 1) {
    const x = right - k * width;
    const down = k % 2 === 1;
    ctx.lineTo(x, down ? foot + sway : waist - sway * 0.4);
  }
}

/** Soft semicircular waves. */
function waveSkirt(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  waist: number,
  foot: number,
  waves: number,
  sway: number,
): void {
  const width = (right - left) / waves;
  const depth = foot - waist + sway;
  for (let k = 0; k < waves; k += 1) {
    const centre = right - k * width - width / 2;
    // Control point at twice the depth, because a quadratic only reaches half
    // way to it — at 15px a shallow wave just reads as a flat hem.
    ctx.quadraticCurveTo(centre, waist + depth * 2.4, centre - width / 2, waist);
  }
}

/** Castellated square teeth — reads as machinery, not cloth. */
function squareSkirt(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  waist: number,
  foot: number,
  teeth: number,
  sway: number,
): void {
  const width = (right - left) / teeth;
  const bottom = foot + sway * 0.5;
  for (let k = 0; k < teeth; k += 1) {
    const x0 = right - k * width;
    const x1 = x0 - width;
    if (k % 2 === 0) {
      ctx.lineTo(x0, bottom);
      ctx.lineTo(x1, bottom);
      ctx.lineTo(x1, waist);
    } else {
      ctx.lineTo(x0, waist);
      ctx.lineTo(x1, waist);
    }
  }
}

/** Two broad round lobes. */
function scallopSkirt(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  waist: number,
  foot: number,
  lobes: number,
  sway: number,
): void {
  const width = (right - left) / lobes;
  const depth = foot - waist + sway;
  for (let k = 0; k < lobes; k += 1) {
    const x0 = right - k * width;
    const x1 = x0 - width;
    ctx.bezierCurveTo(x0, waist + depth * 2.1, x1, waist + depth * 2.1, x1, waist);
  }
}

/** The frightened body is a different shape as well as a different colour. */
function frightenedPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sway: number,
): void {
  const left = cx - r;
  const right = cx + r;
  const waist = cy + r * 0.42;
  const foot = cy + r * 0.98;

  ctx.beginPath();
  ctx.moveTo(left, waist);
  ctx.lineTo(left, cy - r * 0.4);
  ctx.quadraticCurveTo(left, cy - r * 0.95, cx - r * 0.45, cy - r * 0.95);
  ctx.lineTo(cx + r * 0.45, cy - r * 0.95);
  ctx.quadraticCurveTo(right, cy - r * 0.95, right, cy - r * 0.4);
  ctx.lineTo(right, waist);
  zigzagSkirt(ctx, left, right, waist, foot, 5, sway);
  ctx.closePath();
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  name: GhostName,
  cx: number,
  cy: number,
  r: number,
  dir: Dir,
): void {
  const v = dirVector(dir);
  const gaze = r * 0.22;
  const eyeY = cy - r * 0.24;

  const draw = (
    ex: number,
    ey: number,
    rx: number,
    ry: number,
    angular: boolean,
    slant = 1,
  ): void => {
    ctx.fillStyle = PALETTE.eye;
    ctx.beginPath();
    if (angular) {
      // Slanted trapezoid, mirrored between the two eyes, so the pair reads as
      // a scowl at 16px rather than as two dots.
      ctx.moveTo(ex - rx * slant, ey + ry * 0.15);
      ctx.lineTo(ex + rx * slant, ey - ry);
      ctx.lineTo(ex + rx * slant, ey + ry);
      ctx.lineTo(ex - rx * slant, ey + ry);
      ctx.closePath();
    } else {
      ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.fillStyle = PALETTE.pupil;
    ctx.beginPath();
    ctx.arc(ex + v.x * gaze * 0.5, ey + v.y * gaze * 0.5, Math.max(1, rx * 0.55), 0, Math.PI * 2);
    ctx.fill();
  };

  switch (name) {
    case 'hunter':
      draw(cx - r * 0.38, eyeY, r * 0.34, r * 0.34, true, 1);
      draw(cx + r * 0.38, eyeY, r * 0.34, r * 0.34, true, -1);
      break;
    case 'oracle':
      draw(cx - r * 0.36, eyeY, r * 0.36, r * 0.4, false);
      draw(cx + r * 0.36, eyeY, r * 0.36, r * 0.4, false);
      break;
    case 'drift':
      // Narrow slits.
      draw(cx - r * 0.38, eyeY, r * 0.34, r * 0.17, false);
      draw(cx + r * 0.38, eyeY, r * 0.34, r * 0.17, false);
      break;
    case 'tumble':
      // Deliberately asymmetric: one wide eye, one small.
      draw(cx - r * 0.4, eyeY - r * 0.08, r * 0.42, r * 0.42, false);
      draw(cx + r * 0.46, eyeY + r * 0.1, r * 0.22, r * 0.22, false);
      break;
  }
}

/** Eyes only. An eaten ghost has no body at all, which is unmistakable. */
function drawEatenEyes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  dir: Dir,
): void {
  const v = dirVector(dir);
  for (const side of [-1, 1]) {
    const ex = cx + side * r * 0.36;
    ctx.fillStyle = PALETTE.eye;
    ctx.beginPath();
    ctx.ellipse(ex, cy - r * 0.1, r * 0.32, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.pupil;
    ctx.beginPath();
    ctx.arc(ex + v.x * r * 0.14, cy - r * 0.1 + v.y * r * 0.16, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
  }
}

function frightenedFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  for (const side of [-1, 1]) {
    ctx.fillRect(cx + side * r * 0.4 - r * 0.16, cy - r * 0.42, r * 0.32, r * 0.32);
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const y = cy + r * 0.24;
  const w = r * 0.28;
  ctx.moveTo(cx - r * 0.56, y);
  for (let k = 0; k < 4; k += 1) {
    ctx.lineTo(cx - r * 0.56 + w * (k + 0.5), y + (k % 2 === 0 ? -r * 0.2 : r * 0.2));
  }
  ctx.lineTo(cx + r * 0.56, y);
  ctx.stroke();
}

export function drawGhost(ctx: CanvasRenderingContext2D, sprite: GhostSprite): void {
  const { cx, cy, radius: r, name, mode, dir, reducedMotion, tick } = sprite;

  if (mode === 'eaten') {
    drawEatenEyes(ctx, cx, cy, r, dir);
    return;
  }

  // The hem sways as the ghost walks. It is a couple of pixels of motion, but
  // it is motion, so a11y-arcade rule 3 switches it off on request.
  const sway = reducedMotion ? 0 : Math.sin(tick * 0.32) * r * 0.16;

  ctx.save();

  if (mode === 'frightened') {
    // rule 8: the "about to wear off" warning alternates at 2Hz, never above
    // 3Hz, and holds a single colour under reduced motion.
    const expiring = sprite.frightenedTicks > 0 && sprite.frightenedTicks < 120;
    const flashing = expiring && !reducedMotion && Math.floor(tick / 15) % 2 === 1;
    const body = flashing ? PALETTE.frightenedFlash : PALETTE.frightened;

    frightenedPath(ctx, cx, cy, r, sway);
    ctx.fillStyle = body;
    ctx.fill();

    // Under reduced motion the expiry is signalled by a static ring instead of
    // a flash, so the information survives without the flicker.
    if (expiring && reducedMotion) {
      ctx.strokeStyle = PALETTE.accent;
      ctx.lineWidth = Math.max(1, r * 0.22);
      ctx.stroke();
    }
    frightenedFace(ctx, cx, cy, r, PALETTE.frightenedTrim);
    ctx.restore();
    return;
  }

  bodyPath(ctx, name, cx, cy, r, sway);
  ctx.fillStyle = PALETTE.ghosts[name];
  ctx.fill();

  // A dark rim keeps neighbouring ghosts apart when they overlap in a
  // corridor, and gives the silhouette a hard edge in greyscale.
  ctx.strokeStyle = PALETTE.background;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (name === 'drift') {
    // The antenna bead — part of Drift's silhouette, not decoration.
    ctx.fillStyle = PALETTE.ghosts.drift;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 1.44, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEyes(ctx, name, cx, cy, r, dir);
  ctx.restore();
}

// --- HUD glyphs -------------------------------------------------------------

/** The little wedge used for the remaining-lives row. */
export function drawLifeIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  drawPlayer(ctx, { cx, cy, radius, dir: 'right', openness: 0.7 });
}
