import type { WeaponDef } from "./weapons";

/**
 * Part tiers. Every tier above the first adds `step` to a weapon's damage or a plating's armor.
 * Kept modest on purpose: a Mk I part stays usable, a Mk III is a find rather than a necessity.
 */
export const TIERS = {
  max: 3,
  step: 0.08,
  names: ["", "", "Mk II", "Mk III"],
};

/** The numbers a modifier can scale. */
export type ModStat = "heat" | "mass" | "range" | "spread" | "cooldown" | "armorScale";

export interface ModDef {
  name: string;
  /** What kind of part can carry it. */
  fits: "weapon" | "plating" | "any";
  /** Multipliers on the part's numbers. */
  scale: Partial<Record<ModStat, number>>;
  /** Weapon kinds it means nothing on (a beam has no cooldown to shorten). */
  notKinds?: WeaponDef["kind"][];
  description: string;
}

/** Modifiers a dropped part can carry. A part has at most two, never the same one twice. */
export const MODS = {
  cooled: { name: "Cooled", fits: "weapon", scale: { heat: 0.85 }, description: "Runs 15% cooler." },
  light: { name: "Lightweight", fits: "any", scale: { mass: 0.85 }, description: "15% lighter." },
  longRange: { name: "Long-barrel", fits: "weapon", scale: { range: 1.15 }, description: "15% more range." },
  steady: { name: "Stabilised", fits: "weapon", scale: { spread: 0.75 }, description: "A quarter less spread." },
  rapid: { name: "Rapid", fits: "weapon", scale: { cooldown: 0.9 }, notKinds: ["beam"], description: "Cycles 10% faster." },
  reinforced: { name: "Reinforced", fits: "plating", scale: { armorScale: 1.06 }, description: "6% more armor." },
} satisfies Record<string, ModDef>;

export type ModId = keyof typeof MODS;
export const MOD_IDS = Object.keys(MODS) as ModId[];
