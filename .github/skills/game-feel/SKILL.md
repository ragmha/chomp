---
name: game-feel
description: Apply CHOMP's arcade responsiveness standard. Use whenever changing the input path, the main loop, movement, collision timing, or anything that affects how the game feels to play.
---

# Game feel

Arcade games live or die on latency. A maze-chase game where the turn lands one
frame late feels broken even when every test passes, and no unit test will tell
you. These rules encode what "responsive" means here so it isn't re-litigated
per PR.

## Budgets

| Property | Budget | Why |
|---|---|---|
| Input → state change | ≤ 1 tick (16.7ms) | Anything more reads as lag |
| Frame budget | ≤ 8ms at 60fps | Leaves headroom on weak hardware |
| Engine `step()` | ≤ 2ms | The rest belongs to rendering |
| Cold start to playable | ≤ 1.5s | It's a 40KB game |

## Rules

1. **Buffer the turn, don't drop it.** A direction pressed slightly before a
   junction must be honoured when the junction arrives. Hold the most recent
   direction in `pendingDir` for up to 8 ticks and apply it at the first legal
   opportunity. Dropping early inputs is the single most common way a
   maze-chase game feels wrong.

2. **Allow the corner cut.** If the player holds a perpendicular direction
   within 2 subpixels of a junction centre, snap them to the centre and turn.
   Requiring pixel-exact alignment feels punishing.

3. **Fixed timestep, always.** Accumulate real time and run whole ticks. Never
   scale movement by frame delta — variable steps make replays diverge and
   break the eval suite's determinism oracle.

4. **Never block the frame.** No synchronous work over 2ms in the loop. Build
   lookup tables at init.

5. **Coyote time on death.** Freeze for 30 ticks before resetting so the player
   sees what killed them. Instant resets read as a glitch.

6. **Asymmetric speeds.** The player must be marginally faster than the ghosts
   in open corridors and marginally slower through tunnels. Equal speeds make
   pursuit monotonous.

## Verify

Movement and timing changes need a replay-tape test in
`src/engine/__tests__/` proving the tick-exact outcome is unchanged, plus:

```bash
npm run test:unit -- engine
```

State the measured `step()` cost in your summary when you touch the main loop.
