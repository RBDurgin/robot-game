import type { Loadout } from "../data/loadouts";
import { CACHE_LOOT, LOOT, type LootTable } from "../data/lootTables";
import type { PlatingId } from "../data/parts";
import { rollSpec, type ItemSpec } from "./items";
import { fittedWeapons, type ItemId } from "./loadout";

export interface LootDrop {
  items: ItemSpec[];
  scrap: number;
}

/** Roll the salvage left behind by a destroyed mech that carried `loadout`. */
export function rollLoot(loadout: Loadout, rng: () => number, table: LootTable = LOOT): LootDrop {
  const items: ItemSpec[] = [];
  for (const [, weapon] of fittedWeapons(loadout)) {
    if (rng() < table.weaponChance) items.push(rollSpec(weapon, rng, table));
  }
  if (rng() < table.platingChance) {
    const entries = Object.entries(table.platingWeights) as [PlatingId, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let pick = rng() * total;
    for (const [id, weight] of entries) {
      pick -= weight;
      if (weight > 0 && pick < 0) {
        items.push(rollSpec(id, rng, table));
        break;
      }
    }
  }
  const scrap = Math.round(table.scrapMin + rng() * (table.scrapMax - table.scrapMin));
  return { items, scrap };
}

/** Roll the contents of one salvage crate found lying at a site. */
export function rollCache(rng: () => number, table = CACHE_LOOT): LootDrop {
  const items: ItemSpec[] = [];
  if (rng() < table.itemChance) {
    const entries = Object.entries(table.itemWeights) as [ItemId, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let pick = rng() * total;
    for (const [id, weight] of entries) {
      pick -= weight;
      if (weight > 0 && pick < 0) {
        items.push(rollSpec(id, rng, table));
        break;
      }
    }
  }
  return { items, scrap: Math.round(table.scrapMin + rng() * (table.scrapMax - table.scrapMin)) };
}
