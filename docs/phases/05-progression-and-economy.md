# Phase 5: Progression and economy

**Status: done.** Size: 2 to 3 sessions. Depends on: phase 2. Better after phase 3 if loot should vary by region.

## Goal

Give the player reasons to keep playing: things to earn, spend on and work toward, with saves that can be trusted.

## Why now

Scrap is collected in the slice but buys nothing. Once there are several frames and weapon families (phase 2), there is something worth earning.

## Decide first

1. Is power mostly horizontal (more options) or vertical (bigger numbers)? Suggested: mostly horizontal, with modest tiers.
2. Does dying cost anything (repair bill, dropped salvage), or stay free as it is now?
3. Are there pilot upgrades, or does all progression live in the mech?

## Decisions (settled 2026-11-16)

1. Power is mostly horizontal: three modest tiers (about +8% each) and one or two modifiers per
   drop. A starting weapon stays usable.
2. Dying costs a repair bill: respawn at base and pay scrap in proportion to the damage, capped,
   and free when the player has no scrap. No gear is lost.
3. All progression lives in the mech (frames, hardpoints, parts, standing). No pilot upgrades.

## Build steps

1. **Spending scrap.** Repair costs at base, buying and selling parts. A simple shop screen beside the hangar in `src/view/screens.ts`. Prices in data.
2. **Part tiers and modifiers.** Drops can roll a tier and one or two modifiers (for example cooler-running, lighter, longer range). Extend `rollLoot` in `src/sim/loot.ts` and the item model in `src/sim/loadout.ts`: items become instances with properties rather than counts per id.
3. **Loot tables by source.** Per faction and, if phase 3 is done, per region. Replaces the single table in `src/data/lootTables.ts`.
4. **Unlocks.** Frames and hardpoints earned through scrap, reputation or milestones.
5. **Save system upgrade** in `src/game/save.ts`: explicit version number with migrations, several save slots, and a move from `localStorage` to IndexedDB once inventory holds item instances. Export and import a save as a file.
6. **Difficulty by region.** Enemy tier follows where the player is, not the player's level, so the world has safe and dangerous areas.

## What is built so far

- Step 1. Repairs are billed on respawn and on deploying from a hangar: `ECONOMY.repairPerPoint`
  scrap per point of armor or structure put back, at most `ECONOMY.repairCap`, and never more than
  the player has. The hangar has a parts store: every part is for sale at the price in `PRICES`
  and sells back at `ECONOMY.sellRatio`. A part on the bench build or the deployed build cannot be
  sold. Rules are in `src/sim/economy.ts`, numbers in `src/data/economy.ts`.
- Step 2. Every part the player owns is an `Item` with a tier (Mk I to III, +8% damage or armor
  per tier) and up to two modifiers (`src/data/mods.ts`). The player's build is a `Fit` of item
  uids; AI pilots still use a `Loadout` of part ids. Both resolve to a `Kit` of definitions, which
  is what a mech is built from. Drops roll tier and modifiers from the odds in the loot table;
  bases sell only plain parts. Rules are in `src/sim/items.ts`.
- Step 5, first half. Saves carry a `version`; `MIGRATIONS` in `src/game/save.ts` brings old ones
  forward a version at a time. Every save from before this counts as version 1.
- Step 3. Each faction's wrecks give up different things (`FACTION_LOOT`: plating, favoured
  modifiers, how many weapons survive, scrap), and both wrecks and crates get better tiers and
  more scrap in more dangerous regions (`DANGER_LOOT`). `lootTableFor` and `cacheTableFor` in
  `src/sim/loot.ts` build the table for a kill or a crate.
- Step 4. A new pilot has the Warden frame. The Kite costs 300 scrap; the Bastion 600 and three
  sites cleared; its shoulder mounts 350 and +70 standing with any faction (`src/data/unlocks.ts`,
  rules in `src/sim/unlocks.ts`). Bought in the hangar under Upgrades. Saves from before the
  locks keep the frame and mounts they were using. `?arsenal` unlocks everything.
- Step 6. Every region has a `danger` of 1 to 3 (`src/data/world.ts`). Pilots take their strength
  from the region their site is in (`DANGER` in `src/data/encounters.ts`: up to +45% armor and
  +50% damage), not from the player. The HUD and map name the threat on entering a region.
- Step 5, second half. Three save slots, kept in IndexedDB (`src/game/saveStore.ts`), with
  `localStorage` as the fallback where IndexedDB is refused. The save from before slots moves
  into slot 1 the first time the game loads. The pause screen lists the slots and can export the
  game in progress to a file, import one into the slot in use, and reset that slot.

## For the playtest

- Your existing save should turn up in slot 1 with its scrap and parts, on the frame you last
  used. Worth a look before anything else.
- Whether a lost suit (74 scrap on the medium frame, about three kills) stings the right amount.
- Whether a Mk II or a modified part is noticeable in a fight, and worth swapping for.
- Whether the high-threat corners are a real step up, and whether their salvage is worth the trip.
- Whether the unlock prices and conditions come at the right time: the Kite early, the Bastion
  after a few sites, shoulder mounts as a late goal.
- Whether prices (120 to 300 for a weapon) make a purchase feel earned over the first hour.

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

- [x] Progression shape and death cost agreed
- [x] Repair costs and shop
- [x] Item instances with tiers and modifiers
- [x] Loot tables by faction and region
- [x] Frame and hardpoint unlocks
- [x] Versioned saves with migrations
- [x] Save slots, IndexedDB, export and import
- [x] Difficulty by region
- [x] User playtest and sign-off
