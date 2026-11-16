import type { RosterSlot } from "./factions";
import type { Danger } from "./world";

/**
 * A squad written as jobs rather than pilots: whichever faction holds the site fills each job
 * from its own roster (`FACTIONS[id].roster`).
 */
export interface SquadDef {
  id: string;
  /** Patrol loop as [x, z] offsets from the centre of the site the squad guards. */
  patrol: [number, number][];
  /** One entry per mech; each starts at a different point on the loop. */
  members: RosterSlot[];
}

/** Tuning for how dangerous AI pilots are compared with the player. */
export const ENEMY_TUNING = {
  /** Multiplier on damage AI pilots deal to the player. */
  damageScale: 0.3,
  /** Multiplier on damage AI pilots deal to each other: higher, so their fights do not drag. */
  aiDamageScale: 0.7,
  /** Multiplier on enemy armor. */
  armorScale: 0.7,
  /**
   * How many enemies may fire on the player at once. The rest of an engaged group holds fire
   * and circles at long range until a slot opens. This is the main difficulty lever.
   */
  maxAttackers: 2,
};

/**
 * How much tougher pilots are in more dangerous regions, on top of `ENEMY_TUNING`. Strength
 * follows the place, not the player: the basin stays gentle and the far corners stay hard.
 */
export const DANGER: Record<Danger, { name: string; armorScale: number; damageScale: number }> = {
  1: { name: "low threat", armorScale: 1, damageScale: 1 },
  2: { name: "medium threat", armorScale: 1.2, damageScale: 1.25 },
  3: { name: "high threat", armorScale: 1.45, damageScale: 1.5 },
};

/** Loop a little way outside a site's walls. */
const PICKET_LOOP: [number, number][] = [
  [0, -70],
  [-90, -60],
  [-90, 40],
  [0, -110],
];

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
 * A site holds as many pilots as the war gives it (`troops`), filling these jobs in order, so
 * the first squad listed is the last to go short. Pilots sleep as plain records until the
 * player comes near (see `src/sim/population.ts`).
 */
export const GARRISONS = {
  /** The first outpost the player is sent against. */
  kestrelOutpost: [
    { id: "garrison", patrol: COMPOUND_LOOP, members: ["line", "heavy", "marksman"] },
    {
      id: "picket",
      // Outside the south gate, sweeping toward the wreck field and back.
      patrol: [
        [0, -60],
        [-80, -120],
        [-150, -70],
        [-70, -45],
      ],
      members: ["scout", "lancer"],
    },
  ],
  /** A lightly held outpost. */
  relayPost: [{ id: "garrison", patrol: COMPOUND_LOOP, members: ["line", "marksman", "lancer"] }],
  /** A faction's home: never taken, and where its raids are raised. */
  stronghold: [
    { id: "garrison", patrol: COMPOUND_LOOP, members: ["heavy", "line", "marksman", "line"] },
    { id: "picket", patrol: PICKET_LOOP, members: ["scout"] },
  ],
  /** The Combine's stronghold: two heavies inside, scouts outside. */
  citadel: [
    { id: "garrison", patrol: COMPOUND_LOOP, members: ["heavy", "heavy", "line", "marksman"] },
    { id: "picket", patrol: PICKET_LOOP, members: ["scout", "scout"] },
  ],
  /** Holding a base. */
  baseGuard: [{ id: "guard", patrol: PAD_LOOP, members: ["line", "rifle", "lancer"] }],
  /** A pair of scouts at a roadside camp. */
  camp: [{ id: "scouts", patrol: CAMP_LOOP, members: ["scout", "rifle"] }],
} satisfies Record<string, SquadDef[]>;

export type GarrisonId = keyof typeof GARRISONS;

/** How many pilots a garrison holds at full strength. */
export const garrisonCapacity = (id: GarrisonId): number => (GARRISONS[id] as SquadDef[]).reduce((n, squad) => n + squad.members.length, 0);

/** The jobs in a raiding party, filled in order up to the size of the raid. */
export const RAID_SQUAD: RosterSlot[] = ["line", "scout", "rifle", "heavy", "lancer", "line"];
