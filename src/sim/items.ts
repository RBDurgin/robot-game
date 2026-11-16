import { HARDPOINT_IDS, type FrameDef, type HardpointId } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { MOD_IDS, MODS, TIERS, type ModDef, type ModId, type ModStat } from "../data/mods";
import { PLATING, type PlatingDef, type PlatingId } from "../data/parts";
import { WEAPONS, type WeaponDef, type WeaponId } from "../data/weapons";
import { isPlatingId, isWeaponId, itemName, kitProblems, mountable, type ItemId, type Kit } from "./loadout";

/** A part as it drops: which part, how good, and what is unusual about it. */
export interface ItemSpec {
  id: ItemId;
  /** 1 to `TIERS.max`. */
  tier: number;
  /** In `MOD_IDS` order, none repeated. */
  mods: ModId[];
}

/** A part the player owns. Two identical parts are still two items. */
export interface Item extends ItemSpec {
  uid: number;
}

export type Inventory = Item[];

/** The player's build: which of their items sits where. */
export interface Fit {
  weapons: Partial<Record<HardpointId, number>>;
  plating: number;
}

export const plainSpec = (id: ItemId): ItemSpec => ({ id, tier: 1, mods: [] });

export const isModId = (id: unknown): id is ModId => typeof id === "string" && id in MODS;

/** True if a modifier means something on a part. */
export function modFits(mod: ModId, id: ItemId): boolean {
  const def: ModDef = MODS[mod];
  if (isPlatingId(id)) return def.fits !== "weapon";
  return def.fits !== "plating" && !def.notKinds?.includes((WEAPONS[id] as WeaponDef).kind);
}

const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;
const PLACES: Record<ModStat | "damage", number> = { damage: 1, heat: 2, mass: 2, range: 0, spread: 4, cooldown: 3, armorScale: 3 };

function scaled<T extends object>(base: T, spec: ItemSpec, tierStat: "damage" | "armorScale"): T {
  const out = { ...base } as Record<string, unknown>;
  const scale = (stat: ModStat | "damage", by: number): void => {
    if (typeof out[stat] === "number") out[stat] = round((out[stat] as number) * by, PLACES[stat]);
  };
  scale(tierStat, 1 + TIERS.step * (spec.tier - 1));
  for (const mod of spec.mods) {
    for (const [stat, by] of Object.entries((MODS[mod] as ModDef).scale) as [ModStat, number][]) scale(stat, by);
  }
  return out as T;
}

/** A weapon's numbers with an item's tier and modifiers applied. */
export const tunedWeapon = (spec: ItemSpec & { id: WeaponId }): WeaponDef => scaled<WeaponDef>(WEAPONS[spec.id], spec, "damage");
/** A plating's numbers with an item's tier and modifiers applied. */
export const tunedPlating = (spec: ItemSpec & { id: PlatingId }): PlatingDef => scaled<PlatingDef>(PLATING[spec.id], spec, "armorScale");

const isWeaponItem = <T extends ItemSpec>(item: T): item is T & { id: WeaponId } => isWeaponId(item.id);
const isPlatingItem = <T extends ItemSpec>(item: T): item is T & { id: PlatingId } => isPlatingId(item.id);
export { isPlatingItem, isWeaponItem };

/** "SC-9 Slug Cannon Mk II · Cooled, Rapid". A plain Mk I part is just its name. */
export function specName(spec: ItemSpec): string {
  const tier = TIERS.names[spec.tier] ?? "";
  const mods = spec.mods.map((m) => MODS[m].name).join(", ");
  return `${itemName(spec.id)}${tier ? ` ${tier}` : ""}${mods ? ` · ${mods}` : ""}`;
}

/** The same for any two parts that are interchangeable. */
export const specKey = (spec: ItemSpec): string => `${spec.id}/${spec.tier}/${spec.mods.join("+")}`;

/** Read a part from stored data, or null if it is not one. Modifiers that do not fit are dropped. */
export function parseSpec(raw: unknown): ItemSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (!isWeaponId(id) && !isPlatingId(id)) return null;
  const tier = typeof r.tier === "number" && Number.isFinite(r.tier) ? Math.min(TIERS.max, Math.max(1, Math.floor(r.tier))) : 1;
  const given = Array.isArray(r.mods) ? r.mods : [];
  const mods = MOD_IDS.filter((m) => given.includes(m) && modFits(m, id)).slice(0, 2);
  return { id, tier, mods };
}

export function addItem(inventory: Inventory, spec: ItemSpec): Item {
  const uid = inventory.reduce((max, item) => Math.max(max, item.uid), 0) + 1;
  const item: Item = { uid, id: spec.id, tier: spec.tier, mods: [...spec.mods] };
  inventory.push(item);
  return item;
}

export function removeItem(inventory: Inventory, uid: number): boolean {
  const at = inventory.findIndex((item) => item.uid === uid);
  if (at < 0) return false;
  inventory.splice(at, 1);
  return true;
}

export const findItem = (inventory: Inventory, uid: number | undefined): Item | undefined => inventory.find((item) => item.uid === uid);

/** The uids a fit uses. */
export function fitUses(fit: Fit): number[] {
  const uids = HARDPOINT_IDS.map((id) => fit.weapons[id]).filter((uid): uid is number => uid !== undefined);
  return [...uids, fit.plating];
}

/** The tuned parts a fit puts on a mech. A missing item is left off; missing plating is stock. */
export function fitKit(fit: Fit, inventory: Inventory): Kit {
  const weapons: Kit["weapons"] = {};
  for (const id of HARDPOINT_IDS) {
    const item = findItem(inventory, fit.weapons[id]);
    if (item && isWeaponItem(item)) weapons[id] = tunedWeapon(item);
  }
  const plating = findItem(inventory, fit.plating);
  return { weapons, plating: plating && isPlatingItem(plating) ? tunedPlating(plating) : PLATING.standardPlating };
}

/** The part ids a fit puts on a mech (what the mech looks like, and what it would drop). */
export function fitLoadout(fit: Fit, inventory: Inventory): Loadout {
  const weapons: Loadout["weapons"] = {};
  for (const id of HARDPOINT_IDS) {
    const item = findItem(inventory, fit.weapons[id]);
    if (item && isWeaponItem(item)) weapons[id] = item.id;
  }
  const plating = findItem(inventory, fit.plating);
  return { weapons, plating: plating && isPlatingItem(plating) ? plating.id : "standardPlating" };
}

/** Reasons a fit cannot be deployed; empty means it is valid. */
export function fitProblems(frame: FrameDef, fit: Fit, inventory: Inventory): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const id of HARDPOINT_IDS) {
    const uid = fit.weapons[id];
    if (uid === undefined) continue;
    const item = findItem(inventory, uid);
    if (!item || !isWeaponItem(item)) problems.push("A fitted weapon is no longer in the store");
    else if (seen.has(uid)) problems.push(`${specName(item)} is fitted twice: a second one is needed`);
    seen.add(uid);
  }
  const plating = findItem(inventory, fit.plating);
  if (!plating || !isPlatingItem(plating)) problems.push("No plating fitted");
  return [...problems, ...kitProblems(frame, fitKit(fit, inventory))];
}

/** The same fit with anything the frame cannot mount taken off. */
export function fitToFrame(frame: FrameDef, fit: Fit, inventory: Inventory): Fit {
  const weapons = mountable(frame, fit.weapons, (uid) => {
    const item = findItem(inventory, uid);
    return item && isWeaponItem(item) ? WEAPONS[item.id] : undefined;
  });
  return { weapons, plating: fit.plating };
}

/**
 * A fit that matches a loadout, using items already in the inventory where it can (the best of
 * each kind first) and adding plain ones where it cannot.
 */
export function fitFromLoadout(loadout: Loadout, inventory: Inventory): Fit {
  const used = new Set<number>();
  const take = (id: ItemId): number => {
    const owned = inventory.filter((item) => item.id === id && !used.has(item.uid)).sort((a, b) => b.tier - a.tier || b.mods.length - a.mods.length);
    const item = owned[0] ?? addItem(inventory, plainSpec(id));
    used.add(item.uid);
    return item.uid;
  };
  const weapons: Fit["weapons"] = {};
  for (const id of HARDPOINT_IDS) {
    const weapon = loadout.weapons[id];
    if (weapon) weapons[id] = take(weapon);
  }
  return { weapons, plating: take(loadout.plating) };
}

export interface RollOdds {
  tierWeights: [number, number, number];
  modChance: number;
  secondModChance: number;
}

/** Roll the tier and modifiers of a part that has dropped. */
export function rollSpec(id: ItemId, rng: () => number, odds: RollOdds): ItemSpec {
  const total = odds.tierWeights.reduce((sum, w) => sum + w, 0);
  let pick = rng() * total;
  let tier = 1;
  for (let i = 0; i < odds.tierWeights.length; i++) {
    pick -= odds.tierWeights[i]!;
    if (odds.tierWeights[i]! > 0 && pick < 0) {
      tier = i + 1;
      break;
    }
  }
  const pool = MOD_IDS.filter((m) => modFits(m, id));
  const chosen: ModId[] = [];
  for (const chance of [odds.modChance, odds.secondModChance]) {
    if (pool.length === 0 || rng() >= chance) break;
    chosen.push(...pool.splice(Math.min(pool.length - 1, Math.floor(rng() * pool.length)), 1));
  }
  return { id, tier, mods: MOD_IDS.filter((m) => chosen.includes(m)) };
}
