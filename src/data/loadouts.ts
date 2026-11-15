import type { PlatingId } from "./parts";
import type { WeaponId } from "./weapons";

/** What a mech carries. Arms hold one weapon each (or nothing). */
export interface Loadout {
  armL: WeaponId | null;
  armR: WeaponId | null;
  plating: PlatingId;
}

export const STARTING_LOADOUT: Loadout = { armL: "arcLauncher", armR: "pulseRifle", plating: "standardPlating" };

/** Loadouts used by enemy pilots. */
export const ENEMY_LOADOUTS = {
  rifleman: { armL: null, armR: "pulseRifle", plating: "standardPlating" },
  trooper: { armL: "arcLauncher", armR: "pulseRifle", plating: "standardPlating" },
  marksman: { armL: null, armR: "slugCannon", plating: "lightPlating" },
  skirmisher: { armL: "swarmPod", armR: "pulseRifle", plating: "lightPlating" },
} satisfies Record<string, Loadout>;

export type EnemyLoadoutId = keyof typeof ENEMY_LOADOUTS;
