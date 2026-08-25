import { createGame, step } from './engine/state.ts';
import type { GameEvent, GameState, Intent } from './engine/state.ts';
import { drawFrame } from './render/canvas.ts';
import { createHud } from './render/hud.ts';
import { createKeyboard } from './input/keyboard.ts';
import { createTouch } from './input/touch.ts';
import { createAnnouncer } from './a11y/announcer.ts';

/**
 * The shell: an accumulator, an animation frame, and the wiring between the
 * pure engine and the browser.
 *
 * game-feel rule 3 is the load-bearing rule in this file. Real elapsed time is
 * accumulated and *whole ticks* are run; movement is never scaled by frame
 * delta. A variable step would make two replays of the same tape diverge,
 * which would cost the eval suite the deterministic oracle it is built on —
 * so this is a correctness constraint, not a smoothness preference. Rendering
 * interpolates between the last two states to get the smoothness back.
 *
 * This is also the only file in the project that is allowed to know what a
 * millisecond is. Everything below it counts in ticks.
 */

const TICKS_PER_SECOND = 60;
const TICK_MS = 1000 / TICKS_PER_SECOND;

/**
 * A backgrounded tab hands back a delta measured in minutes. Without a clamp
 * the loop would try to catch up on every missed tick at once and lock the
 * page — the classic spiral of death.
 */
const MAX_TICKS_PER_FRAME = 5;

/** secure-web-app rule 6: high score and key bindings. Nothing else, ever. */
const BEST_STORAGE_KEY = 'chomp.best';

function element<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof ctor)) throw new Error(`missing element #${id}`);
  return found;
}

function readBest(): number {
  try {
    const raw = localStorage.getItem(BEST_STORAGE_KEY);
    if (raw === null) return 0;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeBest(value: number): void {
  try {
    localStorage.setItem(BEST_STORAGE_KEY, String(value));
  } catch {
    /* Storage can be disabled. The game does not depend on it. */
  }
}

function start(): void {
  const canvas = element('board', HTMLCanvasElement);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas 2d context unavailable');
  const ctx = context;

  const overlay = element('overlay', HTMLElement);
  const overlayTitle = element('overlay-title', HTMLElement);
  const overlayBody = element('overlay-body', HTMLElement);
  const startButton = element('start', HTMLButtonElement);
  const dialog = element('pause', HTMLElement);
  const resumeButton = element('resume', HTMLButtonElement);
  const restartButton = element('restart', HTMLButtonElement);
  const region = element('announcer', HTMLElement);

  const updateHud = createHud();
  const announcer = createAnnouncer(region, canvas);

  // a11y-arcade rule 3. Watched rather than sampled once, so toggling the OS
  // setting mid-session takes effect without a reload.
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;
  motionQuery.addEventListener('change', (event) => {
    reducedMotion = event.matches;
  });

  let state: GameState = createGame();
  let previous: GameState = state;
  let best = readBest();
  let running = false;
  let paused = false;
  let accumulator = 0;
  let last = performance.now();

  announcer.refresh(state);
  updateHud(state, best);

  const touch = createTouch(canvas);
  const keyboard = createKeyboard({
    onPause: () => {
      if (!running) return;
      setPaused(!paused);
    },
  });

  const intentNow = (): Intent => {
    // A held key beats a stale swipe; the touch layer only reports in the poll
    // right after a gesture, so the two never argue.
    const fromKeys = keyboard.intent();
    return fromKeys === 'none' ? touch.intent() : fromKeys;
  };

  // --- pause, and the focus trap around it ---------------------------------

  let restoreFocusTo: HTMLElement | null = null;

  function setPaused(next: boolean): void {
    if (paused === next) return;
    paused = next;

    if (paused) {
      restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.hidden = false;
      resumeButton.focus();
      keyboard.release();
      announcer.say('Game paused.', performance.now());
    } else {
      dialog.hidden = true;
      accumulator = 0;
      last = performance.now();
      keyboard.release();
      (restoreFocusTo ?? canvas).focus();
      restoreFocusTo = null;
      announcer.say('Game resumed.', performance.now());
    }
  }

  // a11y-arcade rule 6: focus is trapped in the dialog until it is dismissed.
  const trapped = (): HTMLElement[] => [resumeButton, restartButton];

  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const order = trapped();
    const first = order[0];
    const lastFocusable = order[order.length - 1];
    if (first === undefined || lastFocusable === undefined) return;

    event.preventDefault();
    const active = document.activeElement;
    const at = order.findIndex((node) => node === active);
    const delta = event.shiftKey ? -1 : 1;
    const nextIndex = (at + delta + order.length) % order.length;
    order[nextIndex]?.focus();
  });

  // Belt and braces: if focus escapes by any route the browser offers, pull it
  // straight back while the dialog is open.
  document.addEventListener('focusin', (event) => {
    if (!paused) return;
    if (event.target instanceof Node && dialog.contains(event.target)) return;
    resumeButton.focus();
  });

  // --- session control ------------------------------------------------------

  function beginSession(): void {
    state = createGame();
    previous = state;
    accumulator = 0;
    last = performance.now();
    running = true;
    paused = false;
    dialog.hidden = true;
    overlay.hidden = true;
    keyboard.release();
    announcer.refresh(state);
    updateHud(state, best);
    canvas.focus();
  }

  function endSession(): void {
    running = false;
    paused = false;
    dialog.hidden = true;
    best = Math.max(best, state.score);
    writeBest(best);
    overlayTitle.textContent = 'Game over';
    overlayBody.textContent = `You scored ${state.score}. Best is ${best}.`;
    startButton.textContent = 'Play again';
    overlay.hidden = false;
    startButton.focus();
    updateHud(state, best);
  }

  startButton.addEventListener('click', beginSession);
  resumeButton.addEventListener('click', () => setPaused(false));
  restartButton.addEventListener('click', beginSession);

  // a11y-arcade rule 6 again, from the other direction: a game that keeps
  // running in a hidden tab is a game that kills you while you read your email.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) setPaused(true);
  });

  // The running `best` is only in memory; a session abandoned mid-game would
  // otherwise lose the score it earned.
  window.addEventListener('pagehide', () => {
    writeBest(Math.max(best, state.score));
  });

  // --- the loop -------------------------------------------------------------

  function frame(now: number): void {
    requestAnimationFrame(frame);

    const elapsed = Math.min(now - last, TICK_MS * MAX_TICKS_PER_FRAME);
    last = now;

    const events: GameEvent[] = [];

    if (running && !paused) {
      accumulator += elapsed;
      let ticks = 0;
      while (accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
        previous = state;
        state = step(state, intentNow());
        accumulator -= TICK_MS;
        ticks += 1;
        for (const event of state.events) events.push(event);
      }
      // Whatever is left after the cap is time we can never make up; keeping
      // it would only make the next frame worse.
      if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;

      if (state.score > best) best = state.score;
    } else {
      accumulator = 0;
    }

    announcer.update(state, events, now);
    updateHud(state, best);

    drawFrame(ctx, state, {
      reducedMotion,
      interpolation: accumulator / TICK_MS,
      previous,
      paused,
    });

    if (running && state.status === 'gameOver') endSession();
  }

  requestAnimationFrame(frame);
}

start();
