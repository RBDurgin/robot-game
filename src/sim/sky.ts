import { LIGHTS } from "../data/lights";
import { DAY_PHASES, SKY, TIME_NAMES, type RGB, type SkyKey, type TimeName } from "../data/sky";

/**
 * The time of day. `seconds` is play time since the game began (weather follows it); `offset`
 * is time skipped by a mission ("the hours pass"), which moves the sun but not the weather.
 */
export interface SkyClock {
  seconds: number;
  offset: number;
}

export type DayPhase = "night" | "dawn" | "day" | "dusk";

export const freshSkyClock = (): SkyClock => ({ seconds: 0, offset: 0 });

const frac = (v: number): number => v - Math.floor(v);

/** Time of day from 0 (midnight) through 0.5 (noon) to 1. */
export const timeOfDay = (clock: SkyClock): number => frac(SKY.start + (clock.seconds + clock.offset) / SKY.dayLength);

export function dayPhase(t: number): DayPhase {
  if (t < DAY_PHASES.dawn || t >= DAY_PHASES.night) return "night";
  if (t < DAY_PHASES.day) return "dawn";
  if (t < DAY_PHASES.dusk) return "day";
  return "dusk";
}

/** Move the clock forward (never back) to the given time of day. */
export function skipTo(clock: SkyClock, t: number): void {
  const ahead = frac(t - timeOfDay(clock));
  clock.offset += ahead * SKY.dayLength;
}

/** A time of day by name ("dusk") or as a number, or null if it is neither. */
export function parseTime(v: unknown): number | null {
  if (typeof v === "string" && v in TIME_NAMES) return TIME_NAMES[v as TimeName];
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? frac(n) : null;
}

/** A clock read from a save, or a fresh one. */
export function parseSkyClock(v: unknown): SkyClock {
  const c = (v && typeof v === "object" ? v : {}) as Partial<SkyClock>;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  return { seconds: ok(c.seconds) ? c.seconds : 0, offset: ok(c.offset) ? c.offset : 0 };
}

export interface SkyState {
  t: number;
  phase: DayPhase;
  /** The direction the directional light travels (unit vector, pointing down). */
  lightDir: { x: number; y: number; z: number };
  /** True while the directional light is the moon. */
  moon: boolean;
  sun: number;
  sunColor: RGB;
  sky: number;
  skyColor: RGB;
  ground: number;
  fogTint: RGB;
  zenith: RGB;
  stars: number;
  light: number;
}

const mixRGB = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** The keyframes either side of `t` and how far between them it is, wrapping at midnight. */
function bracket(keys: readonly SkyKey[], t: number): [SkyKey, SkyKey, number] {
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    const b = keys[(i + 1) % keys.length]!;
    const end = i + 1 < keys.length ? b.t : b.t + 1;
    if (t >= a.t && t < end) return [a, b, (t - a.t) / (end - a.t)];
  }
  // Before the first key (only if it is not at 0): between the last and the first.
  const a = keys[keys.length - 1]!;
  const b = keys[0]!;
  return [a, b, (t + 1 - a.t) / (b.t + 1 - a.t)];
}

/** Direction of travel of light from a body at this elevation and bearing (radians). */
function dirFrom(elevation: number, bearing: number): { x: number; y: number; z: number } {
  const h = Math.cos(elevation);
  return { x: Math.sin(bearing) * h, y: -Math.sin(elevation), z: Math.cos(bearing) * h };
}

const NOON_BEARING = Math.atan2(SKY.noonFrom.x, SKY.noonFrom.z);

/** The light, colours and sun position at time of day `t`. */
export function skyAt(t: number): SkyState {
  t = frac(t);
  const [a, b, k] = bracket(SKY.keys, t);
  const moon = t < DAY_PHASES.dawn || t >= DAY_PHASES.night;
  let lightDir;
  if (moon) {
    lightDir = dirFrom(SKY.moonElevation, NOON_BEARING + SKY.moonBearing);
  } else {
    // Sun: rises at `sunrise`, peaks at noon, sets at `sunset`; never lit from below the minimum.
    const u = (t - DAY_PHASES.sunrise) / (DAY_PHASES.sunset - DAY_PHASES.sunrise);
    const elevation = Math.max(SKY.minElevation, SKY.noonElevation * Math.sin(Math.PI * Math.min(1, Math.max(0, u))));
    lightDir = dirFrom(elevation, NOON_BEARING + (u - 0.5) * 2 * SKY.swing);
  }
  return {
    t,
    phase: dayPhase(t),
    lightDir,
    moon,
    sun: mix(a.sun, b.sun, k),
    sunColor: mixRGB(a.sunColor, b.sunColor, k),
    sky: mix(a.sky, b.sky, k),
    skyColor: mixRGB(a.skyColor, b.skyColor, k),
    ground: mix(a.ground, b.ground, k),
    fogTint: mixRGB(a.fogTint, b.fogTint, k),
    zenith: mixRGB(a.zenith, b.zenith, k),
    stars: mix(a.stars, b.stars, k),
    light: mix(a.light, b.light, k),
  };
}

/** Whether AI pilots run with their lamps on in this light. */
export const lampsWanted = (sky: Pick<SkyState, "light">): boolean => sky.light < LIGHTS.lampsBelow;

/** How dark it is for the cockpit's glow and the headlight hint: 0 in daylight, 1 at night. */
export function darkness(sky: Pick<SkyState, "light">): number {
  const night = SKY.keys[0]!.light;
  return Math.min(1, Math.max(0, (1 - sky.light) / (1 - night)));
}
