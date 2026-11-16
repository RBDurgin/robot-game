import type { ItemId } from "../sim/loadout";
import type { PlatingId } from "./parts";

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
};

/** What a salvage crate at a depot, wreck or landmark holds. */
export const CACHE_LOOT = {
  scrapMin: 20,
  scrapMax: 45,
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
