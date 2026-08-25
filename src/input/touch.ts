import type { Intent } from '../engine/state.ts';

/**
 * Touch input.
 *
 * A swipe on the board resolves to the same `Intent` union the keyboard
 * produces, so nothing downstream knows or cares which one the player used.
 * The two coexist: this layer only ever reports a direction in the poll
 * immediately after a swipe, so resting a thumb on the screen can't fight a
 * held key.
 */

/** How far a finger must travel before it counts as a swipe, in CSS pixels. */
export const SWIPE_THRESHOLD = 24;

export type Touch = {
  /** The swipe direction since the last poll, or 'none'. Consumed on read. */
  intent(): Intent;
  dispose(): void;
};

type Origin = { readonly id: number; readonly x: number; readonly y: number };

export function createTouch(element: HTMLElement): Touch {
  let origin: Origin | null = null;
  let pending: Intent = 'none';

  const resolve = (dx: number, dy: number): Intent => {
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return 'none';
    // The dominant axis wins, so a diagonal drag still gives a clean turn.
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    origin = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (origin === null || event.pointerId !== origin.id) return;
    const intent = resolve(event.clientX - origin.x, event.clientY - origin.y);
    if (intent === 'none') return;

    // Re-anchor so a long drag can chain several turns without lifting off.
    pending = intent;
    origin = { id: origin.id, x: event.clientX, y: event.clientY };
    event.preventDefault();
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (origin === null || event.pointerId !== origin.id) return;
    const intent = resolve(event.clientX - origin.x, event.clientY - origin.y);
    if (intent !== 'none') pending = intent;
    origin = null;
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove, { passive: false });
  element.addEventListener('pointerup', onPointerEnd);
  element.addEventListener('pointercancel', onPointerEnd);

  return {
    intent(): Intent {
      const next = pending;
      pending = 'none';
      return next;
    },
    dispose(): void {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
      origin = null;
      pending = 'none';
    },
  };
}
