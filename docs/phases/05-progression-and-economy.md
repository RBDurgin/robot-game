# Phase 5: Progression and economy

**Status: not started.** Size: 2 to 3 sessions. Depends on: phase 2. Better after phase 3 if loot should vary by region.

## Goal

Give the player reasons to keep playing: things to earn, spend on and work toward, with saves that can be trusted.

## Why now

Scrap is collected in the slice but buys nothing. Once there are several frames and weapon families (phase 2), there is something worth earning.

## Decide first

1. Is power mostly horizontal (more options) or vertical (bigger numbers)? Suggested: mostly horizontal, with modest tiers.
2. Does dying cost anything (repair bill, dropped salvage), or stay free as it is now?
3. Are there pilot upgrades, or does all progression live in the mech?

## Build steps

1. **Spending scrap.** Repair costs at base, buying and selling parts. A simple shop screen beside the hangar in `src/view/screens.ts`. Prices in data.
2. **Part tiers and modifiers.** Drops can roll a tier and one or two modifiers (for example cooler-running, lighter, longer range). Extend `rollLoot` in `src/sim/loot.ts` and the item model in `src/sim/loadout.ts`: items become instances with properties rather than counts per id.
3. **Loot tables by source.** Per faction and, if phase 3 is done, per region. Replaces the single table in `src/data/lootTables.ts`.
4. **Unlocks.** Frames and hardpoints earned through scrap, reputation or milestones.
5. **Save system upgrade** in `src/game/save.ts`: explicit version number with migrations, several save slots, and a move from `localStorage` to IndexedDB once inventory holds item instances. Export and import a save as a file.
6. **Difficulty by region.** Enemy tier follows where the player is, not the player's level, so the world has safe and dangerous areas.

## Out of scope

Story rewards (phase 6). Balance for a full-length game; aim for a curve that holds up over a few hours.

## Key files and seams

- `Inventory`, `ItemId`, `loadoutProblems` in `src/sim/loadout.ts`.
- `rollLoot` in `src/sim/loot.ts`, `LOOT` in `src/data/lootTables.ts`.
- `SaveData`, `loadSave`, `writeSave` in `src/game/save.ts`. Loading already validates and falls back safely; keep that property.
- `ENEMY_TUNING` in `src/data/encounters.ts`.

## Verification

- Unit tests: price and repair rules, tier and modifier rolls stay within bounds, unlock conditions, every save migration from each earlier version.
- E2E: earn scrap, buy a part, fit it, reload, confirm it persists; load a version 1 save.
- User playtest of an hour or more to judge pacing.

## Exit criteria

- Scrap has uses the player cares about.
- Drops differ in interesting ways, not only by id.
- A save from phase 0 still loads.
- Pacing over the first hours feels right to the user.

## Checklist

- [ ] Progression shape and death cost agreed
- [ ] Repair costs and shop
- [ ] Item instances with tiers and modifiers
- [ ] Loot tables by faction and region
- [ ] Frame and hardpoint unlocks
- [ ] Versioned saves with migrations
- [ ] Save slots, IndexedDB, export and import
- [ ] Difficulty by region
- [ ] User playtest and sign-off
