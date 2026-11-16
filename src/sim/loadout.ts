import { HARDPOINT_IDS, type FrameDef, type HardpointId } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { PLATING, type PlatingId } from "../data/parts";
import { WEAPONS, type WeaponDef, type WeaponId } from "../data/weapons";
import { clamp } from "./math";

export type ItemId = WeaponId | PlatingId;
/** How many of each item the player owns (fitted items included). */
export type Inventory = Partial<Record<ItemId, number>>;

export const isWeaponId = (id: unknown): id is WeaponId => typeof id === "string" && id in WEAPONS;
export const isPlatingId = (id: unknown): id is PlatingId => typeof id === "string" && id in PLATING;
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

/** Fitted weapons in hardpoint order. */
export function fittedWeapons(loadout: Loadout): [HardpointId, WeaponId][] {
  const out: [HardpointId, WeaponId][] = [];
  for (const id of HARDPOINT_IDS) {
    const weapon = loadout.weapons[id];
    if (weapon) out.push([id, weapon]);
  }
  return out;
}

/** True if a weapon may be fitted to a kind of mount. */
export const fitsMount = (weapon: WeaponDef, mount: "arm" | "shoulder"): boolean => mount === "arm" || weapon.shoulder === true;

export function loadoutStats(frame: FrameDef, loadout: Loadout): LoadoutStats {
  let mass = PLATING[loadout.plating].mass;
  for (const [, weapon] of fittedWeapons(loadout)) mass += WEAPONS[weapon].mass;
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
  for (const id of [...fittedWeapons(loadout).map(([, weapon]) => weapon), loadout.plating]) {
    used[id] = (used[id] ?? 0) + 1;
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
  for (const [id, weapon] of fittedWeapons(loadout)) {
    const hardpoint = frame.hardpoints.find((h) => h.id === id);
    if (!hardpoint) problems.push(`The ${frame.name} has no mount for ${WEAPONS[weapon].name}`);
    else if (!fitsMount(WEAPONS[weapon], hardpoint.mount)) problems.push(`${WEAPONS[weapon].name} does not fit the ${hardpoint.name.toLowerCase()}`);
  }
  for (const [id, count] of Object.entries(itemsUsed(loadout)) as [ItemId, number][]) {
    if ((inventory[id] ?? 0) < count) problems.push(`Not enough ${itemName(id)} (need ${count})`);
  }
  if (fittedWeapons(loadout).length === 0) problems.push("No weapon fitted");
  return problems;
}

/** The same loadout with anything the frame cannot mount taken off. */
export function fitToFrame(frame: FrameDef, loadout: Loadout): Loadout {
  const weapons: Loadout["weapons"] = {};
  for (const hardpoint of frame.hardpoints) {
    const weapon = loadout.weapons[hardpoint.id];
    if (weapon && fitsMount(WEAPONS[weapon], hardpoint.mount)) weapons[hardpoint.id] = weapon;
  }
  return { weapons, plating: loadout.plating };
}

export function addItem(inventory: Inventory, id: ItemId, count = 1): void {
  inventory[id] = (inventory[id] ?? 0) + count;
}

export function startingInventory(loadout: Loadout): Inventory {
  return itemsUsed(loadout);
}
