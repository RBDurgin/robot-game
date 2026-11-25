import { BIOME_IDS, type RGB } from "../data/biomes";
import { WEATHER, WEATHER_NAMES, type WeatherKind, type WeatherName } from "../data/weather";
import type { WorldDef } from "../data/world";
import { lerp, makeRng, smoothstep } from "./math";
import { biomeWeights } from "./terrain";

/**
 * Storm fronts. Which fronts exist, and where each one is, are a pure function of the world
 * seed and seconds of play (`SkyClock.seconds`), so the weather needs nothing saved and time a
 * mission skips leaves it alone.
 */

/** A front's path across the world: where it starts, which way it goes, and how big it is. */
export interface FrontPath {
  /** The slot that started it; unique. */
  id: number;
  /** Seconds of play when it sets out, and how long until it is gone. */
  start: number;
  duration: number;
  x0: number;
  z0: number;
  /** Yaw of its travel (0 is +Z, positive toward +X). */
  heading: number;
  speed: number;
  halfLength: number;
  halfDepth: number;
  strength: number;
}

/** A front where it is now. */
export interface Front extends FrontPath {
  x: number;
  z: number;
}

/** The weather at one place. */
export interface WeatherSample {
  /** How stormy, 0 (clear) to 1. */
  storm: number;
  /** The share of that storm that falls as rain and as dust; they add up to `storm`. */
  rain: number;
  dust: number;
  /** The wind: the way the strongest front here travels, and its speed (m/s). */
  heading: number;
  wind: number;
}

export const CLEAR: WeatherSample = { storm: 0, rain: 0, dust: 0, heading: 0, wind: 0 };

const range = (r: readonly [number, number], u: number): number => r[0] + (r[1] - r[0]) * u;

/** The front a slot starts, or null if it starts none. */
export function slotFront(seed: number, slot: number): FrontPath | null {
  const rng = makeRng((seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0);
  if (rng() >= WEATHER.chance) return null;
  const start = (slot + rng() * WEATHER.startSpread) * WEATHER.slot;
  const heading = rng() * Math.PI * 2;
  const speed = range(WEATHER.speed, rng());
  const halfLength = range(WEATHER.halfLength, rng());
  const halfDepth = range(WEATHER.halfDepth, rng());
  const strength = range(WEATHER.strength, rng());
  // The path passes this far to one side of the middle of the world.
  const offset = (rng() * 2 - 1) * WEATHER.pathOffset;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const back = WEATHER.reach + halfDepth;
  return {
    id: slot,
    start,
    duration: (2 * back) / speed,
    x0: fz * offset - fx * back,
    z0: -fx * offset - fz * back,
    heading,
    speed,
    halfLength,
    halfDepth,
    strength,
  };
}

/** The longest a front can last, seconds. */
const LONGEST = (2 * (WEATHER.reach + WEATHER.halfDepth[1])) / WEATHER.speed[0];
const SLOTS_BACK = Math.ceil(LONGEST / WEATHER.slot) + 1;

/** Every front on the move at this many seconds of play. */
export function frontsAt(seed: number, seconds: number): Front[] {
  const out: Front[] = [];
  const now = Math.floor(seconds / WEATHER.slot);
  for (let slot = Math.max(0, now - SLOTS_BACK); slot <= now; slot++) {
    const path = slotFront(seed, slot);
    if (!path) continue;
    const age = seconds - path.start;
    if (age < 0 || age >= path.duration) continue;
    const d = age * path.speed;
    out.push({ ...path, x: path.x0 + Math.sin(path.heading) * d, z: path.z0 + Math.cos(path.heading) * d });
  }
  return out;
}

/** How strong one front is at a place, 0 to its strength: full in its middle, fading at its edge. */
export function frontStrength(front: Front, x: number, z: number): number {
  const dx = x - front.x;
  const dz = z - front.z;
  const fx = Math.sin(front.heading);
  const fz = Math.cos(front.heading);
  const along = (dx * fx + dz * fz) / front.halfDepth;
  const across = (dx * fz - dz * fx) / front.halfLength;
  const e = Math.hypot(along, across);
  return front.strength * (1 - smoothstep(1 - WEATHER.edge, 1, e));
}

const scratch = new Float32Array(BIOME_IDS.length);

/** The share of the weather at a place that is rain, from the biomes there. */
export function rainShare(def: WorldDef, x: number, z: number): number {
  const w = biomeWeights(def, x, z, scratch);
  let rain = 0;
  BIOME_IDS.forEach((id, i) => {
    if (WEATHER.kinds[id] === "rain") rain += w[i]!;
  });
  return rain;
}

/** The weather at a place, from the fronts on the move. Overlapping fronts do not add up. */
export function weatherAt(def: WorldDef, fronts: readonly Front[], x: number, z: number): WeatherSample {
  let storm = 0;
  let strongest: Front | null = null;
  for (const f of fronts) {
    const s = frontStrength(f, x, z);
    if (s > storm) {
      storm = s;
      strongest = f;
    }
  }
  if (!strongest) return CLEAR;
  const rain = storm * rainShare(def, x, z);
  return { storm, rain, dust: storm - rain, heading: strongest.heading, wind: strongest.speed };
}

/** Weather forced by `?weather=` or the console: a storm strength, and its kind if named. */
export interface ForcedWeather {
  storm: number;
  kind?: WeatherKind;
}

/** Reads "clear", "storm", "rain", "dust" or a strength from 0 to 1; null if it is none of those. */
export function parseWeather(v: unknown): ForcedWeather | null {
  if (typeof v === "string" && (WEATHER_NAMES as readonly string[]).includes(v)) {
    const name = v as WeatherName;
    if (name === "clear") return { storm: 0 };
    if (name === "storm") return { storm: 1 };
    return { storm: 1, kind: name };
  }
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? { storm: n } : null;
}

/** The weather at a place with a forced strength (and kind), keeping the natural wind if any. */
export function forceWeather(def: WorldDef, natural: WeatherSample, forced: ForcedWeather, x: number, z: number): WeatherSample {
  const share = forced.kind === "rain" ? 1 : forced.kind === "dust" ? 0 : rainShare(def, x, z);
  const rain = forced.storm * share;
  return { storm: forced.storm, rain, dust: forced.storm - rain, heading: natural.heading, wind: natural.wind || 5 };
}

/** Fog thickened by weather: it only ever starts and ends nearer, and turns toward the storm's colour. */
export function weatherFog(start: number, end: number, color: RGB, w: WeatherSample): { start: number; end: number; color: RGB } {
  const { rain, dust } = WEATHER.look;
  const r = w.rain;
  const d = w.dust;
  const startK = 1 - r * (1 - rain.fogStart) - d * (1 - dust.fogStart);
  const endK = 1 - r * (1 - rain.fogEnd) - d * (1 - dust.fogEnd);
  const rk = r * rain.colorMix;
  const dk = d * dust.colorMix;
  const mixed = (i: 0 | 1 | 2): number => lerp(color[i], (rain.color[i] * rk + dust.color[i] * dk) / (rk + dk || 1), Math.min(1, rk + dk));
  return { start: start * Math.min(1, startK), end: end * Math.min(1, endK), color: [mixed(0), mixed(1), mixed(2)] };
}

/** How much of the sunlight and fill light gets through the weather, 0 to 1. */
export function weatherLight(w: WeatherSample): { sun: number; sky: number } {
  const { rain, dust } = WEATHER.look;
  return { sun: 1 - w.rain * (1 - rain.sun) - w.dust * (1 - dust.sun), sky: 1 - w.rain * (1 - rain.sky) - w.dust * (1 - dust.sky) };
}

/** The kind of weather a sample mostly is, or null when it is clear enough not to mention. */
export function weatherName(w: WeatherSample): WeatherKind | null {
  if (w.storm < WEATHER.hudAbove) return null;
  return w.rain >= w.dust ? "rain" : "dust";
}
