# Phase 1: Feel and foundations

**Status: not started.** Size: 1 to 2 sessions. Depends on: phase 0.

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

- [ ] Playtest notes collected
- [ ] Movement and camera tuned
- [ ] Weapons and enemy difficulty tuned
- [ ] Real-browser input and pause confirmed
- [ ] Audio levels confirmed
- [ ] Ignores restored, `npm run check` added, first commit made
- [ ] Frame rate baseline recorded: ______
- [ ] Small feel wins added
- [ ] User sign-off
