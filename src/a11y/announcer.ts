import type { GameEvent, GameState } from '../engine/state.ts';

/**
 * The screen-reader channel.
 *
 * a11y-arcade rule 4: an `aria-live="polite"` region reports the state changes
 * a sighted player reads off the board, throttled to at most one utterance a
 * second so a four-ghost combo doesn't turn into a wall of speech. Rule 5: the
 * canvas keeps an `aria-label` that describes the board rather than leaving it
 * a silent void.
 *
 * Everything is written with `textContent` (secure-web-app rule 1).
 */

/** a11y-arcade rule 4. */
export const MIN_INTERVAL_MS = 1000;

/** Score is announced on crossing a multiple of this. */
const SCORE_STEP = 1000;

type Candidate = { readonly priority: number; readonly text: string };

/**
 * Higher wins when several things happen in the same second. Losing a life
 * matters more than the third pellet of a combo, and the throttle means only
 * one of them gets said.
 */
function candidateFor(event: GameEvent): Candidate | null {
  switch (event.type) {
    case 'gameOver':
      return { priority: 100, text: `Game over. Final score ${event.score}.` };
    case 'death':
      return {
        priority: 90,
        text:
          event.livesLeft > 0
            ? `Caught. ${event.livesLeft} ${event.livesLeft === 1 ? 'life' : 'lives'} left.`
            : 'Caught. No lives left.',
      };
    case 'levelClear':
      return { priority: 80, text: `Level ${event.level} cleared.` };
    case 'extraLife':
      return { priority: 70, text: 'Extra life awarded.' };
    case 'ghostEaten':
      return { priority: 60, text: `Ghost eaten, ${event.points} points.` };
    case 'power':
      return { priority: 50, text: 'Power pellet. Ghosts are frightened.' };
    case 'pellet':
      return null;
  }
}

function describe(state: GameState): string {
  const ghosts = state.ghosts.filter((g) => g.mode === 'frightened').length;
  const parts = [
    `CHOMP maze, level ${state.level}.`,
    `Score ${state.score}.`,
    `${Math.max(0, state.lives)} ${state.lives === 1 ? 'life' : 'lives'} remaining.`,
    `${state.pelletsLeft} pellets left.`,
  ];
  if (ghosts > 0) parts.push(`${ghosts} frightened ghosts.`);
  if (state.status === 'gameOver') parts.push('Game over.');
  else if (state.status === 'ready') parts.push('Get ready.');
  return parts.join(' ');
}

export type Announcer = {
  /** Call once per frame with the events the engine produced this tick. */
  update(state: GameState, events: readonly GameEvent[], now: number): void;
  /** Speak something the engine has no event for, such as pausing. */
  say(text: string, now: number): void;
  /** Force the label to catch up, e.g. after a restart. */
  refresh(state: GameState): void;
};

export function createAnnouncer(region: HTMLElement, canvas: HTMLElement): Announcer {
  let queued: Candidate | null = null;
  let lastSpokenAt = Number.NEGATIVE_INFINITY;
  let lastLabel = '';
  let scoreMilestone = 0;

  const flush = (now: number): void => {
    if (queued === null) return;
    if (now - lastSpokenAt < MIN_INTERVAL_MS) return;
    // A repeated identical string is not re-announced by every screen reader,
    // so a trailing space is toggled to force a change. Still plain text.
    const text = region.textContent === queued.text ? `${queued.text} ` : queued.text;
    region.textContent = text;
    lastSpokenAt = now;
    queued = null;
  };

  const offer = (candidate: Candidate | null): void => {
    if (candidate === null) return;
    if (queued === null || candidate.priority >= queued.priority) queued = candidate;
  };

  const label = (state: GameState): void => {
    const next = describe(state);
    if (next === lastLabel) return;
    canvas.setAttribute('aria-label', next);
    lastLabel = next;
  };

  return {
    update(state, events, now): void {
      for (const event of events) offer(candidateFor(event));

      const milestone = Math.floor(state.score / SCORE_STEP);
      if (milestone > scoreMilestone) {
        scoreMilestone = milestone;
        offer({ priority: 40, text: `Score ${milestone * SCORE_STEP}.` });
      }

      label(state);
      flush(now);
    },
    say(text, now): void {
      offer({ priority: 95, text });
      flush(now);
    },
    refresh(state): void {
      scoreMilestone = Math.floor(state.score / SCORE_STEP);
      lastLabel = '';
      label(state);
    },
  };
}
