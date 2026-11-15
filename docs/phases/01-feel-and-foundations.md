# Phase 1: Feel and foundations

**Status: done.** Size: 1 to 2 sessions. Depends on: phase 0.

## Goal

Replace first-guess numbers with ones that feel right, fix whatever real-browser play reveals, and leave the repo in a clean state to build on.

## Why now

Nothing in the slice has been judged by a person playing it. Handling, camera and difficulty values feed into every later phase, so they should be settled before more is built on top.

## Decide first

1. After playing: what feels wrong? Collect notes on movement, camera, weapons, enemy difficulty and audio.
2. Should the medium frame lean more agile or more weighty than it does now?
3. Is the target frame rate 60 fps on the user's machine, and what machine is that?

## Build steps

1. **Playtest pass.** Apply the user's notes to `src/data/frames.ts`, `src/data/weapons.ts`, `src/data/encounters.ts` and the camera constants in `src/game/camera/cameraRig.ts`. Use the backquote tuning panel to find values, then copy them into data.
2. **Real-browser fixes.** Confirm mouse look, pointer capture, Esc to pause, focus loss, and audio levels. Fix what breaks.
3. **Repo hygiene.** Restore ignores for `dist/`, `test-results/` and `tests/e2e/screenshots/`. Add `npm run check` that runs typecheck, unit tests and e2e. Make the first commit.
4. **Performance baseline.** Measure frame rate in a real browser. Record the number here. Add shadows only if there is headroom.
5. **Small feel wins.** Landing thump, footsteps, stronger hit feedback, a wreck left where a mech dies, clearer overheat warning.
6. **Render smoothing.** Check for jitter on high-refresh displays; the camera currently uses the latest look angles with interpolated positions.

## Out of scope

New frames, weapons, zones or systems. This phase changes numbers and fixes defects.

## Key files and seams

- `src/data/` for all tuning.
- `src/view/tweakPanel.ts` for live sliders. Extend it to weapons or camera if that speeds tuning.
- `src/game/input.ts` for pointer capture and key handling.
- `src/view/audio.ts` for sound levels.

## Verification

- `npm run check` passes.
- Unit tests updated where tuned values are asserted (most tests read values from data, so few should change).
- User playtest in a real browser.

## Exit criteria

- The user signs off on how the medium frame handles and how a fight against the outpost plays.
- Mouse look, pause and audio work in a real browser.
- The repo has a clean first commit and a single check command.

## Checklist

- [x] Playtest notes collected (first round: difficulty, frame rate)
- [x] Movement and camera tuned (kept as they are, by the user's choice)
- [x] Enemy difficulty tuned (weapons unchanged, no notes against them)
- [x] Real-browser input and pause confirmed
- [x] Audio levels confirmed
- [x] Ignores restored, `npm run check` added
- [x] Phase 1 work committed
- [x] Frame rate baseline recorded: 60 fps average, 54 to 56 fps in a fight with all five enemies on a 2019 16-inch MacBook Pro, latest Chrome, built-in 60 Hz display. After requesting the discrete GPU: 60 average, 54 to 60 in the same fight, worst frame about 34 fps
- [x] Small feel wins added (to be judged in the playtest)
- [x] User sign-off (2026-11-15)

## Progress notes

Decisions (2026-11-15): keep the medium frame's handling as it is; measure the frame rate before choosing a target.

Done so far, verified by `npm run check` and the screenshots, not yet by a real-browser playtest:

- **Repo hygiene.** `dist/`, `test-results/` and `tests/e2e/screenshots/` are ignored and no longer tracked. `npm run check` runs typecheck, unit tests and e2e.
- **Feel wins.** Footsteps and landing thump (sim events `footstep` and `landImpact` in `src/sim/mech.ts`, the walk animation now reads the same stride so sound and feet agree), landing dust and camera kick, hit marker and kill marker on the crosshair, kill sound, hit sounds and shake scaled by damage, notices when a section is destroyed, wrecks where mechs die (visual only, no collision), heat warning from 80% with a blinking bar, a centre-screen alert and alarm sounds. Tuning is in `src/data/feel.ts`.
- **Real-browser fixes made from reading the code.** Opening the backquote panel no longer pauses the game (it frees the mouse; click the view to recapture). Resuming within a second of pressing Esc retries the mouse capture, and the HUD says "Click the view to capture the mouse" whenever the game is running without it. Held Space or Tab no longer reaches the page. A limiter on the audio output stops clipping when many sounds overlap.
- **Render smoothing.** Camera shake now decays by time instead of per frame (it faded 2.4 times faster at 144 Hz), and no longer moves the aim point. Mech positions are interpolated between simulation steps and the view uses the latest mouse angles, which is the right arrangement; whether any jitter remains needs a high-refresh display.
- **Performance baseline.** The backquote overlay now shows average fps, the 1% low and the worst frame over the last five seconds. Read the baseline from there during a fight.

Playtest round 1 (2026-11-15):

- **Too hard at the start.** Attacking one enemy brought the other four and the player died almost at once. Cause: any hit alerted every enemy within 120 m, alarms chained from mech to mech, and all five then fired together. Changes:
  - Alarms are per squad. The picket (2) and the garrison (3) are separate fights unless the other squad sees the player itself.
  - Sight range for unalerted enemies is 120 m, down from 170 m (`DEFAULT_AI.detectRange`).
  - At most two enemies fire at once (`ENEMY_TUNING.maxAttackers`, rule in `src/sim/ai/squad.ts`). The others hold fire and circle at long range until a slot opens.
  - Enemy damage (0.4x) and armor (0.7x) are unchanged, so the effect of the above can be judged on its own.
- **Frame rate.** 60 fps average, 54 to 56 in a five-mech fight. That average looks like a 60 Hz display cap, so the dips are the real signal: there is no headroom, and shadows stay off. Worth finding what costs the frames in a fight before phase 2 adds more mechs.

Playtest round 2 (2026-11-15):

- **Difficulty "a little better".** Taken as still on the hard side: enemy damage lowered from 0.4x to 0.3x (`ENEMY_TUNING.damageScale`). Attack slots stay at two.
- **Mouse capture, Esc to pause, resume, the new sounds and the heat alert all confirmed working.**
- **Machine.** 2019 16-inch MacBook Pro (Intel, integrated plus discrete Radeon GPU), latest Chrome; the dev server runs in the VS Code dev container, the game runs in Chrome on the Mac. Chrome gives WebGL the integrated GPU unless the page asks otherwise, so the engine now requests `powerPreference: "high-performance"`. The frame rate needs measuring again after this change.

Playtest round 3 (2026-11-15):

- **Difficulty accepted.** With 0.3x enemy damage, two attack slots and per-squad alarms the user cleared the level.
- **Frame rate after the GPU change.** 60 average, 54 to 60 in a five-mech fight, worst single frame about 34 fps. Slightly better at the top of the range; occasional hitches remain and their cause is not yet known. The game holds close to 60 on this machine but has no headroom, so shadows stay off and the target is 60 fps.

Signed off on 2026-11-15: handling, camera and weapons stay as they are.

Profiled (2026-11-15) on the user's machine with the in-game recorder (`?profile`, see `CLAUDE.md`): 80 s of play including a five-mech fight and one kill.

- **Fights hold 60 fps with headroom.** In the fight, 1 frame in 2,779 was late. Game JavaScript averages 3.5 ms a frame (simulation 0.7 ms, scene render 2.6 ms) and the GPU 1.9 ms, against a 16.7 ms budget. The earlier 54 to 56 fps reading did not reproduce; it was read from the backquote overlay, which may itself have cost the frames (not confirmed).
- **First shots: two frames of about 31 ms.** Two shader variants for the weapon effects compile the first time anything fires (render 23 ms that frame). This matches the "worst about 34 fps" reading. Fix: compile the effect, wreck and salvage materials at load.
- **A kill costs one 11.5 ms simulation step** (wreck and crate creation, disposing the mech), giving a 19 ms frame. Small now, but it scales with kills per second in later phases. Fix when it matters: pool wrecks and spread the disposal.
- **Occasional full garbage collections pause the game.** A DevTools trace of a second fight (58 s) showed two: 60 ms and 17.5 ms, each dropping one to four frames. Most of the 60 ms was the browser clearing its own short-lived objects (not game data); the profiling spans add 540 such objects a second, so the pause is probably shorter in normal play, where one unexplained 40 ms frame in 80 s is the likely equivalent. The game's own sources are the debug text rewritten every frame even when hidden (`src/main.ts`) and the audio nodes made per sound. Small collections are harmless (under 2 ms).
- **Not causes:** the HUD texture upload, AI (0.37 ms a step with five mechs fighting), physics.
- **Fixed so far:** the effect, thruster-flame, wreck and salvage shaders now compile at load (`prewarm` in `src/view/effects.ts`, `wreck.ts`, `mechVisual.ts`, `src/game/salvage.ts`); a scripted fight with a kill compiles none mid-fight. The debug text is only written while the overlay is open, five times a second. Confirmed on the user's machine: 94 s of play with 3 kills had no slow frame at all (worst 22.4 ms, no dropped frame), no shader compiled mid-fight, and the heaviest frame used 11.7 ms of game code, so the kill frame now fits the budget too. No long garbage-collection pause appeared, though one run cannot show they are gone.
- DevTools' Performance panel with Screenshots on drops the game to about 35 fps on its own; untick it.
