import { HARDPOINT_IDS, type FrameDef, type HardpointId } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { PLATING, type PlatingDef, type PlatingId } from "../data/parts";
import { WEAPONS, type WeaponDef, type WeaponId } from "../data/weapons";
import { clamp } from "./math";

export type ItemId = WeaponId | PlatingId;

/**
 * What a mech actually carries, as the numbers that matter: a `Loadout` names parts, a kit is
 * those parts' definitions. AI pilots get the stock definitions (`kitOf`); the player's come
 * from their own items, which can be better than stock (`fitKit` in `items.ts`).
 */
export interface Kit {
  weapons: Partial<Record<HardpointId, WeaponDef>>;
  plating: PlatingDef;
}

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

/** The stock parts a loadout names. */
export function kitOf(loadout: Loadout): Kit {
  const weapons: Kit["weapons"] = {};
  for (const [id, weapon] of fittedWeapons(loadout)) weapons[id] = WEAPONS[weapon];
  return { weapons, plating: PLATING[loadout.plating] };
}

/** A kit's weapons in hardpoint order. */
export function kitWeapons(kit: Kit): [HardpointId, WeaponDef][] {
  const out: [HardpointId, WeaponDef][] = [];
  for (const id of HARDPOINT_IDS) {
    const weapon = kit.weapons[id];
    if (weapon) out.push([id, weapon]);
  }
  return out;
}

/** True if a weapon may be fitted to a kind of mount. */
export const fitsMount = (weapon: WeaponDef, mount: "arm" | "shoulder"): boolean => mount === "arm" || weapon.shoulder === true;

export function kitStats(frame: FrameDef, kit: Kit): LoadoutStats {
  let mass = kit.plating.mass;
  for (const [, weapon] of kitWeapons(kit)) mass += weapon.mass;
  const ratio = mass / frame.loadCapacity;
  return {
    mass,
    capacity: frame.loadCapacity,
    overweight: mass > frame.loadCapacity + 1e-9,
    mobility: clamp(1 + 0.35 * (NEUTRAL_LOAD - ratio), 0.9, 1.2),
    armorScale: kit.plating.armorScale,
  };
}

export const loadoutStats = (frame: FrameDef, loadout: Loadout): LoadoutStats => kitStats(frame, kitOf(loadout));

/** Reasons a kit cannot be deployed on a frame; empty means it is valid. */
export function kitProblems(frame: FrameDef, kit: Kit): string[] {
  const problems: string[] = [];
  const stats = kitStats(frame, kit);
  if (stats.overweight) {
    problems.push(`Over capacity by ${(stats.mass - stats.capacity).toFixed(1)} t`);
  }
  const weapons = kitWeapons(kit);
  for (const [id, weapon] of weapons) {
    const hardpoint = frame.hardpoints.find((h) => h.id === id);
    if (!hardpoint) problems.push(`The ${frame.name} has no mount for ${weapon.name}`);
    else if (!fitsMount(weapon, hardpoint.mount)) problems.push(`${weapon.name} does not fit the ${hardpoint.name.toLowerCase()}`);
  }
  if (weapons.length === 0) problems.push("No weapon fitted");
  return problems;
}

export const loadoutProblems = (frame: FrameDef, loadout: Loadout): string[] => kitProblems(frame, kitOf(loadout));

/** The hardpoints of a frame that can carry what `slots` holds there. */
export function mountable<T>(frame: FrameDef, slots: Partial<Record<HardpointId, T>>, def: (part: T) => WeaponDef | undefined): Partial<Record<HardpointId, T>> {
  const out: Partial<Record<HardpointId, T>> = {};
  for (const hardpoint of frame.hardpoints) {
    const part = slots[hardpoint.id];
    const weapon = part === undefined ? undefined : def(part);
    if (part !== undefined && weapon && fitsMount(weapon, hardpoint.mount)) out[hardpoint.id] = part;
  }
  return out;
}

/** The same loadout with anything the frame cannot mount taken off. */
export const fitToFrame = (frame: FrameDef, loadout: Loadout): Loadout => ({ weapons: mountable(frame, loadout.weapons, (id) => WEAPONS[id]), plating: loadout.plating });

/** The same kit with anything the frame cannot mount taken off. */
export const kitToFrame = (frame: FrameDef, kit: Kit): Kit => ({ weapons: mountable(frame, kit.weapons, (w) => w), plating: kit.plating });
