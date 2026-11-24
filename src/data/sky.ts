/**
 * The day and its light (`src/sim/sky.ts`). Times are fractions of a day: 0 is midnight, 0.5
 * noon. The day keyframe is the light the game had before there was a sky, so a clear noon looks
 * as it always did.
 */
export type RGB = readonly [number, number, number];

export interface SkyKey {
  /** Time of day, 0 to 1. */
  t: number;
  /** The directional light: the sun by day, the moon by night. */
  sun: number;
  sunColor: RGB;
  /** The hemispheric fill light. */
  sky: number;
  skyColor: RGB;
  /** The fill light's colour from below, as a share of its daytime colour. */
  ground: number;
  /** Multiplies the biome's fog colour, which is also the colour of the horizon. */
  fogTint: RGB;
  /** The colour overhead, as a multiple of the horizon colour. */
  zenith: RGB;
  /** How much stars show, 0 to 1. */
  stars: number;
  /** How well things can be seen, 0 (dark) to 1 (full daylight). Used by AI sight. */
  light: number;
}

const NIGHT = {
  sun: 0.3,
  sunColor: [0.55, 0.65, 1] as RGB,
  sky: 0.32,
  skyColor: [0.5, 0.58, 0.85] as RGB,
  ground: 0.4,
  fogTint: [0.15, 0.18, 0.29] as RGB,
  zenith: [0.55, 0.6, 0.85] as RGB,
  stars: 1,
  light: 0.2,
};

const LOW_SUN = {
  sun: 0.45,
  sunColor: [1, 0.62, 0.42] as RGB,
  sky: 0.42,
  skyColor: [0.95, 0.8, 0.75] as RGB,
  ground: 0.6,
  fogTint: [0.9, 0.62, 0.5] as RGB,
  zenith: [0.55, 0.6, 0.95] as RGB,
  stars: 0.15,
  light: 0.55,
};

const MORNING = {
  sun: 0.85,
  sunColor: [1, 0.92, 0.8] as RGB,
  sky: 0.6,
  skyColor: [1, 0.97, 0.94] as RGB,
  ground: 0.95,
  fogTint: [0.97, 0.93, 0.88] as RGB,
  zenith: [0.75, 0.82, 1] as RGB,
  stars: 0,
  light: 0.9,
};

const DAY = {
  sun: 0.95,
  sunColor: [1, 1, 1] as RGB,
  sky: 0.65,
  skyColor: [1, 1, 1] as RGB,
  ground: 1,
  fogTint: [1, 1, 1] as RGB,
  zenith: [0.72, 0.8, 1] as RGB,
  stars: 0,
  light: 1,
};

/** Where the phases of the day fall. Night is a quarter of the day, dawn and dusk a twentieth each. */
export const DAY_PHASES = {
  /** Night ends and dawn begins. */
  dawn: 0.125,
  /** Sunrise: the sun is on the horizon. */
  sunrise: 0.15,
  /** Dawn is over. */
  day: 0.175,
  /** Dusk begins. */
  dusk: 0.825,
  /** Sunset. */
  sunset: 0.85,
  /** Night begins. */
  night: 0.875,
} as const;

export const SKY = {
  /** Seconds of play in a whole day. */
  dayLength: 1200,
  /** Time of day a new game starts at: mid-morning. */
  start: 0.3,
  /** The sun's highest elevation, at noon, in radians. */
  noonElevation: 1.05,
  /** The sun's light never comes from lower than this (radians), so shadows stay within reach. */
  minElevation: 0.18,
  /** Where the sun stands at noon, as the direction its light travels (x, z). */
  noonFrom: { x: -0.45, z: 0.35 },
  /** How far the sun swings either side of its noon bearing between sunrise and sunset, radians. */
  swing: 1.2,
  /** The moon's light: elevation (radians) and bearing offset from the noon sun (radians). */
  moonElevation: 0.8,
  moonBearing: 1.9,
  /**
   * Keyframes over the day, interpolated linearly and wrapping at midnight. The light is dimmest
   * at the moment the sun hands over to the moon (`DAY_PHASES.night` and `.dawn`), so the jump
   * in shadow direction is hard to see.
   */
  keys: [
    { t: 0, ...NIGHT },
    { t: DAY_PHASES.dawn, ...NIGHT, sun: 0.1 },
    { t: DAY_PHASES.sunrise, ...LOW_SUN },
    { t: 0.2, ...MORNING },
    { t: 0.28, ...DAY },
    { t: 0.72, ...DAY },
    { t: 0.8, ...MORNING },
    { t: DAY_PHASES.sunset, ...LOW_SUN },
    { t: DAY_PHASES.night, ...NIGHT, sun: 0.1 },
  ] satisfies SkyKey[],
};

/** Named times a mission or the console can ask for. */
export const TIME_NAMES = { dawn: 0.15, morning: 0.3, noon: 0.5, dusk: 0.845, night: 0 } as const;
export type TimeName = keyof typeof TIME_NAMES;
