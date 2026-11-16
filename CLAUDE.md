# Robot Game

3D mech combat game: Babylon.js + TypeScript, runs in the browser via Vite. Currently one zone,
three playable frames (light, medium, heavy) and one enemy faction.

The roadmap is in `docs/roadmap.md`, with one document per phase in `docs/phases/`. Before starting
work, read the roadmap and the document for the current phase, and settle that phase's "Decide
first" questions with the user.

## Commands

- `npm run dev`: dev server on http://localhost:5173 (port is forwarded from the dev container)
- `npm run typecheck`: TypeScript check
- `npm test`: Vitest unit tests for the simulation layer (fast, no browser)
- `npm run e2e`: Playwright tests in headless Chromium; writes screenshots to `tests/e2e/screenshots/`
- `npm run build`: typecheck + production build to `dist/`
- `npm run check`: typecheck, unit tests and e2e in one go
- `npm run trace -- perf/<file>`: summarise a Chrome Performance trace (see "Dev tools in the game")

Run `npm run check` after any gameplay change, and look at the screenshots.

## Architecture

Three layers with a strict dependency direction: `sim` knows nothing about Babylon.

- `src/sim/`: pure TypeScript game rules (movement, damage, hit volumes, AI brain, loadout, loot).
  Deterministic, fixed 60 Hz step, unit-tested. New rules go here first, with tests.
- `src/game/`: Babylon integration (world, physics, input, mech entity, combat, camera, save).
- `src/view/`: visuals and UI (procedural mech parts, terrain, effects, HUD, HTML menus, audio).
- `src/data/`: everything tunable (frames, weapons, plating, factions, encounters, loot, zone).
  Prefer changing data over changing code.

Key seams:

- `Intent` (`src/sim/intent.ts`): player input and AI both produce one; all mechs share the same code.
- `PartVisual` (`src/view/parts/PartVisual.ts`): the only interface gameplay has to a part's
  appearance. Procedural parts implement it now; a glTF-backed implementation can be added later.
- `FrameDef` (`src/data/frames.ts`): a frame is a data row: handling, abilities (dash charges,
  brace), hardpoints and model proportions. No frame has its own controller code.
- Hardpoints: a `Loadout` maps hardpoint ids to weapons. Each hardpoint names the trigger that
  fires it and the section that carries it, so combat and the hangar loop over
  `frame.hardpoints` rather than naming arms.

## Things that are easy to get wrong

- Mech character controllers own a Havok body. "World" raycasts must use the collision layers in
  `src/game/physics.ts` (`raycastWorld`), or they stop on mech capsules. Mech hits are resolved
  analytically in `src/sim/hit.ts`.
- The dev container has no GPU: headless Chromium renders in software (10-25 fps). That is fine
  for correctness and screenshots but says nothing about real performance or game feel.
- Headless Chromium stalls after taking pointer lock, so `PlayerInput.lockPointer` is skipped when
  `navigator.webdriver` is set. Tests drive the mech through `world.intentOverride` and the
  `window.__game` debug handle instead of real mouse input.
- `node_modules` is shared between the macOS host and the Linux dev container. TypeScript, rolldown
  and lightningcss ship one native package per platform, so tools fail in whichever environment did
  not run the install. Add the missing platform's packages next to the existing ones (same versions
  as `package-lock.json`) rather than reinstalling, which can remove the other platform's.
- The player's `MechEntity` is replaced when the frame changes in the hangar, so do not hold on
  to `world.player` across a deploy.
- Beam weapons give `damage` and `heat` per second, not per shot.
- Saves written before phase 2 have `armL`/`armR` in the loadout and no frame. `parseSave` in
  `src/game/save.ts` reads both shapes; keep it that way when the save format changes again.
- Feedback strength (shake, landing thresholds, heat warning) is data in `src/data/feel.ts`.
- Angles: yaw 0 faces +Z, positive yaw turns toward +X, positive pitch looks up.

## Dev tools in the game

Backquote (`) toggles a stats overlay and live sliders for the player frame's handling values.

Open the game with `?arsenal` in the URL to stock the hangar with two of every weapon and plating.

Profiling: open the game with `?profile` in the URL. It records per-frame timings and counters
(`src/game/perf.ts`) and the dev server saves them to `perf/` (ignored by git) each time a menu
opens, so play, then press Esc. `npm run trace -- perf/<file>` summarises the file. With
`?profile=devtools` the same spans also go to Chrome's Performance panel, and a trace saved from
there can be summarised the same way; untick Screenshots there, which costs about 25 fps.
