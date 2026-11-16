import { ECONOMY, PRICES } from "../data/economy";
import { SECTION_IDS } from "../data/frames";
import type { Health } from "./damage";
import { addItem, findItem, fitUses, plainSpec, removeItem, type Fit, type Inventory, type Item, type ItemSpec } from "./items";
import type { ItemId } from "./loadout";

/** The player's money and parts. `SaveData` is one. */
export interface Wallet {
  scrap: number;
  inventory: Inventory;
}

/** What it would cost to put a suit back to factory condition, before any cap. */
export function repairCost(health: Health): number {
  let lost = 0;
  for (const id of SECTION_IDS) {
    const s = health.sections[id];
    lost += s.maxArmor - s.armor + (s.maxStructure - s.structure);
  }
  return Math.max(0, Math.ceil(lost * ECONOMY.repairPerPoint - 1e-9));
}

/**
 * What the player is actually charged for a repair: the cost, up to the cap, and never more than
 * they have. A broke pilot is repaired for nothing, so nobody is ever stuck in a wrecked suit.
 */
export function repairBill(cost: number, scrap: number): number {
  return Math.max(0, Math.min(cost, ECONOMY.repairCap, Math.floor(scrap)));
}

/** The price of a plain Mk I part at a base. */
export const buyPrice = (id: ItemId): number => PRICES[id];

/** What a part is worth: its price, raised for each tier above the first and each modifier. */
export const itemValue = (spec: ItemSpec): number => PRICES[spec.id] * (1 + ECONOMY.tierValue * (spec.tier - 1)) * (1 + ECONOMY.modValue * spec.mods.length);
export const sellPrice = (spec: ItemSpec): number => Math.floor(itemValue(spec) * ECONOMY.sellRatio);

/**
 * True if an item can go without breaking any of the given fits. The hangar passes both the
 * build being edited and the one last deployed, so a part in use cannot be sold from under
 * either.
 */
export const isSpare = (uid: number, fits: Fit[]): boolean => !fits.some((fit) => fitUses(fit).includes(uid));

/** Buy one plain part. Returns it, or null (changing nothing) if the player cannot afford it. */
export function buyItem(wallet: Wallet, id: ItemId): Item | null {
  const price = buyPrice(id);
  if (wallet.scrap < price) return null;
  wallet.scrap -= price;
  return addItem(wallet.inventory, plainSpec(id));
}

/** Sell an item. Returns false, changing nothing, if it is in use or not the player's. */
export function sellItem(wallet: Wallet, uid: number, fits: Fit[]): boolean {
  const item = findItem(wallet.inventory, uid);
  if (!item || !isSpare(uid, fits)) return false;
  removeItem(wallet.inventory, uid);
  wallet.scrap += sellPrice(item);
  return true;
}
