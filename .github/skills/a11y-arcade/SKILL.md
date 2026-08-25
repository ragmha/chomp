---
name: a11y-arcade
description: Apply CHOMP's accessibility standard for arcade games. Use whenever changing anything visible, interactive, animated, or colour-coded, including sprites, HUD, menus, input handling and effects.
---

# Accessible arcade

Arcade games fail accessibility in predictable ways: colour as the only signal,
motion with no opt-out, hardcoded keys, and state changes only a sighted player
notices. Each rule below fixes one of those, and each is checkable.

## Rules

1. **Never encode meaning in hue alone.** Ghosts differ by hue *and* by an
   distinct eye/body silhouette, so the four are separable in greyscale. When
   frightened, they change shape as well as colour.

   Test: render a frame, desaturate it, and confirm all four remain
   distinguishable. `src/render/__tests__/greyscale.test.ts` asserts this.

2. **Every key is remappable.** No hardcoded `ArrowLeft` outside
   `src/input/keyboard.ts`. Bindings come from a map persisted in
   `localStorage`, defaulting to arrows plus WASD together. Both work at once —
   a one-handed player shouldn't have to open settings first.

3. **Honour `prefers-reduced-motion`.** When set, disable screen shake, sprite
   squash, particle bursts and the maze flash on level clear. The game must
   remain fully playable; reduce motion, don't remove function.

   ```ts
   const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
   ```

4. **Announce state changes.** An `aria-live="polite"` region reports score
   milestones, lives lost, level changes and game over. Throttle to at most one
   announcement per second, so a screen reader isn't flooded during a combo.

   ```html
   <div id="announcer" aria-live="polite" class="visually-hidden"></div>
   ```

5. **The canvas needs a text alternative.** `<canvas>` carries
   `role="img"` and an `aria-label` kept current with the game state, so the
   board is not a silent void.

6. **Pause must be reachable and obvious.** `Escape` and `P` both pause, focus
   moves to the pause dialog, and focus is trapped there until dismissed.

7. **Contrast ≥ 4.5:1** for all HUD text against its background. The palette in
   `src/render/sprites.ts` is chosen for this and for deuteranopia and
   protanopia separability — don't add a colour without re-checking.

8. **No flashing above 3Hz.** Nothing in this game may risk a seizure. The
   level-clear flash is capped at 2Hz and disabled under reduced motion.

## Verify

```bash
npm run test:unit -- a11y
npm run test:e2e -- --grep @a11y
```

The E2E suite runs axe-core against the shell and asserts the reduced-motion
and remap paths. Report the axe result in your summary.
