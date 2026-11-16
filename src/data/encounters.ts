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
  /** Patrol loop as [x, z] offsets from the centre of the site the squad guards. */
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

/** Loop around the inside of an outpost's compound walls, clear of the bunker. */
const COMPOUND_LOOP: [number, number][] = [
  [-24, -24],
  [24, -24],
  [24, 26],
  [-24, 26],
];
/** Loop around a base's landing pad. */
const PAD_LOOP: [number, number][] = [
  [-22, 20],
  [22, 20],
  [22, -18],
  [-22, -18],
];
/** A wide loop around a small camp. */
const CAMP_LOOP: [number, number][] = [
  [-26, 0],
  [0, 26],
  [26, 0],
  [0, -26],
];

/**
 * The squads that guard a site, by garrison id. A site in `src/data/world.ts` names one of these.
 * Members sleep as plain records until the player comes near (see `src/sim/population.ts`).
 */
export const GARRISONS = {
  /** The first outpost the player is sent against. */
  kestrelOutpost: [
    {
      id: "garrison",
      faction: "combine",
      patrol: COMPOUND_LOOP,
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
  ],
  /** A lightly held outpost. */
  relayPost: [
    {
      id: "garrison",
      faction: "combine",
      patrol: COMPOUND_LOOP,
      members: [
        { frame: "medium", loadout: "trooper", role: "line" },
        { frame: "medium", loadout: "marksman", role: "line" },
        { frame: "light", loadout: "lancer", role: "skirmisher" },
      ],
    },
  ],
  /** The Combine's stronghold: two heavies inside, scouts outside. */
  citadel: [
    {
      id: "garrison",
      faction: "combine",
      patrol: COMPOUND_LOOP,
      members: [
        { frame: "heavy", loadout: "bombard", role: "support" },
        { frame: "heavy", loadout: "bombard", role: "support" },
        { frame: "medium", loadout: "trooper", role: "line" },
        { frame: "medium", loadout: "marksman", role: "line" },
      ],
    },
    {
      id: "picket",
      faction: "combine",
      patrol: [
        [0, -70],
        [-90, -60],
        [-90, 40],
        [0, -110],
      ],
      members: [
        { frame: "light", loadout: "skirmisher", role: "skirmisher" },
        { frame: "light", loadout: "skirmisher", role: "skirmisher" },
      ],
    },
  ],
  /** Holding a base the player can take. */
  baseGuard: [
    {
      id: "guard",
      faction: "combine",
      patrol: PAD_LOOP,
      members: [
        { frame: "medium", loadout: "trooper", role: "line" },
        { frame: "medium", loadout: "rifleman", role: "line" },
        { frame: "light", loadout: "lancer", role: "skirmisher" },
      ],
    },
  ],
  /** A pair of scouts at a roadside camp. */
  camp: [
    {
      id: "scouts",
      faction: "combine",
      patrol: CAMP_LOOP,
      members: [
        { frame: "light", loadout: "skirmisher", role: "skirmisher" },
        { frame: "medium", loadout: "rifleman", role: "line" },
      ],
    },
  ],
} satisfies Record<string, SquadDef[]>;

export type GarrisonId = keyof typeof GARRISONS;
