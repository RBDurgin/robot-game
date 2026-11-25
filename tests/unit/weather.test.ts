import { describe, expect, it } from "vitest";
import { BIOMES, BIOME_IDS } from "../../src/data/biomes";
import { WEATHER } from "../../src/data/weather";
import { WORLD } from "../../src/data/world";
import { CLEAR, forceWeather, frontsAt, frontStrength, parseWeather, slotFront, weatherAt, weatherFog, weatherLight, weatherName } from "../../src/sim/weather";

const seed = WORLD.seed;
const region = (id: string) => WORLD.regions.find((r) => r.id === id)!;

/** A time when a front stands over a place, searching forward from `from`. */
function stormOver(x: number, z: number, from = 0): number {
  for (let s = from; s < from + 200_000; s += 10) if (weatherAt(WORLD, frontsAt(seed, s), x, z).storm > 0.6) return s;
  throw new Error("no storm found");
}

describe("storm fronts", () => {
  it("are the same for the same seed and time, and differ for another seed", () => {
    expect(frontsAt(seed, 12_345)).toEqual(frontsAt(seed, 12_345));
    const some = Array.from({ length: 40 }, (_, i) => slotFront(seed, i));
    const other = Array.from({ length: 40 }, (_, i) => slotFront(seed + 1, i));
    expect(some).not.toEqual(other);
    expect(some.filter(Boolean).length).toBeGreaterThan(20);
  });

  it("move steadily along their heading and are gone once across", () => {
    const path = Array.from({ length: 20 }, (_, i) => slotFront(seed, i)).find(Boolean)!;
    const mid = path.start + path.duration / 2;
    const a = frontsAt(seed, mid).find((f) => f.id === path.id)!;
    const b = frontsAt(seed, mid + 10).find((f) => f.id === path.id)!;
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(path.speed * 10, 5);
    expect(Math.atan2(b.x - a.x, b.z - a.z)).toBeCloseTo(Math.atan2(Math.sin(path.heading), Math.cos(path.heading)), 5);
    // Halfway through, it is near the middle of the world; at the ends, outside it.
    expect(Math.hypot(a.x, a.z)).toBeLessThanOrEqual(WEATHER.pathOffset + 1);
    expect(frontsAt(seed, path.start + path.duration + 1).some((f) => f.id === path.id)).toBe(false);
    const first = frontsAt(seed, path.start).find((f) => f.id === path.id)!;
    expect(Math.hypot(first.x, first.z)).toBeGreaterThan(WORLD.size / 2);
  });

  it("change smoothly over time at a place", () => {
    const home = region("ashfall-basin");
    let last = weatherAt(WORLD, frontsAt(seed, 0), home.x, home.z).storm;
    for (let s = 1; s < 20_000; s += 1) {
      const now = weatherAt(WORLD, frontsAt(seed, s), home.x, home.z).storm;
      expect(Math.abs(now - last)).toBeLessThan(0.025);
      last = now;
    }
  });

  it("cover a place some of the time, not most of it", () => {
    for (const r of WORLD.regions) {
      let stormy = 0;
      let samples = 0;
      for (let s = 0; s < 200_000; s += 30) {
        samples++;
        if (weatherAt(WORLD, frontsAt(seed, s), r.x, r.z).storm > WEATHER.hudAbove) stormy++;
      }
      expect(stormy / samples, r.id).toBeGreaterThan(0.04);
      expect(stormy / samples, r.id).toBeLessThan(0.35);
    }
  });

  it("strength fades from the middle of a front to nothing past its edge", () => {
    const f = { ...slotFront(seed, 0) ?? slotFront(seed, 1)!, x: 0, z: 0 };
    expect(frontStrength(f, 0, 0)).toBeCloseTo(f.strength);
    const fx = Math.sin(f.heading);
    const fz = Math.cos(f.heading);
    expect(frontStrength(f, fx * f.halfDepth * 1.01, fz * f.halfDepth * 1.01)).toBe(0);
    expect(frontStrength(f, fz * f.halfLength * 1.01, -fx * f.halfLength * 1.01)).toBe(0);
    const half = frontStrength(f, fx * f.halfDepth * 0.7, fz * f.halfDepth * 0.7);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(f.strength);
  });

  it("rain in the basin and highlands, dust on the salt flats and in the ruins", () => {
    for (const r of WORLD.regions) {
      const s = stormOver(r.x, r.z);
      const w = weatherAt(WORLD, frontsAt(seed, s), r.x, r.z);
      expect(w.rain + w.dust).toBeCloseTo(w.storm);
      expect(weatherName(w), r.id).toBe(WEATHER.kinds[r.biome]);
    }
  });
});

describe("weather and the fog", () => {
  it("only ever brings the fog in closer, in every biome at any strength", () => {
    for (const id of BIOME_IDS) {
      const fog = BIOMES[id].fog;
      for (let storm = 0; storm <= 1.0001; storm += 0.1) {
        for (const share of [0, 0.3, 1]) {
          const w = { ...CLEAR, storm, rain: storm * share, dust: storm * (1 - share) };
          const f = weatherFog(fog.start, fog.end, fog.color, w);
          expect(f.end).toBeLessThanOrEqual(fog.end);
          expect(f.start).toBeLessThanOrEqual(fog.start);
          expect(f.start).toBeLessThan(f.end);
          for (const c of f.color) expect(c).toBeGreaterThanOrEqual(0);
        }
      }
    }
    for (const look of Object.values(WEATHER.look)) {
      expect(look.fogStart).toBeLessThanOrEqual(1);
      expect(look.fogEnd).toBeLessThanOrEqual(1);
    }
  });

  it("leaves a clear sky as it was, and dims the light in a storm", () => {
    const fog = BIOMES.basin.fog;
    expect(weatherFog(fog.start, fog.end, fog.color, CLEAR)).toEqual({ start: fog.start, end: fog.end, color: [...fog.color] });
    expect(weatherLight(CLEAR)).toEqual({ sun: 1, sky: 1 });
    const storm = weatherLight({ ...CLEAR, storm: 1, rain: 1 });
    expect(storm.sun).toBeLessThan(0.5);
    expect(storm.sun).toBeGreaterThan(0);
  });
});

describe("forced weather", () => {
  it("reads names and strengths", () => {
    expect(parseWeather("clear")).toEqual({ storm: 0 });
    expect(parseWeather("storm")).toEqual({ storm: 1 });
    expect(parseWeather("dust")).toEqual({ storm: 1, kind: "dust" });
    expect(parseWeather("0.5")).toEqual({ storm: 0.5 });
    expect(parseWeather("hail")).toBeNull();
    expect(parseWeather("")).toBeNull();
    expect(parseWeather(2)).toBeNull();
  });

  it("takes its kind from the ground unless one is named", () => {
    const flats = region("mirror-pan");
    expect(forceWeather(WORLD, CLEAR, { storm: 1 }, flats.x, flats.z).dust).toBeCloseTo(1);
    expect(forceWeather(WORLD, CLEAR, { storm: 1, kind: "rain" }, flats.x, flats.z).rain).toBe(1);
  });
});
