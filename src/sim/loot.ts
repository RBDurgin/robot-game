import type { Loadout } from "../data/loadouts";
import { LOOT } from "../data/lootTables";
import type { PlatingId } from "../data/parts";
import type { ItemId } from "./loadout";

export interface LootDrop {
  items: ItemId[];
  scrap: number;
}

/** Roll the salvage left behind by a destroyed mech that carried `loadout`. */
export function rollLoot(loadout: Loadout, rng: () => number, table = LOOT): LootDrop {
  const items: ItemId[] = [];
  for (const weapon of [loadout.armR, loadout.armL]) {
    if (weapon && rng() < table.weaponChance) items.push(weapon);
  }
  if (rng() < table.platingChance) {
    const entries = Object.entries(table.platingWeights) as [PlatingId, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let pick = rng() * total;
    for (const [id, weight] of entries) {
      pick -= weight;
      if (weight > 0 && pick < 0) {
        items.push(id);
        break;
      }
    }
  }
  const scrap = Math.round(table.scrapMin + rng() * (table.scrapMax - table.scrapMin));
  return { items, scrap };
}
