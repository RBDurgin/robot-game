# Phase 4: Living faction war

**Status: built, awaiting playtest.** Size: 3 to 4 sessions. Depends on: phase 3.

## Goal

A world where factions hold territory, fight each other whether or not the player is watching, and react to what the player does.

## Why now

With a world to fight over, this is what makes it feel alive, and it is the backdrop the story missions (phase 6) draw on.

## Decide first

1. Can the player join a faction, or do they stay independent and earn standing with each?
2. How many factions in total? Suggested: four, including the two that exist.
3. Can a faction be wiped out, or does the war always rebalance?
4. How fast should the front move: over minutes of play, or hours?

### Decided (2026-11-16)

1. **Independent.** The player flies for nobody and has a standing with each faction. Their suit is the `freelancer` faction row; Drifters' Rest is their own base, outside the war.
2. **Four factions:** Drifter Compact, Kestrel Combine, Greywall Wardens, Emberline Syndicate. Drifters and Wardens are at peace with each other; every other pair is at war.
3. **The war rebalances.** Each faction has a home site that cannot be taken, factions that have lost ground recover faster, and raids lean toward whoever is ahead.
4. **Tens of minutes.** A site changes hands about every 11 minutes (`WAR.raidChance`); the long-run test holds it between 3.5 and 7.5 per hour.

## How it was built

- **Sites, not regions, are what is held.** The plan said regions with an owner and strength. Ownership is per site with a garrison (`src/sim/war.ts`), because that is what the player captures and what garrisons are spawned from. A region's colour on the map is derived: whoever holds most of its garrison capacity.
- **Strength is a head count.** A site's `troops` is the number of pilots in its garrison, one `MechRecord` each, so the model and the mechs cannot disagree.
- **Raids.** A faction sends pilots from one site to a linked one. They take time to arrive. Unseen, the fight is resolved by dice; within `WAR.observeRange` of the player the raiders are real mechs and the result is whatever happens.
- **Garrisons are jobs.** `GARRISONS` lists jobs (line, heavy, scout...) and each faction's `roster` fills them, so the same outpost is a different fight under each holder.
- **The player.** Clearing a base makes it theirs; clearing anything else leaves it empty for the next raid. Hostile factions raid the player's bases after a warning; standing in the base and destroying the raid holds it.
- **Reputation** (`src/sim/reputation.ts`, numbers in `REPUTATION`): kills and captures lower standing with the victim and raise it with the victim's enemies. Hostile at -25 or below, allied at +40 or above. Allied factions open their bases (hangar, fast travel), join the player's fights and lend wingmen (G).
- **Friendly fire.** AI pilots' shots pass through anyone they are not at war with and they hold fire when a friend is in the line. The player's shots hit whoever they point at, cost standing, and enough of it turns that squad on them.

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

- [x] Faction count and player allegiance agreed
- [x] New factions in data
- [x] Friendly and neutral mechs
- [x] Territory model with tests
- [x] Long-run war simulation test
- [x] Spawning from territory state, results fed back
- [x] Reputation
- [x] Capturable sites and counterattacks
- [x] Allied squads
- [x] Map overlay
- [ ] User playtest and sign-off

## For the playtest

Things the dev container cannot judge:

- Whether the war is noticeable at this pace, and whether the war reports on the HUD are too many or too few.
- Whether AI against AI fights last a sensible time (`ENEMY_TUNING.aiDamageScale`).
- Whether three-sided fights read clearly: marker colours are red hostile, pale neutral, cyan allied.
- Whether the siege warning (`WAR.siegeWarning`, 3.5 minutes) is enough to get back to a base.
- Whether standing moves too fast: four Warden kills make the Wardens hostile.
- Wingmen have no pathfinding: they hop walls with their jets like every other pilot, and can lag.

## Known limits

- Raids in transit are not in the world: a raid only becomes mechs when it arrives at a site the player is near.
- There is no way yet to give a cleared site to an ally or to earn standing other than by fighting a faction's enemies.
- The opening mission's outpost is kept out of the war until the mission is done.
