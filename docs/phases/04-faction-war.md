# Phase 4: Living faction war

**Status: not started.** Size: 3 to 4 sessions. Depends on: phase 3.

## Goal

A world where factions hold territory, fight each other whether or not the player is watching, and react to what the player does.

## Why now

With a world to fight over, this is what makes it feel alive, and it is the backdrop the story missions (phase 6) draw on.

## Decide first

1. Can the player join a faction, or do they stay independent and earn standing with each?
2. How many factions in total? Suggested: four, including the two that exist.
3. Can a faction be wiped out, or does the war always rebalance?
4. How fast should the front move: over minutes of play, or hours?

## Build steps

1. **More factions.** Add to `src/data/factions.ts` with colours, relations and a preferred fighting style. Add friendly and neutral mechs to the world; `areHostile` already drives AI targeting and friendly fire rules.
2. **Territory model.** New pure module in `src/sim/`: regions with an owner, strength and neighbours. A coarse tick (every few seconds of game time) resolves pressure between neighbouring regions deterministically from a seed.
3. **From model to mechs.** When the player is near a region, spawn patrols, garrisons and skirmishes that match the model. When they resolve, feed losses back into region strength. Builds on the entity streaming from phase 3.
4. **Reputation.** Standing per faction, changed by kills, captures and help given. Thresholds decide who attacks on sight, who ignores the player, and who assists.
5. **Capturable sites.** Clearing an outpost flips it; the owning faction may counterattack. Generalises the slice's single outpost mission in `src/game/world.ts`.
6. **Allied AI.** Friendly squads that fight alongside the player. Check target selection and line-of-fire behaviour in `src/sim/ai/brain.ts` with three or more sides in one fight.
7. **Map overlay.** Territory colours and contested borders on the world map.

## Out of scope

Authored story beats (phase 6). Economy effects of territory (phase 5).

## Key files and seams

- `FACTIONS` and `areHostile` in `src/data/factions.ts`. Relations become dynamic for the player, so hostility needs to consult reputation.
- `thinkAi` in `src/sim/ai/brain.ts` and `AiController` in `src/game/aiController.ts`.
- `SquadDef` in `src/data/encounters.ts`: squads become generated from territory state.
- Seeded `makeRng` in `src/sim/math.ts` for a reproducible war.

## Verification

- Unit tests: territory tick is deterministic for a seed, strength is conserved or changes only by stated rules, reputation thresholds, capture rules.
- Simulation test: run the war for many ticks with no player and assert it neither freezes nor collapses to one faction too fast.
- E2E: three-sided fight; capture an outpost and see ownership change on the map.
- User playtest over a long session.

## Exit criteria

- Territory visibly changes over a play session without player action.
- Player actions shift reputation and change who is hostile.
- Outposts can be captured and lost.
- Fights with three or more sides behave sensibly.

## Checklist

- [ ] Faction count and player allegiance agreed
- [ ] New factions in data
- [ ] Friendly and neutral mechs
- [ ] Territory model with tests
- [ ] Long-run war simulation test
- [ ] Spawning from territory state, results fed back
- [ ] Reputation
- [ ] Capturable sites and counterattacks
- [ ] Allied squads
- [ ] Map overlay
- [ ] User playtest and sign-off
