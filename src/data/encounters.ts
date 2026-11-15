import type { FactionId } from "./factions";
import type { FrameId } from "./frames";
import type { EnemyLoadoutId } from "./loadouts";

export interface SquadDef {
  id: string;
  faction: FactionId;
  frame: FrameId;
  /** Patrol loop as [x, z] offsets from the enemy outpost centre. */
  patrol: [number, number][];
  /** One entry per mech; each starts at a different point on the loop. */
  members: EnemyLoadoutId[];
}

/** Tuning for how dangerous enemy pilots are compared with the player. */
export const ENEMY_TUNING = {
  /** Multiplier on damage dealt by enemies. */
  damageScale: 0.4,
  /** Multiplier on enemy armor. */
  armorScale: 0.7,
};

export const SLICE_SQUADS: SquadDef[] = [
  {
    id: "garrison",
    faction: "combine",
    frame: "medium",
    // Loop around the inside of the compound walls, clear of the bunker.
    patrol: [
      [-24, -24],
      [24, -24],
      [24, 26],
      [-24, 26],
    ],
    members: ["trooper", "rifleman", "marksman"],
  },
  {
    id: "picket",
    faction: "combine",
    frame: "medium",
    // Outside the south gate, sweeping toward the wreck field and back.
    patrol: [
      [0, -60],
      [-80, -120],
      [-150, -70],
      [-70, -45],
    ],
    members: ["skirmisher", "rifleman"],
  },
];
