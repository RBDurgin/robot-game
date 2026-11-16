import type { BiomeId } from "./biomes";
import type { GarrisonId } from "./encounters";

/**
 * - base: a pad and hangar. Held bases offer the hangar, respawn and fast travel.
 * - outpost: a walled enemy compound.
 * - camp: a small enemy picket.
 * - wreck: debris from an old battle; cover, sometimes salvage.
 * - depot: an abandoned supply cache.
 * - landmark: something to navigate by.
 */
export type SiteKind = "base" | "outpost" | "camp" | "wreck" | "depot" | "landmark";

/** Which arrangement of blocks stands on a site (see `src/data/siteLayouts.ts`). */
export type LayoutId = "base" | "outpost" | "camp" | "wreckField" | "depot" | "spire" | "arch" | "dish" | "hulk";

/** A point of interest. The ground inside `radius` is levelled so structures and spawns sit flat. */
export interface SiteDef {
  id: string;
  name: string;
  kind: SiteKind;
  layout: LayoutId;
  x: number;
  z: number;
  radius: number;
  /** Enemy squads guarding the site. */
  garrison?: GarrisonId;
  /** Bases only: held by the player from the start. */
  held?: boolean;
  /** Number of salvage crates lying here until the player takes them. */
  cache?: number;
}

/** A named region. Each point of the world belongs to the nearest region and takes its biome. */
export interface RegionDef {
  id: string;
  name: string;
  biome: BiomeId;
  x: number;
  z: number;
}

/** Seeded placement of minor sites: `count` of them, on the given biomes, spaced apart. */
export interface PlacementRule {
  kind: SiteKind;
  layout: LayoutId;
  count: number;
  biomes: BiomeId[];
  radius: number;
  garrison?: GarrisonId;
  cache?: number;
  /** Names are used in order. */
  names: string[];
}

export interface WorldDef {
  id: string;
  name: string;
  seed: number;
  /** Side length of the square world in metres. A whole number of chunks. */
  size: number;
  /** Side length of one streamed terrain chunk in metres. */
  chunkSize: number;
  /** Terrain cells along one side of a chunk at full detail. */
  chunkCells: number;
  /** The mountain wall around the edge of the world. */
  rim: { width: number; height: number };
  /** How close to the edge a mech may go, in metres. */
  edgeMargin: number;
  /** Width in metres of the band over which neighbouring biomes blend. */
  biomeBlend: number;
  /** How far region borders wander from straight lines, in metres. */
  borderWarp: number;
  /** Minimum distance between any two sites placed by rules. */
  siteSpacing: number;
  regions: RegionDef[];
  /** Hand-placed key sites. */
  sites: SiteDef[];
  /** Rules for the minor sites that fill in between. */
  placement: PlacementRule[];
  /** The base a new game starts at. */
  homeBase: string;
  /** The outpost the opening mission sends the player against. */
  missionOutpost: string;
}

/**
 * Chunk size was chosen from the collider streaming prototype (phase 3, step 1): a Havok
 * heightfield for a 256 m chunk of 40 x 40 cells takes about 0.15 ms to create and 0.03 ms to
 * remove, where a triangle-mesh collider of the same chunk takes 7 ms.
 */
export const WORLD: WorldDef = {
  id: "ashfall",
  name: "The Ashfall Marches",
  seed: 20261113,
  size: 8192,
  chunkSize: 256,
  chunkCells: 40,
  rim: { width: 520, height: 330 },
  edgeMargin: 230,
  biomeBlend: 320,
  borderWarp: 330,
  siteSpacing: 650,
  regions: [
    { id: "ashfall-basin", name: "Ashfall Basin", biome: "basin", x: 0, z: 0 },
    { id: "mirror-pan", name: "Mirror Pan", biome: "saltFlats", x: -2500, z: -2500 },
    { id: "sunken-quarter", name: "Sunken Quarter", biome: "ruins", x: 100, z: -2700 },
    { id: "cinder-reach", name: "Cinder Reach", biome: "basin", x: 2600, z: -2400 },
    { id: "greywall", name: "Greywall Highlands", biome: "highlands", x: -2700, z: 100 },
    { id: "old-meridian", name: "Old Meridian", biome: "ruins", x: 2700, z: 200 },
    { id: "tarn-heights", name: "Tarn Heights", biome: "highlands", x: -2400, z: 2600 },
    { id: "white-reach", name: "White Reach", biome: "saltFlats", x: 200, z: 2700 },
    { id: "kestrel-rise", name: "Kestrel Rise", biome: "highlands", x: 2600, z: 2600 },
  ],
  sites: [
    // Ashfall Basin: where the game starts.
    { id: "drifters-rest", name: "Drifters' Rest", kind: "base", layout: "base", x: -300, z: -280, radius: 55, held: true },
    { id: "kestrel-outpost", name: "Kestrel Outpost", kind: "outpost", layout: "outpost", x: 240, z: 230, radius: 75, garrison: "kestrelOutpost" },
    { id: "ashfall-wrecks", name: "Ashfall Wreck Field", kind: "wreck", layout: "wreckField", x: -20, z: 10, radius: 45 },
    // Bases to take: each becomes a fast-travel point once its guards are gone.
    { id: "saltwatch", name: "Saltwatch Station", kind: "base", layout: "base", x: -2250, z: -2150, radius: 55, garrison: "baseGuard" },
    { id: "meridian-gate", name: "Meridian Gate", kind: "base", layout: "base", x: 2350, z: 350, radius: 55, garrison: "baseGuard" },
    { id: "tarn-lookout", name: "Tarn Lookout", kind: "base", layout: "base", x: -2050, z: 2350, radius: 55 },
    { id: "cinder-station", name: "Cinder Station", kind: "base", layout: "base", x: 2250, z: -2150, radius: 55, garrison: "baseGuard" },
    // Enemy strongholds.
    { id: "citadel", name: "Combine Citadel", kind: "outpost", layout: "outpost", x: 2500, z: 2450, radius: 80, garrison: "citadel" },
    { id: "quarry-post", name: "Quarry Post", kind: "outpost", layout: "outpost", x: -2450, z: 350, radius: 75, garrison: "relayPost" },
    { id: "pan-relay", name: "Pan Relay", kind: "outpost", layout: "outpost", x: 350, z: 2550, radius: 75, garrison: "relayPost" },
    // Landmarks.
    { id: "the-needle", name: "The Needle", kind: "landmark", layout: "spire", x: 150, z: -2550, radius: 18 },
    { id: "broken-span", name: "Broken Span", kind: "landmark", layout: "arch", x: -1500, z: 1250, radius: 22 },
    { id: "listening-dish", name: "The Listening Dish", kind: "landmark", layout: "dish", x: -1250, z: -1500, radius: 20 },
    { id: "fallen-carrier", name: "The Fallen Carrier", kind: "landmark", layout: "hulk", x: 1350, z: 1150, radius: 40, cache: 2 },
  ],
  placement: [
    {
      kind: "camp",
      layout: "camp",
      count: 5,
      biomes: ["basin", "highlands", "ruins", "saltFlats"],
      radius: 34,
      garrison: "camp",
      names: ["Dust Camp", "Ridge Camp", "Rubble Camp", "Brine Camp", "Hollow Camp"],
    },
    {
      kind: "depot",
      layout: "depot",
      count: 5,
      biomes: ["basin", "ruins", "saltFlats"],
      radius: 26,
      cache: 2,
      names: ["Depot Seven", "Depot Twelve", "Lost Cache", "Smuggler's Store", "Depot Nineteen"],
    },
    {
      kind: "wreck",
      layout: "wreckField",
      count: 5,
      biomes: ["basin", "highlands", "saltFlats", "ruins"],
      radius: 40,
      cache: 1,
      names: ["Burnt Column", "Lancer's Grave", "The Long Retreat", "Scuttled Convoy", "Last Stand"],
    },
    {
      kind: "landmark",
      layout: "spire",
      count: 3,
      biomes: ["highlands", "saltFlats"],
      radius: 18,
      names: ["Wind Spire", "Salt Marker", "Surveyor's Mast"],
    },
    {
      kind: "landmark",
      layout: "arch",
      count: 2,
      biomes: ["ruins", "basin"],
      radius: 22,
      names: ["Old Gate", "Toll Arch"],
    },
  ],
  homeBase: "drifters-rest",
  missionOutpost: "kestrel-outpost",
};
