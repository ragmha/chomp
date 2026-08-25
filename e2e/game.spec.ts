import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for the shell.
 *
 * Tests tagged `@a11y` are the executable half of the a11y-arcade skill; the
 * skill's own Verify section runs exactly this grep. They are deliberately
 * assertions about behaviour a screen-reader or keyboard-only player depends
 * on, not about markup that happens to be present.
 *
 * Nothing here reaches into the game through a debug hook. The player's
 * position is recovered by reading the canvas back, which keeps the production
 * bundle free of a test-only API surface.
 */

/** The player's fill colour from src/render/sprites.ts. */
const PLAYER_RGB = [255, 210, 63] as const;

type Centroid = { readonly x: number; readonly y: number; readonly pixels: number };

/** Finds the player by looking for its exact fill colour on the board. */
async function playerCentroid(page: Page): Promise<Centroid | null> {
  return page.evaluate((rgb) => {
    const canvas = document.getElementById('board');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;

    const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sumX = 0;
    let sumY = 0;
    let pixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== rgb[0] || data[i + 1] !== rgb[1] || data[i + 2] !== rgb[2]) continue;
      const pixel = i / 4;
      sumX += pixel % width;
      sumY += Math.floor(pixel / width);
      pixels += 1;
    }
    return pixels === 0 ? null : { x: sumX / pixels, y: sumY / pixels, pixels };
  }, PLAYER_RGB);
}

async function locatePlayer(page: Page): Promise<Centroid> {
  const found = await playerCentroid(page);
  expect(found, 'the player should be visible on the board').not.toBeNull();
  if (found === null) throw new Error('unreachable');
  return found;
}

/** Starts a session and waits out the READY countdown. */
async function startPlaying(page: Page): Promise<void> {
  await page.getByRole('button', { name: /start game|play again/i }).click();
  await expect(page.locator('#overlay')).toBeHidden();
  // 60 ticks of READY, plus a little slack for a cold first frame.
  await page.waitForTimeout(1300);
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#board')).toBeVisible();
});

test.describe('shell', () => {
  test('@a11y the canvas is exposed as a labelled image', async ({ page }) => {
    const board = page.locator('#board');
    await expect(board).toHaveAttribute('role', 'img');

    const label = await board.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label ?? '').toMatch(/CHOMP maze/i);

    // a11y-arcade rule 5: the label tracks the game, it isn't a fixed string.
    await startPlaying(page);
    await page.waitForTimeout(600);
    await expect(board).toHaveAttribute('aria-label', /Score \d+/);
  });

  test('@a11y the live region exists and stays plain text', async ({ page }) => {
    const region = page.locator('#announcer');
    await expect(region).toHaveAttribute('aria-live', 'polite');

    await startPlaying(page);
    await page.waitForTimeout(1200);

    // secure-web-app rule 1: announcements are written with textContent, so
    // the region only ever holds a text node — never an element.
    const childElements = await region.evaluate((node) => node.childElementCount);
    expect(childElements).toBe(0);
  });

  test('starting the game scores points', async ({ page }) => {
    await expect(page.locator('#score')).toHaveText('0');
    await startPlaying(page);
    await hold(page, 'ArrowLeft', 900);

    await expect
      .poll(async () => Number(await page.locator('#score').textContent()), {
        message: 'eating pellets should raise the score',
        timeout: 5000,
      })
      .toBeGreaterThan(0);
  });

  test('the high score persists across a reload', async ({ page }) => {
    await startPlaying(page);
    await hold(page, 'ArrowLeft', 1200);

    const scored = Number(await page.locator('#score').textContent());
    expect(scored).toBeGreaterThan(0);

    // secure-web-app rule 6: the only things in storage are the high score and
    // the key bindings.
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys.every((key) => key === 'chomp.best' || key === 'chomp.bindings')).toBe(true);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.reload();
    await expect
      .poll(async () => Number(await page.locator('#best').textContent()))
      .toBeGreaterThan(0);
  });
});

test.describe('input', () => {
  test('@a11y arrow keys move the player', async ({ page }) => {
    await startPlaying(page);

    const before = await locatePlayer(page);
    await hold(page, 'ArrowRight', 700);
    const after = await locatePlayer(page);

    expect(after.x, 'ArrowRight should move the player right').toBeGreaterThan(before.x + 4);
  });

  test('@a11y WASD moves the player too, with no settings trip', async ({ page }) => {
    // a11y-arcade rule 2: arrows and WASD are both live from the first frame.
    await startPlaying(page);

    const before = await locatePlayer(page);
    await hold(page, 'KeyD', 700);
    const afterRight = await locatePlayer(page);
    expect(afterRight.x, 'D should move the player right').toBeGreaterThan(before.x + 4);

    await hold(page, 'KeyA', 700);
    const afterLeft = await locatePlayer(page);
    expect(afterLeft.x, 'A should move the player left').toBeLessThan(afterRight.x - 4);
  });
});

test.describe('pause', () => {
  test('@a11y Escape pauses and traps focus in the dialog', async ({ page }) => {
    await startPlaying(page);

    const dialog = page.locator('#pause');
    await expect(dialog).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#resume')).toBeFocused();

    // a11y-arcade rule 6: Tab cycles inside the dialog and cannot leave it.
    await page.keyboard.press('Tab');
    await expect(page.locator('#restart')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#resume')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#restart')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('@a11y P pauses as well', async ({ page }) => {
    await startPlaying(page);
    await page.keyboard.press('KeyP');
    await expect(page.locator('#pause')).toBeVisible();

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.locator('#pause')).toBeHidden();
  });

  test('a paused game does not advance', async ({ page }) => {
    await startPlaying(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause')).toBeVisible();

    const frozen = await page.locator('#score').textContent();
    await page.waitForTimeout(900);
    await expect(page.locator('#score')).toHaveText(frozen ?? '0');
  });
});

test.describe('reduced motion', () => {
  test('@a11y the game stays playable with motion reduced', async ({ page }) => {
    // a11y-arcade rule 3: reduce motion, never remove function.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    await startPlaying(page);
    await hold(page, 'ArrowLeft', 900);

    await expect
      .poll(async () => Number(await page.locator('#score').textContent()), { timeout: 5000 })
      .toBeGreaterThan(0);

    const player = await locatePlayer(page);
    expect(player.pixels).toBeGreaterThan(0);
  });
});

test.describe('axe', () => {
  test('@a11y the shell has no axe-core violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('@a11y the paused game has no axe-core violations', async ({ page }) => {
    await startPlaying(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

test.describe('appearance', () => {
  test('the opening board matches its baseline', async ({ page }) => {
    // Reduced motion pins the power-pellet pulse, and the game has not been
    // started, so no tick has run: this frame is byte-stable rather than
    // merely usually-stable. Flaky screenshots get retried away and stop
    // meaning anything, so the determinism is the point.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    // Setting the `hidden` attribute uses the stylesheet's own [hidden] rule.
    // No inline style is involved, which the CSP would drop anyway.
    await page.evaluate(() => document.getElementById('overlay')?.setAttribute('hidden', ''));
    await expect(page.locator('#overlay')).toBeHidden();
    await page.waitForTimeout(300);

    await expect(page.locator('#board')).toHaveScreenshot('board-initial.png');
  });
});
