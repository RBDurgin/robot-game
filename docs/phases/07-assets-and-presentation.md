# Phase 7: Assets and presentation

**Status: not started.** Size: 2 to 4 sessions. Depends on: phase 2. Can run alongside other phases, one part at a time.

## Goal

Raise how the game looks and sounds: imported models where they help, better lighting and effects, proper audio, and gamepad support.

## Why now

Not before phase 2, because frame silhouettes and hardpoints should be settled before models are made or chosen for them. After that it can proceed whenever art is available.

## Decide first

1. Art direction. Stay stylised low-poly, or aim for more detail?
2. Where assets come from: CC0 packs, the user's own models, or keep procedural and improve it.
3. Audio source: better synthesis, CC0 samples, or original recordings. Music or not.
4. Performance budget on the user's machine, from the phase 1 baseline.

## Build steps

1. **`GltfPartVisual`.** A second implementation of `PartVisual` in `src/view/parts/` that loads a glTF model, exposes named attachment points, and maps pose channels to bones or authored clips. Gameplay code does not change.
2. **Asset pipeline.** A folder for models, a manifest mapping part ids to files, loading with a procedural fallback while a model loads or if it is missing, and an attribution file listing source and licence for every asset.
3. **Swap parts one at a time.** Start with one frame's torso to prove the path, then continue as assets arrive. Procedural and imported parts can coexist on one mech.
4. **Animation.** Authored clips where available, procedural otherwise; blend between walk, run, jets and recoil.
5. **Cockpit interior.** A modelled cockpit replacing the flat overlay, with instruments driven by the same state the HUD reads.
6. **Lighting and effects.** Shadows, particle effects for jets, impacts and explosions, restrained post-processing. Each addition measured against the budget, with quality settings to turn it down.
7. **Audio.** Replace or improve the synthesised sounds in `src/view/audio.ts`; positional audio; music if wanted.
8. **Gamepad.** Second input source in `src/game/input.ts` producing the same `Intent`.
9. **HUD polish.** Readability pass, consistent with the chosen art direction.

## Out of scope

Changing gameplay rules to suit assets. If a model does not fit a hit volume or hardpoint, adjust the model or its mapping.

## Key files and seams

- `PartVisual` in `src/view/parts/PartVisual.ts` and `MechVisual` in `src/view/mechVisual.ts`.
- `Effects` in `src/view/effects.ts`, `Sfx` in `src/view/audio.ts`.
- `PlayerInput.buildIntent` in `src/game/input.ts`.
- Hit volumes in `src/sim/hit.ts` stay analytic; models are matched to them, not the reverse.

## Verification

- E2E: a mech built from mixed procedural and imported parts loads, animates and fights; a missing asset falls back without errors.
- Screenshot comparison before and after for each visual change.
- Frame rate measured in a real browser after each addition.
- Every asset has an entry in the attribution file.

## Exit criteria

- The user is happy with how the game looks and sounds.
- Frame rate stays at or above the agreed target on their machine.
- All third-party assets are licensed for use and credited.

## Checklist

- [ ] Art direction and asset sources agreed
- [ ] `GltfPartVisual`
- [ ] Asset manifest, fallback and attribution file
- [ ] First imported part in game
- [ ] Animation blending
- [ ] Cockpit interior
- [ ] Shadows, particles, post-processing with quality settings
- [ ] Audio upgrade
- [ ] Gamepad support
- [ ] HUD polish
- [ ] Frame rate check and user sign-off
