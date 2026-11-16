import type { HardpointId } from "./frames";
import type { PlatingId } from "./parts";
import type { WeaponId } from "./weapons";

/** What a mech carries: at most one weapon per hardpoint of its frame, and plating. */
export interface Loadout {
  weapons: Partial<Record<HardpointId, WeaponId>>;
  plating: PlatingId;
}

export const STARTING_LOADOUT: Loadout = { weapons: { armL: "arcLauncher", armR: "pulseRifle" }, plating: "standardPlating" };

/** Loadouts used by enemy pilots. */
export const ENEMY_LOADOUTS = {
  rifleman: { weapons: { armR: "pulseRifle" }, plating: "standardPlating" },
  trooper: { weapons: { armL: "arcLauncher", armR: "pulseRifle" }, plating: "standardPlating" },
  marksman: { weapons: { armR: "slugCannon" }, plating: "lightPlating" },
  skirmisher: { weapons: { armL: "swarmPod", armR: "scatterGun" }, plating: "lightPlating" },
  lancer: { weapons: { armR: "lanceBeam" }, plating: "lightPlating" },
  bombard: { weapons: { armR: "slugCannon", shoulderR: "seekerRack", shoulderL: "seekerRack" }, plating: "heavyPlating" },
} satisfies Record<string, Loadout>;

export type EnemyLoadoutId = keyof typeof ENEMY_LOADOUTS;
