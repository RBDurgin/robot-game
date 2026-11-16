import { ECONOMY, PRICES } from "../data/economy";
import type { Loadout } from "../data/loadouts";
import { SECTION_IDS } from "../data/frames";
import type { Health } from "./damage";
import { addItem, itemsUsed, type Inventory, type ItemId } from "./loadout";

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

export const buyPrice = (id: ItemId): number => PRICES[id];
export const sellPrice = (id: ItemId): number => Math.floor(PRICES[id] * ECONOMY.sellRatio);

/**
 * How many of an item can go without breaking any of the given loadouts. The hangar passes both
 * the build being edited and the one last deployed, so a part in use cannot be sold from under
 * either.
 */
export function spareCount(inventory: Inventory, id: ItemId, loadouts: Loadout[]): number {
  let needed = 0;
  for (const loadout of loadouts) needed = Math.max(needed, itemsUsed(loadout)[id] ?? 0);
  return Math.max(0, (inventory[id] ?? 0) - needed);
}

/** Buy one of an item. Returns false, changing nothing, if the player cannot afford it. */
export function buyItem(wallet: Wallet, id: ItemId): boolean {
  const price = buyPrice(id);
  if (wallet.scrap < price) return false;
  wallet.scrap -= price;
  addItem(wallet.inventory, id);
  return true;
}

/** Sell one spare of an item. Returns false, changing nothing, if there is none to spare. */
export function sellItem(wallet: Wallet, id: ItemId, loadouts: Loadout[]): boolean {
  if (spareCount(wallet.inventory, id, loadouts) < 1) return false;
  const left = (wallet.inventory[id] ?? 0) - 1;
  if (left > 0) wallet.inventory[id] = left;
  else delete wallet.inventory[id];
  wallet.scrap += sellPrice(id);
  return true;
}
