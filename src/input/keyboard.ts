import type { Intent } from '../engine/state.ts';

/**
 * Keyboard input.
 *
 * a11y-arcade rule 2: every key is remappable, and this is the only file in
 * `src/` allowed to name a physical key. Everything downstream sees an
 * `Intent`. The defaults bind arrows *and* WASD at the same time rather than
 * offering them as alternatives, because a one-handed player should not have
 * to find a settings screen before they can play.
 *
 * Keys are matched on `KeyboardEvent.code` (physical position) rather than
 * `.key`, so WASD stays where the fingers are on an AZERTY or Dvorak layout.
 */

export type Action = 'up' | 'down' | 'left' | 'right' | 'pause';

export const ACTIONS: readonly Action[] = ['up', 'down', 'left', 'right', 'pause'];

export type Bindings = Readonly<Record<Action, readonly string[]>>;

/** secure-web-app rule 6: storage holds bindings and high scores, nothing else. */
export const BINDINGS_STORAGE_KEY = 'chomp.bindings';

export const DEFAULT_BINDINGS: Bindings = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  // a11y-arcade rule 6: both, always.
  pause: ['Escape', 'KeyP'],
};

/** Swallowed so the page never scrolls underneath the board. */
const ALWAYS_PREVENT: readonly string[] = ['Space'];

/**
 * Space and Enter belong to whatever control has focus. Stealing them would
 * make the pause dialog's buttons unreachable by keyboard, which would break
 * a11y-arcade rule 6 in the act of serving the game loop.
 */
const ACTIVATION_KEYS: readonly string[] = ['Space', 'Enter', 'NumpadEnter'];

function isInteractive(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return node.matches('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
}

function isCodeList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

/**
 * Reads persisted bindings, falling back per-action rather than wholesale — a
 * half-written entry shouldn't cost the player their other remaps.
 */
export function parseBindings(raw: string | null): Bindings {
  if (raw === null) return DEFAULT_BINDINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_BINDINGS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_BINDINGS;

  const record = parsed as Record<string, unknown>;
  const result: Record<Action, readonly string[]> = { ...DEFAULT_BINDINGS };
  for (const action of ACTIONS) {
    const codes = record[action];
    if (isCodeList(codes) && codes.length > 0) result[action] = codes;
  }
  return result;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can be disabled entirely. The game still plays.
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function loadBindings(): Bindings {
  return parseBindings(readStorage(BINDINGS_STORAGE_KEY));
}

export function saveBindings(bindings: Bindings): void {
  writeStorage(BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}

export type Keyboard = {
  /** The direction the player is asking for this tick. */
  intent(): Intent;
  bindings(): Bindings;
  /** Rebinds an action to a key, taking it away from whatever held it. */
  remap(action: Action, code: string): Bindings;
  resetBindings(): Bindings;
  /** Drops any held keys — used when the window loses focus mid-press. */
  release(): void;
  dispose(): void;
};

export type KeyboardOptions = {
  readonly target?: EventTarget;
  readonly onPause?: () => void;
};

const DIRECTIONS: readonly Action[] = ['up', 'down', 'left', 'right'];

function isDirection(action: Action): action is Exclude<Action, 'pause'> {
  return action !== 'pause';
}

export function createKeyboard(options: KeyboardOptions = {}): Keyboard {
  const target = options.target ?? window;
  let bindings = loadBindings();

  // Most-recent-press-wins. A player rolling their thumb from left to up
  // expects "up", not whichever key their hand happens to still be resting on.
  const held: Action[] = [];

  const actionFor = (code: string): Action | null => {
    for (const action of ACTIONS) {
      if (bindings[action].includes(code)) return action;
    }
    return null;
  };

  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.repeat) return;
    if (ACTIVATION_KEYS.includes(event.code) && isInteractive(event.target)) return;

    const action = actionFor(event.code);
    if (action === null) {
      if (ALWAYS_PREVENT.includes(event.code)) event.preventDefault();
      return;
    }

    event.preventDefault();

    if (action === 'pause') {
      options.onPause?.();
      return;
    }

    const at = held.indexOf(action);
    if (at !== -1) held.splice(at, 1);
    held.push(action);
  };

  const onKeyUp = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    const action = actionFor(event.code);
    if (action === null) return;
    const at = held.indexOf(action);
    if (at !== -1) held.splice(at, 1);
  };

  const onBlur = (): void => {
    held.length = 0;
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    intent(): Intent {
      const action = held[held.length - 1];
      if (action === undefined || !isDirection(action)) return 'none';
      return action;
    },
    bindings(): Bindings {
      return bindings;
    },
    remap(action: Action, code: string): Bindings {
      const next: Record<Action, readonly string[]> = { ...bindings };
      for (const other of ACTIONS) {
        if (other === action) continue;
        next[other] = next[other].filter((existing) => existing !== code);
      }
      next[action] = [code];
      bindings = next;
      saveBindings(bindings);
      return bindings;
    },
    resetBindings(): Bindings {
      bindings = DEFAULT_BINDINGS;
      saveBindings(bindings);
      return bindings;
    },
    release(): void {
      held.length = 0;
    },
    dispose(): void {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.length = 0;
    },
  };
}

export { DIRECTIONS as DIRECTION_ACTIONS };
