# Phase 8: Release readiness

**Status: not started.** Size: 1 to 2 sessions. Depends on: phase 6.

## Goal

Make the game something another person can pick up and play: it runs well, explains itself, adapts to the player, and is easy to get.

## Why now

Last, because it polishes what exists. Parts of it (key rebinding, quality settings) can be pulled earlier if they become annoying to live without.

## Decide first

1. Who is this for: the user alone, friends, or a public release?
2. Where it will be hosted, if anywhere.
3. Is a desktop build wanted, or is the browser enough?

## Build steps

1. **Performance pass.** Profile in a real browser on the target machine. Fix the largest costs first. Low, medium and high quality presets.
2. **Bundle size.** The build currently ships all of Babylon.js in one 7 MB file. Switch to per-module imports and split the physics engine into its own chunk.
3. **Key rebinding.** Remappable controls, saved with settings.
4. **Accessibility.** HUD colours that do not rely on red versus green, a reduced screen-shake setting, text size option, hold-versus-toggle for sprint and aim, subtitles for all dialogue.
5. **Onboarding.** Teach movement, weapons, heat and the hangar inside the opening mission instead of a controls list.
6. **Error handling.** A clear message if WebGL2 or WebAssembly is unavailable, and a way to recover from a bad save.
7. **Packaging.** Static build with hosting instructions. Optional desktop wrapper if wanted.
8. **Final checks.** Full playthrough, credits and licences, version number.

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

- [ ] Audience and hosting decided
- [ ] Performance pass and quality presets
- [ ] Bundle split
- [ ] Key rebinding
- [ ] Accessibility options
- [ ] In-mission onboarding
- [ ] Startup and save error handling
- [ ] Packaging and hosting instructions
- [ ] Fresh-player playthrough
- [ ] Final checks
