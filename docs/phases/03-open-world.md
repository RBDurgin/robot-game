# Phase 3: Open world

**Status: done.** Size: 3 to 4 sessions. Depends on: phase 1.

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

## Decisions

- World size: 8192 m square (32 x 32 chunks).
- Content: generated terrain and scatter, 14 hand-placed key sites, 20 minor sites from seeded rules.
- Edge: a mountain rim. Mechs are also stopped 230 m short of the edge, high on the rim, for
  anyone who jets up it.

## What the prototype found

Measured in headless Chromium in the dev container (CPU work, so the numbers carry over):

| Collider for one chunk | Create | Remove |
|---|---|---|
| Triangle mesh, 256 m, 40 x 40 cells | 7.1 ms (max 10.6) | 0.06 ms |
| Triangle mesh, 512 m, 128 x 128 cells | 80 ms (max 143) | 0.06 ms |
| Heightfield, 256 m, 40 x 40 cells | 0.15 ms | 0.02 ms |
| Heightfield, 512 m, 128 x 128 cells | 0.54 ms | 0.02 ms |

So terrain colliders are Havok heightfields, and the cost of a chunk is sampling its heights
(about 2.5 ms for 41 x 41 samples) and building its mesh, not physics. Chunk size 256 m keeps
each of those jobs small. The row order Havok wants is not the obvious one; `addHeightfieldCollider`
in `src/game/physics.ts` has the layout that was checked against ray hits.

In the e2e run the longest single streaming job while sprinting was about 10 to 12 ms on the
container's CPU, and loading everything around the start point takes 300 to 400 ms. Neither says
what a real machine does; that is the traversal check below.

## How it is built

- `src/data/world.ts`: regions, key sites, placement rules. `src/data/biomes.ts`: the four biomes.
  `src/data/streaming.ts`: every streaming distance and the per-frame budget.
- `src/sim/terrain.ts`: `sampleTerrain` is the terrain's shape; `heightAt` is the ground, which is
  that shape sampled on the 6.4 m grid the meshes and colliders are built from. They differ by up
  to a couple of metres on sharp crests, so gameplay asks `heightAt`.
- `src/sim/chunks.ts`: which chunks should be loaded at what detail (pure, with hysteresis), and
  each chunk's scatter. `src/sim/worldgen.ts`: seeded site placement.
- `src/sim/population.ts`: sleeping mech records and the wake and sleep rule.
- `src/game/terrainStream.ts`: builds and removes what the planner asks for, a few milliseconds
  per frame, nearest first. A teleport loads the surroundings at once.
- `src/view/mapView.ts` and `Screens.showMap`: the world map.

## Checklist

- [x] World size and content balance agreed
- [x] Collider streaming prototype measured; chunk size chosen: 256 m, heightfield colliders
- [x] World height function with tests
- [x] Chunked terrain loading and unloading
- [x] Biomes
- [x] Points of interest
- [x] Entity streaming
- [x] Map screen and fast travel
- [x] Position and discoveries saved
- [x] Real-browser traversal check
- [x] User playtest and sign-off

## Traversal check (2026-11-16)

Fourteen profiles from the user's machine (Chrome, Radeon Pro 5300M, 1792 x 1003 at 2x), about
8,200 frames of travel at a steady 60 fps. Hitch threshold: no frame over 33 ms while travelling.

- No frame over 33 ms. The five slowest were 26 to 33 ms and none of them did streaming work.
- Streaming ran in 211 frames: median 3.4 ms, 99th percentile 6.2 ms, worst 6.7 ms, up to 18 jobs
  in a frame. All inside a 16.7 ms frame.
- Not covered by these runs: fights (no enemy woke and nothing was destroyed), and the one-off
  load on fast travel and respawn, which happens outside the measured frames.
