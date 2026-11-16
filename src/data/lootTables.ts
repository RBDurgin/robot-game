import type { ItemId } from "../sim/loadout";
import type { WarFactionId } from "./factions";
import type { ModId } from "./mods";
import type { PlatingId } from "./parts";
import type { Danger } from "./world";

/** How salvage is rolled when an enemy mech is destroyed. */
export const LOOT = {
  /** Chance that each weapon the enemy carried survives to be salvaged. */
  weaponChance: 0.55,
  /** Chance of recovering usable plating at all. */
  platingChance: 0.3,
  /** Relative odds of which plating is recovered. */
  platingWeights: { lightPlating: 3, standardPlating: 0, heavyPlating: 2 } satisfies Record<PlatingId, number>,
  scrapMin: 12,
  scrapMax: 30,
  /** Relative odds of a recovered part being Mk I, II or III. */
  tierWeights: [82, 16, 2] as [number, number, number],
  /** Chance that a recovered part carries a modifier, and that one which does carries a second. */
  modChance: 0.3,
  secondModChance: 0.25,
  /** Relative odds of each modifier, where a faction favours some. Unlisted ones count as 1. */
  modWeights: {} as Partial<Record<ModId, number>>,
};

export type LootTable = typeof LOOT;

/**
 * What each faction's wrecks give up, as changes to `LOOT`. A faction's salvage reflects how it
 * fights, so who you hunt decides what you find.
 */
export const FACTION_LOOT: Record<WarFactionId, Partial<LootTable>> = {
  // Mobile mid-range suits: stripped-down, long-reaching gear.
  drifters: { platingWeights: { lightPlating: 4, standardPlating: 0, heavyPlating: 1 }, modWeights: { light: 3, longRange: 3 } },
  // Well supplied: more of their weapons survive, and more often in good order.
  combine: { weaponChance: 0.65, modChance: 0.25, modWeights: { steady: 2 } },
  // Dug-in heavies: plating, and plenty of it.
  wardens: { platingChance: 0.5, platingWeights: { lightPlating: 0, standardPlating: 1, heavyPlating: 4 }, modWeights: { reinforced: 3, cooled: 3 } },
  // Raiders: hot-rodded guns in poor repair, and pockets full of other people's scrap.
  syndicate: { weaponChance: 0.45, modChance: 0.45, modWeights: { rapid: 3, light: 2 }, scrapMin: 18, scrapMax: 40 },
};

/** How salvage improves with a region's danger, for wrecks and crates alike. */
export const DANGER_LOOT: Record<Danger, { tierWeights: [number, number, number]; scrapScale: number }> = {
  1: { tierWeights: [82, 16, 2], scrapScale: 1 },
  2: { tierWeights: [58, 34, 8], scrapScale: 1.3 },
  3: { tierWeights: [36, 44, 20], scrapScale: 1.7 },
};

/** What a salvage crate at a depot, wreck or landmark holds. */
export const CACHE_LOOT = {
  scrapMin: 20,
  scrapMax: 45,
  /** Crates are the better source of unusual parts. Their tier follows the region, as wrecks' do. */
  tierWeights: [82, 16, 2] as [number, number, number],
  modChance: 0.5,
  secondModChance: 0.3,
  /** Chance that a crate holds a part as well as scrap. */
  itemChance: 0.6,
  /** Relative odds of which part it is. */
  itemWeights: {
    pulseRifle: 2,
    slugCannon: 3,
    scatterGun: 3,
    swarmPod: 2,
    lanceBeam: 2,
    seekerRack: 2,
    lightPlating: 2,
    heavyPlating: 2,
  } satisfies Partial<Record<ItemId, number>>,
};

export type CacheTable = typeof CACHE_LOOT;
