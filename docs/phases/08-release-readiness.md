# Phase 8: Release readiness

**Status: in progress.** Size: 1 to 2 sessions. Depends on: phase 6.

## Goal

Make the game something another person can pick up and play: it runs well, explains itself, adapts to the player, and is easy to get.

## Why now

Last, because it polishes what exists. Parts of it (key rebinding, quality settings) can be pulled earlier if they become annoying to live without.

## Decide first

1. Who is this for: the user alone, friends, or a public release?
2. Where it will be hosted, if anywhere.
3. Is a desktop build wanted, or is the browser enough?

## Decisions (2026-11-18)

1. **Audience: friends.** A handful of people sent a link. It has to explain itself and fail clearly without the author there; no store page or analytics.
2. **Hosting: GitHub Pages**, deployed from a GitHub Actions workflow. The build uses a relative base path so it also runs from any static host or a subfolder.
3. **Browser only.** No desktop wrapper: Electron runs the same Chromium and WebGL, so it would not be faster, and Tauri on macOS uses WebKit, whose WebGL is usually slower.

## Build steps

1. **Performance pass.** Profile in a real browser on the target machine. Fix the largest costs first. Low, medium and high quality presets. Known from phase 7: a 23 to 28 ms frame when mechs wake near a site, mostly their first render (warm their materials and meshes ahead of time).
2. **Bundle size.** The build currently ships all of Babylon.js in one 7 MB file. Switch to per-module imports and split the physics engine into its own chunk.
3. **Key rebinding.** Remappable controls, saved with settings.
4. **Accessibility.** HUD colours that do not rely on red versus green, a reduced screen-shake setting, text size option, hold-versus-toggle for sprint and aim, subtitles for all dialogue.
5. **Onboarding.** Teach movement, weapons, heat and the hangar inside the opening mission instead of a controls list.
6. **Error handling.** A clear message if WebGL2 or WebAssembly is unavailable, and a way to recover from a bad save.
7. **Packaging.** Static build with hosting instructions. Optional desktop wrapper if wanted.
8. **Final checks.** Full playthrough, credits and licences, version number.

## What is built so far

- Step 2 (bundle). Babylon is imported from one local barrel, `src/babylon.ts`, which takes each
  class from its own module (the registering variant, not `.pure`) and lists the scene
  components that have no class of their own (shadows, physics, effect layers, pipelines,
  animation). The HUD imports `@babylonjs/gui/2D` rather than the whole GUI, and the Havok glue
  is loaded with a dynamic import, so it is a chunk of its own beside the wasm. Entry chunk 6.19
  MB (1,336 kB gzip) before, 1.42 MB (353 kB gzip) after. The glTF loader and its extensions
  are already lazy chunks. A first visit downloads 1.6 MB compressed in all (wasm 0.67 MB). `npm run e2e:prod` runs every e2e test against `vite preview` of the
  production build; the build uses relative paths (`base: "./"`).
- Step 1 (performance). Probing headless (High, every faction, frame and loadout visited): no
  shader compiles when a mech wakes; the player's prewarm already covers them. What a wake does
  cost is building the mech (4 to 12 ms headless) and its first render (6 to 10 ms more than
  later renders), and `mesh.isReady(true)` beforehand moves about half of the latter out. Wakes
  were already one per simulation step. Now a woken mech is built hidden, its meshes are made
  ready a few at a time within `STREAM.wakeWarmMs` (2 ms) per rendered frame, and it is shown
  and handed to the AI only then, one mech per frame.
- Step 1, second round (traces 2026-11-19, Medium 59.9 fps / 0.4% slow, High 59.3 fps / 0.7%
  slow). The waking hitch was still there: a 17 ms frame building the mech, then 28 to 50 ms
  as it appeared (its render 9 to 15 ms of JavaScript, plus 10 to 15 ms outside the page), and
  one shader compiled and thrown away per wake. The warm-up had run before the mech's imported
  parts replaced their procedural stand-ins, so it prepared meshes that were never drawn. Now it
  waits for the parts, warms only meshes that will be drawn, and then shows them
  `STREAM.wakeRevealPerFrame` (8) per frame, spreading the first-draw cost over about six frames.
  No throwaway shader any more (checked headless). Also seen on High: with five mechs in a fight
  the scene render takes 14 to 19 ms of JavaScript, against 6 on Medium.
- Step 1, checked (trace 2026-11-20, High, 60 s with five wakes and a five-mech fight): 60.0 fps,
  0.1% slow frames (0.7% before), p99 17.7 ms. Every wake now stays under 18 ms. The three slow
  frames had light JavaScript and GPU time (the cost was outside the page). The scene render in
  a fight averages 7.2 ms (13.4 at most), well within a frame.
- Step 3 (rebinding). Actions and default keys are data (`src/data/controls.ts`); the player's
  bindings are `settings.bindings` (`src/game/bindings.ts`: up to two keys per action, mouse
  buttons as `Mouse0`..`Mouse4`, taking a key from another action swaps them). The pause screen
  lists every action with a button per key: click, press the new key or button; Delete clears,
  Esc cancels. Gamepad buttons run the same actions. Prompts and mission text name keys through
  `input.keyName(action)` (a mission writes `{key:jump}`), and show the gamepad button while a
  pad is in use.
- Step 4 (accessibility). Settings: sprint hold or toggle; screen shake 0 to 1 (scales every
  camera kick); text size Normal / Large / Larger (scales the whole HUD through the GUI's ideal
  height, and the menus with CSS zoom); HUD colours Standard or Colour-blind friendly
  (`src/data/hudColors.ts`: friend and foe blue against orange, damage blue, yellow, orange). There
  is no aim mode in this game (right mouse fires the left arm, brace is automatic), so only
  sprint has the hold-or-toggle choice. Dialogue is radio text only, already on screen for a
  time that grows with its length; it follows the text size.
- Step 5 (onboarding). The first mission opens with seven training stages at home: walk,
  sprint, jump jets, dash, fire, heat warning, hangar. Each waits for the player to do it (a
  `did` goal fed by `playerDid` events from the world), with Hale explaining over the radio.
  Training stages (`training: true`) are left out for anyone who has finished a mission, and
  "Skip training" is on the start and pause screens. The outpost is held for the player during
  training as it is during the assault.
- Step 6 (errors). Without WebGL 2 or WebAssembly the page explains what is missing and what to
  do. A failure while starting or playing stops the game and offers Reload, Download this save
  and Start this slot over. A slot that cannot be read is copied aside before a fresh game
  starts in it, and the start screen says so and offers the copy for download.
- Step 7 (packaging). GitHub Pages through `.github/workflows/pages.yml` (unit tests, build,
  publish); `docs/hosting.md` covers setup, other static hosts and what a player needs.
  `README.md` added, with the link to the game. `npm run build` collects `public/THIRD-PARTY-LICENSES.txt` from the shipped
  packages (Babylon.js Apache-2.0 with its NOTICE, Havok MIT).
  Deployed 2026-11-19 at https://rbdurgin.github.io/robot-game/ (repository
  RBDurgin/robot-game); checked by loading it in headless Chromium: no errors or failed
  requests, wasm served as `application/wasm`, the game starts in its first training stage.

## Out of scope

New content or systems.

## Key files and seams

- `Settings` in `src/game/save.ts` and the settings controls in `src/view/screens.ts`.
- Key handling in `src/game/input.ts`.
- HUD colours in `src/view/hud/hud.ts`.
- `vite.config.ts` for build splitting.

## Verification

- E2E on the production build, not only the dev server.
- Frame rate at each quality preset on the target machine.
- A playthrough by someone who has not seen the game, watching where they get stuck.
- Build size before and after.

## Exit criteria

- Holds the target frame rate on the target machine.
- A new player can finish the first mission without outside help.
- The build can be handed to someone else and run.

## Checklist

- [x] Audience and hosting decided
- [x] Performance pass and quality presets
- [x] Bundle split
- [x] Key rebinding
- [x] Accessibility options
- [x] In-mission onboarding
- [x] Startup and save error handling
- [x] Packaging and hosting instructions
- [ ] Fresh-player playthrough
- [ ] Final checks
