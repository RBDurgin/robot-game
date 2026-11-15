import type { FrameDef } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { PLATING, type PlatingId } from "../data/parts";
import { WEAPONS, type WeaponId } from "../data/weapons";
import { clamp } from "./math";

export type ItemId = WeaponId | PlatingId;
/** How many of each item the player owns (fitted items included). */
export type Inventory = Partial<Record<ItemId, number>>;

export const isWeaponId = (id: string): id is WeaponId => id in WEAPONS;
export const isPlatingId = (id: string): id is PlatingId => id in PLATING;
export const itemName = (id: ItemId): string => (isWeaponId(id) ? WEAPONS[id].name : PLATING[id].name);

export interface LoadoutStats {
  mass: number;
  capacity: number;
  overweight: boolean;
  /** Movement multiplier from carried mass: light builds are quicker, full loads slower. */
  mobility: number;
  armorScale: number;
}

/** Load ratio at which a mech moves at exactly its frame's rated speed. */
const NEUTRAL_LOAD = 0.85;

export function loadoutStats(frame: FrameDef, loadout: Loadout): LoadoutStats {
  let mass = PLATING[loadout.plating].mass;
  if (loadout.armL) mass += WEAPONS[loadout.armL].mass;
  if (loadout.armR) mass += WEAPONS[loadout.armR].mass;
  const ratio = mass / frame.loadCapacity;
  return {
    mass,
    capacity: frame.loadCapacity,
    overweight: mass > frame.loadCapacity + 1e-9,
    mobility: clamp(1 + 0.35 * (NEUTRAL_LOAD - ratio), 0.9, 1.2),
    armorScale: PLATING[loadout.plating].armorScale,
  };
}

/** Items a loadout uses, with counts (the same weapon in both arms needs two). */
export function itemsUsed(loadout: Loadout): Inventory {
  const used: Inventory = {};
  for (const id of [loadout.armL, loadout.armR, loadout.plating]) {
    if (id) used[id] = (used[id] ?? 0) + 1;
  }
  return used;
}

/** Reasons a loadout cannot be deployed; empty means it is valid. */
export function loadoutProblems(frame: FrameDef, loadout: Loadout, inventory: Inventory): string[] {
  const problems: string[] = [];
  const stats = loadoutStats(frame, loadout);
  if (stats.overweight) {
    problems.push(`Over capacity by ${(stats.mass - stats.capacity).toFixed(1)} t`);
  }
  for (const [id, count] of Object.entries(itemsUsed(loadout)) as [ItemId, number][]) {
    if ((inventory[id] ?? 0) < count) problems.push(`Not enough ${itemName(id)} (need ${count})`);
  }
  if (!loadout.armL && !loadout.armR) problems.push("No weapon fitted");
  return problems;
}

export function addItem(inventory: Inventory, id: ItemId, count = 1): void {
  inventory[id] = (inventory[id] ?? 0) + count;
}

export function startingInventory(loadout: Loadout): Inventory {
  return itemsUsed(loadout);
}
