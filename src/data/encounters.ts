import type { FactionId } from "./factions";
import type { FrameId } from "./frames";
import type { EnemyLoadoutId } from "./loadouts";
import type { AiRole } from "../sim/ai/brain";

export interface SquadMember {
  frame: FrameId;
  loadout: EnemyLoadoutId;
  role: AiRole;
}

export interface SquadDef {
  id: string;
  faction: FactionId;
  /** Patrol loop as [x, z] offsets from the enemy outpost centre. */
  patrol: [number, number][];
  /** One entry per mech; each starts at a different point on the loop. */
  members: SquadMember[];
}

/** Tuning for how dangerous enemy pilots are compared with the player. */
export const ENEMY_TUNING = {
  /** Multiplier on damage dealt by enemies. */
  damageScale: 0.3,
  /** Multiplier on enemy armor. */
  armorScale: 0.7,
  /**
   * How many enemies may fire on the player at once. The rest of an engaged group holds fire
   * and circles at long range until a slot opens. This is the main difficulty lever.
   */
  maxAttackers: 2,
};

export const SLICE_SQUADS: SquadDef[] = [
  {
    id: "garrison",
    faction: "combine",
    // Loop around the inside of the compound walls, clear of the bunker.
    patrol: [
      [-24, -24],
      [24, -24],
      [24, 26],
      [-24, 26],
    ],
    members: [
      { frame: "medium", loadout: "trooper", role: "line" },
      { frame: "heavy", loadout: "bombard", role: "support" },
      { frame: "medium", loadout: "marksman", role: "line" },
    ],
  },
  {
    id: "picket",
    faction: "combine",
    // Outside the south gate, sweeping toward the wreck field and back.
    patrol: [
      [0, -60],
      [-80, -120],
      [-150, -70],
      [-70, -45],
    ],
    members: [
      { frame: "light", loadout: "skirmisher", role: "skirmisher" },
      { frame: "light", loadout: "lancer", role: "line" },
    ],
  },
];
