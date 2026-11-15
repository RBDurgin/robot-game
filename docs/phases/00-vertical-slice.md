# Phase 0: Vertical slice

**Status: done.** This is a record of what exists, so later phases know what they are building on.

## Goal

Prove the core loop end to end in one small area: pilot a mech, fight enemy mechs, salvage parts, refit, finish a mission.

## Decisions made

| Topic | Decision |
|---|---|
| Stack | Babylon.js + TypeScript in the browser, Vite, Havok physics |
| Why this stack | The whole build, run and test loop works inside the dev container, which has no GPU or display |
| Camera | Third-person and cockpit, toggled with V, sharing one aim point |
| Mech feel | Depends on the frame. Only the medium frame exists so far |
| Art | Procedural, built from primitives in code, behind the `PartVisual` interface so imported models can replace parts later |
| Long-term systems | Customization, faction war, loot and progression, story missions. The slice has thin versions of the first three |

## What was built

- **Zone.** "Ashfall Basin", 1 km square, generated from a seeded height function (`src/sim/terrain.ts`, `src/data/zone.ts`). Player base with hangar, wreck field, rocks, walled enemy outpost (`src/view/terrain.ts`).
- **Mech.** Medium "Warden" frame (`src/data/frames.ts`). Walk, sprint, boost dash, jump jets, energy and heat (`src/sim/mech.ts`). Havok character controller (`src/game/mechEntity.ts`). Procedural parts and walk animation (`src/view/parts/`, `src/view/mechVisual.ts`).
- **Cameras.** One rig, two modes (`src/game/camera/cameraRig.ts`). Weapons fire at the crosshair's world point.
- **Combat.** Four weapons, two hitscan and two explosive, plus melee (`src/data/weapons.ts`, `src/game/combat.ts`). Per-section damage with armor then structure (`src/sim/damage.ts`). Analytic hit volumes (`src/sim/hit.ts`).
- **Enemies.** Five Kestrel Combine mechs in two squads (`src/data/encounters.ts`). Pure AI brain: patrol, engage, retreat, unstick (`src/sim/ai/brain.ts`), fed by `src/game/aiController.ts`.
- **Loot and hangar.** Salvage crates (`src/game/salvage.ts`, `src/sim/loot.ts`). Loadout rules with a weight limit (`src/sim/loadout.ts`). Hangar, pause and mission summary screens (`src/view/screens.ts`). Progress in `localStorage` (`src/game/save.ts`).
- **Mission and polish.** Clear the outpost, return to base. HUD with radar and compass (`src/view/hud/hud.ts`), synthesised audio (`src/view/audio.ts`), screen shake, live tuning sliders on the backquote key (`src/view/tweakPanel.ts`).

## Verified

- Typecheck clean, production build succeeds.
- 45 unit tests on the simulation layer.
- 3 headless-browser tests: movement and views, a firefight, the full mission loop including hangar and save.

## Not verified

- Game feel and performance. The container renders in software at 10 to 25 fps.
- Real mouse look and Esc to pause. Headless Chromium stalls after capturing the mouse, so tests skip it.
- Audio. It runs without errors but has not been heard.
- Difficulty. Enemy damage is 0.4x and armor 0.7x of the player's as a first guess.

## Lessons worth keeping

- The Havok character controller registers a physics body. World raycasts must use the collision layers in `src/game/physics.ts`, or they stop on mech capsules.
- Scripted tests should wait on simulation ticks, not wall-clock time.
- Seeded randomness makes loot and AI reproducible; tests should not assume a particular roll.
