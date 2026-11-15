/** A circular area of terrain that is levelled so structures and spawns sit on flat ground. */
export interface FlatArea {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  seed: number;
  /** Side length of the square zone in metres. */
  size: number;
  /** Peak-to-trough height of the rolling terrain in metres. */
  relief: number;
  /** Horizontal size of the largest terrain features in metres. */
  featureSize: number;
  playerBase: FlatArea;
  enemyOutpost: FlatArea;
  wreckField: FlatArea;
  rockCount: number;
}

export const SLICE_ZONE: ZoneDef = {
  id: "ashfall-basin",
  name: "Ashfall Basin",
  seed: 20261113,
  size: 1000,
  relief: 46,
  featureSize: 220,
  playerBase: { id: "base", x: -300, z: -280, radius: 55 },
  enemyOutpost: { id: "outpost", x: 240, z: 230, radius: 75 },
  wreckField: { id: "wrecks", x: -20, z: 10, radius: 45 },
  rockCount: 70,
};

export const flatAreas = (zone: ZoneDef): FlatArea[] => [zone.playerBase, zone.enemyOutpost, zone.wreckField];
