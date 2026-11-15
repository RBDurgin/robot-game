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
