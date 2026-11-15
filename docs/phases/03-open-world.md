# Phase 3: Open world

**Status: not started.** Size: 3 to 4 sessions. Depends on: phase 1.

## Goal

Grow from one 1 km zone to a continuous world the player can cross, with distinct regions and places worth finding.

## Why now

The faction war (phase 4) and story (phase 6) both need a world with regions to fight over and travel between.

## Decide first

1. World size. Suggested: 8 km square, about 64 times the current zone. Larger is possible but empties out quickly without content.
2. Balance of generated and hand-placed content. Suggested: generated terrain and scatter, hand-authored key sites.
3. Is there an edge (mountains, sea) or does terrain continue?

## Build steps

1. **Prototype collider streaming first.** This is the main technical risk: creating and removing Havok mesh colliders as the player moves must not cause hitches. Build a throwaway test with a moving point and measure before committing to a chunk size.
2. **World height function.** Generalise `heightAt` in `src/sim/terrain.ts` from a zone to a world with biome parameters blended by position. Keep it a pure function so terrain, spawning and AI agree.
3. **Chunked terrain.** Replace the single mesh in `src/view/terrain.ts` with a grid of chunks loaded around the player and unloaded behind them, each with its collider. Coarser distant chunks if the budget needs it.
4. **Biomes as data.** Basin, highlands, salt flats, ruins: height shape, colours, scatter objects, fog. New file under `src/data/`.
5. **Points of interest.** Outposts, wrecks, depots, landmarks. Hand-authored key sites plus seeded placement rules. Structures stream with their chunk.
6. **Entity streaming.** Mechs activate near the player and sleep when far. `World.mechs` in `src/game/world.ts` becomes the active set; a lighter record holds sleeping ones.
7. **Map and travel.** World map screen showing discovered places; fast travel between bases the player holds.
8. **Persistence.** Save player position and discoveries in `src/game/save.ts`.

## Out of scope

Territory ownership and off-screen battles (phase 4). Region-based difficulty and loot (phase 5).

## Key files and seams

- `heightAt` in `src/sim/terrain.ts` and `ZoneDef` in `src/data/zone.ts`.
- `buildTerrain` and `buildStructures` in `src/view/terrain.ts`.
- `addStaticCollider` and the collision layers in `src/game/physics.ts`.
- The fixed-step loop in `src/main.ts`: streaming work must be spread across frames, not done in one step.
- Fog settings in `World.create`: fog distance hides chunk loading.

## Verification

- Unit tests: height function continuity across chunk borders, biome blending, placement determinism for a seed.
- E2E: travel several kilometres by scripted teleports and walking; assert chunks load and unload, no errors, memory does not grow without bound.
- Real-browser run across the world to check for hitches.

## Exit criteria

- The player can travel edge to edge without loading screens or visible seams.
- No frame hitch above an agreed threshold when chunks load, on the user's machine.
- At least four biomes and a dozen points of interest.
- Map and fast travel work; position and discoveries persist.

## Checklist

- [ ] World size and content balance agreed
- [ ] Collider streaming prototype measured; chunk size chosen: ______
- [ ] World height function with tests
- [ ] Chunked terrain loading and unloading
- [ ] Biomes
- [ ] Points of interest
- [ ] Entity streaming
- [ ] Map screen and fast travel
- [ ] Position and discoveries saved
- [ ] Real-browser traversal check
- [ ] User playtest and sign-off
