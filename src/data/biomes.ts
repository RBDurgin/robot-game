export type RGB = readonly [number, number, number];

export type BiomeId = "basin" | "highlands" | "saltFlats" | "ruins";
export const BIOME_IDS: readonly BiomeId[] = ["basin", "highlands", "saltFlats", "ruins"];

/** What a scatter object is built from. All are boxes; the kind sets the proportions. */
export type ScatterKind = "rock" | "slab" | "pillar";

export interface ScatterDef {
  kind: ScatterKind;
  /** Objects per square kilometre where the biome is at full strength. */
  density: number;
  /** Smallest and largest height in metres. */
  size: readonly [number, number];
  color: RGB;
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Mean ground level in metres. */
  elevation: number;
  /** Peak-to-trough height of the terrain in metres. */
  relief: number;
  /** Horizontal size of the largest terrain features in metres. */
  featureSize: number;
  /** 0..1: how much of the relief comes from sharp ridges rather than smooth rolls. */
  ridge: number;
  /** Ground colours from the biome's lowest ground to its highest. */
  colors: { low: RGB; mid: RGB; high: RGB };
  /** Sky and haze. Fog distance hides chunks loading, so `end` must stay below the view range. */
  fog: { color: RGB; start: number; end: number };
  scatter: ScatterDef[];
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  basin: {
    id: "basin",
    name: "Basin",
    elevation: 0,
    relief: 46,
    featureSize: 220,
    ridge: 0.25,
    colors: { low: [0.33, 0.37, 0.25], mid: [0.5, 0.44, 0.33], high: [0.56, 0.55, 0.54] },
    fog: { color: [0.62, 0.71, 0.8], start: 220, end: 900 },
    scatter: [{ kind: "rock", density: 70, size: [2, 8], color: [0.44, 0.42, 0.4] }],
  },
  highlands: {
    id: "highlands",
    name: "Highlands",
    elevation: 70,
    relief: 120,
    featureSize: 520,
    ridge: 0.55,
    colors: { low: [0.3, 0.34, 0.27], mid: [0.43, 0.42, 0.4], high: [0.8, 0.82, 0.85] },
    fog: { color: [0.66, 0.73, 0.82], start: 260, end: 950 },
    scatter: [{ kind: "rock", density: 130, size: [3, 12], color: [0.4, 0.4, 0.41] }],
  },
  saltFlats: {
    id: "saltFlats",
    name: "Salt flats",
    elevation: -6,
    relief: 5,
    featureSize: 600,
    ridge: 0,
    colors: { low: [0.74, 0.72, 0.66], mid: [0.86, 0.85, 0.8], high: [0.93, 0.92, 0.89] },
    fog: { color: [0.8, 0.83, 0.85], start: 300, end: 950 },
    scatter: [{ kind: "rock", density: 6, size: [1.5, 4], color: [0.7, 0.68, 0.62] }],
  },
  ruins: {
    id: "ruins",
    name: "Ruins",
    elevation: 8,
    relief: 26,
    featureSize: 170,
    ridge: 0.1,
    colors: { low: [0.3, 0.31, 0.32], mid: [0.4, 0.4, 0.4], high: [0.5, 0.48, 0.45] },
    fog: { color: [0.55, 0.58, 0.6], start: 160, end: 760 },
    scatter: [
      { kind: "slab", density: 90, size: [4, 14], color: [0.42, 0.42, 0.43] },
      { kind: "pillar", density: 50, size: [8, 22], color: [0.34, 0.33, 0.33] },
      { kind: "rock", density: 30, size: [2, 5], color: [0.38, 0.37, 0.36] },
    ],
  },
};
