import type { AiRole } from "../sim/ai/brain";
import type { FrameId } from "./frames";
import type { EnemyLoadoutId } from "./loadouts";

/** Colours are 0xRRGGBB. */
export interface ColorScheme {
  primary: number;
  secondary: number;
  accent: number;
}

/** One pilot of a squad: the suit, what it carries and how it fights. */
export interface SquadMember {
  frame: FrameId;
  loadout: EnemyLoadoutId;
  role: AiRole;
}

/**
 * The jobs in a squad. Garrisons and raids are written in these (see `src/data/encounters.ts`);
 * each faction fills a job with its own kind of pilot, which is what gives it a fighting style.
 */
export type RosterSlot = "line" | "heavy" | "marksman" | "scout" | "lancer" | "rifle";

export interface FactionDef {
  id: string;
  name: string;
  /** Short form for the HUD and the map. */
  short: string;
  colors: ColorScheme;
  /** Faction ids this faction attacks on sight. */
  hostileTo: string[];
  /** One line for the map: how this faction fights. */
  style: string;
  /** Who fills each squad job. Absent for the player's own faction, which fields no squads. */
  roster?: Record<RosterSlot, SquadMember>;
  /** The player's standing with the faction in a new game (see `REPUTATION` in `src/data/war.ts`). */
  startStanding?: number;
}

export const FACTIONS = {
  /** The player: an independent pilot. Who is hostile to them depends on standing, not on this row. */
  freelancer: {
    id: "freelancer",
    name: "Freelancer",
    short: "You",
    colors: { primary: 0xc9772b, secondary: 0x3a3f47, accent: 0x6fe3ff },
    hostileTo: [],
    style: "Independent.",
  },
  drifters: {
    id: "drifters",
    name: "Drifter Compact",
    short: "Drifters",
    colors: { primary: 0xb9a15a, secondary: 0x3c4a4f, accent: 0x7dffd0 },
    hostileTo: ["combine", "syndicate"],
    style: "Mobile mid-range suits that keep their distance.",
    roster: {
      line: { frame: "medium", loadout: "rifleman", role: "line" },
      heavy: { frame: "medium", loadout: "trooper", role: "line" },
      marksman: { frame: "medium", loadout: "marksman", role: "line" },
      scout: { frame: "light", loadout: "lancer", role: "skirmisher" },
      lancer: { frame: "light", loadout: "lancer", role: "line" },
      rifle: { frame: "light", loadout: "raider", role: "skirmisher" },
    },
    startStanding: 45,
  },
  combine: {
    id: "combine",
    name: "Kestrel Combine",
    short: "Combine",
    colors: { primary: 0x7b2230, secondary: 0x24262b, accent: 0xff5a3c },
    hostileTo: ["drifters", "wardens", "syndicate"],
    style: "Combined arms: line suits in front, siege suits behind.",
    roster: {
      line: { frame: "medium", loadout: "trooper", role: "line" },
      heavy: { frame: "heavy", loadout: "bombard", role: "support" },
      marksman: { frame: "medium", loadout: "marksman", role: "line" },
      scout: { frame: "light", loadout: "skirmisher", role: "skirmisher" },
      lancer: { frame: "light", loadout: "lancer", role: "line" },
      rifle: { frame: "medium", loadout: "rifleman", role: "line" },
    },
    startStanding: -60,
  },
  wardens: {
    id: "wardens",
    name: "Greywall Wardens",
    short: "Wardens",
    colors: { primary: 0x4f6b4a, secondary: 0x2b3030, accent: 0xe8d36a },
    hostileTo: ["combine", "syndicate"],
    style: "Heavy suits that dig in and hold ground.",
    roster: {
      line: { frame: "heavy", loadout: "bulwark", role: "line" },
      heavy: { frame: "heavy", loadout: "bombard", role: "support" },
      marksman: { frame: "medium", loadout: "marksman", role: "support" },
      scout: { frame: "medium", loadout: "brawler", role: "line" },
      lancer: { frame: "medium", loadout: "marksman", role: "line" },
      rifle: { frame: "medium", loadout: "trooper", role: "line" },
    },
    startStanding: 5,
  },
  syndicate: {
    id: "syndicate",
    name: "Emberline Syndicate",
    short: "Syndicate",
    colors: { primary: 0x5b3a8c, secondary: 0x1f2233, accent: 0xff9a2e },
    hostileTo: ["drifters", "combine", "wardens"],
    style: "Light raiders that close in fast and swarm.",
    roster: {
      line: { frame: "light", loadout: "raider", role: "skirmisher" },
      heavy: { frame: "medium", loadout: "brawler", role: "skirmisher" },
      marksman: { frame: "light", loadout: "lancer", role: "line" },
      scout: { frame: "light", loadout: "skirmisher", role: "skirmisher" },
      lancer: { frame: "light", loadout: "lancer", role: "skirmisher" },
      rifle: { frame: "light", loadout: "raider", role: "skirmisher" },
    },
    startStanding: -30,
  },
} satisfies Record<string, FactionDef>;

export type FactionId = keyof typeof FACTIONS;
/** The faction the player's suit belongs to. */
export const PLAYER_FACTION = "freelancer" satisfies FactionId;
/** The factions that hold territory and fight the war. */
export type WarFactionId = Exclude<FactionId, typeof PLAYER_FACTION>;
export const WAR_FACTION_IDS = (Object.keys(FACTIONS) as FactionId[]).filter((id): id is WarFactionId => id !== PLAYER_FACTION);
export const isWarFactionId = (id: unknown): id is WarFactionId => typeof id === "string" && (WAR_FACTION_IDS as string[]).includes(id);

/** Whether two factions attack each other on sight. The player's relations are in `src/sim/reputation.ts`. */
export const areHostile = (a: FactionId, b: FactionId): boolean =>
  (FACTIONS[a].hostileTo as string[]).includes(b) || (FACTIONS[b].hostileTo as string[]).includes(a);

/** A faction colour as a CSS colour. */
export const cssColor = (rgb: number): string => `#${rgb.toString(16).padStart(6, "0")}`;
