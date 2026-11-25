import type { BiomeId, RGB } from "./biomes";

/**
 * Storm fronts (`src/sim/weather.ts`). A front is a long band of weather that crosses the map in
 * a straight line. Play time is cut into slots, and each slot may start one front, so how often
 * storms come is `chance / slot`. Whether a front brings rain or dust depends on the ground under
 * it, so one front can be a rainstorm in the basin and a dust storm on the salt flats.
 */
export type WeatherKind = "rain" | "dust";

export interface WeatherLook {
  /** Fog start and end at full strength, as a share of the biome's own (never above 1). */
  fogStart: number;
  fogEnd: number;
  /** The fog colour turns toward this at full strength, by `colorMix`. */
  color: RGB;
  colorMix: number;
  /** Sunlight and fill light at full strength, as a share of the clear sky's. */
  sun: number;
  sky: number;
}

export const WEATHER = {
  /** Seconds of play per slot; each slot may start one front. */
  slot: 480,
  /** Chance that a slot starts a front. */
  chance: 0.8,
  /** A front starts within the first part of its slot, as a share of the slot. */
  startSpread: 0.5,
  /** Speed of travel, metres per second. */
  speed: [3, 5] as const,
  /** Half its length across its path, metres. */
  halfLength: [2000, 3200] as const,
  /** Half its depth along its path, metres: how long it takes to pass over. */
  halfDepth: [700, 1200] as const,
  /** Strength at its middle, 0 to 1. */
  strength: [0.65, 1] as const,
  /** How far from the middle of the world its path passes, at most, metres. */
  pathOffset: 2600,
  /** A front starts and ends this far beyond the middle of the world, before its depth, metres. */
  reach: 5800,
  /** The outer share of the band over which it fades to nothing. */
  edge: 0.7,
  /** Storm strength above which the HUD names the weather. */
  hudAbove: 0.2,
  /** Rain heavier than this brings lightning. */
  lightningAbove: 0.55,
  /** Lightning strikes per second at full rain. */
  lightningRate: 0.12,
  /** What each biome's weather is. */
  kinds: { basin: "rain", highlands: "rain", saltFlats: "dust", ruins: "dust" } satisfies Record<BiomeId, WeatherKind>,
  look: {
    rain: { fogStart: 0.2, fogEnd: 0.45, color: [0.4, 0.44, 0.49], colorMix: 0.7, sun: 0.35, sky: 0.75 },
    dust: { fogStart: 0.1, fogEnd: 0.35, color: [0.74, 0.6, 0.42], colorMix: 0.8, sun: 0.55, sky: 0.85 },
  } satisfies Record<WeatherKind, WeatherLook>,
};

/** Names for `?weather=` and `world.setWeather`. */
export const WEATHER_NAMES = ["clear", "storm", "rain", "dust"] as const;
export type WeatherName = (typeof WEATHER_NAMES)[number];
