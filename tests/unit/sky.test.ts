import { describe, expect, it } from "vitest";
import { LIGHTS } from "../../src/data/lights";
import { DAY_PHASES, SKY, TIME_NAMES } from "../../src/data/sky";
import { darkness, dayPhase, freshSkyClock, lampsWanted, parseSkyClock, parseTime, skipTo, skyAt, timeOfDay } from "../../src/sim/sky";

describe("sky clock", () => {
  it("starts a new game in the morning and turns over once a day", () => {
    const clock = freshSkyClock();
    expect(timeOfDay(clock)).toBeCloseTo(SKY.start);
    expect(dayPhase(timeOfDay(clock))).toBe("day");
    clock.seconds += SKY.dayLength;
    expect(timeOfDay(clock)).toBeCloseTo(SKY.start);
  });

  it("has about thirteen minutes of day and five of night in a twenty-minute day", () => {
    expect(SKY.dayLength).toBe(1200);
    const minutes = { night: 0, dawn: 0, day: 0, dusk: 0 };
    for (let s = 0; s < SKY.dayLength; s++) minutes[dayPhase(s / SKY.dayLength)] += 1 / 60;
    expect(minutes.day).toBeCloseTo(13, 0);
    expect(minutes.night).toBeCloseTo(5, 0);
    expect(minutes.dawn).toBeCloseTo(1, 0);
    expect(minutes.dusk).toBeCloseTo(1, 0);
  });

  it("skips forward, never back, and leaves play time alone", () => {
    const clock = { seconds: 100, offset: 0 };
    skipTo(clock, 0.845);
    expect(timeOfDay(clock)).toBeCloseTo(0.845);
    expect(clock.seconds).toBe(100);
    const offset = clock.offset;
    skipTo(clock, 0.5);
    expect(clock.offset).toBeGreaterThan(offset);
    expect(timeOfDay(clock)).toBeCloseTo(0.5);
  });

  it("reads times by name or number", () => {
    expect(parseTime("noon")).toBe(0.5);
    expect(parseTime("night")).toBe(0);
    expect(parseTime("0.25")).toBe(0.25);
    expect(parseTime("tea")).toBeNull();
    expect(parseTime(3)).toBeNull();
  });

  it("reads a saved clock, defaulting anything invalid", () => {
    expect(parseSkyClock({ seconds: 50, offset: 10 })).toEqual({ seconds: 50, offset: 10 });
    expect(parseSkyClock({ seconds: -1, offset: "x" })).toEqual({ seconds: 0, offset: 0 });
    expect(parseSkyClock(undefined)).toEqual(freshSkyClock());
  });
});

describe("sky light", () => {
  it("is the game's original light at noon", () => {
    const noon = skyAt(0.5);
    expect(noon.sun).toBe(0.95);
    expect(noon.sky).toBe(0.65);
    expect(noon.light).toBe(1);
    const d = noon.lightDir;
    const len = Math.hypot(0.45, 1, 0.35);
    expect(d.x).toBeCloseTo(-0.45 / len, 2);
    expect(d.y).toBeCloseTo(-1 / len, 2);
    expect(d.z).toBeCloseTo(0.35 / len, 2);
  });

  it("is dark at night, lit by the moon", () => {
    const night = skyAt(0);
    expect(night.moon).toBe(true);
    expect(night.light).toBeLessThan(0.3);
    expect(night.stars).toBe(1);
  });

  it("changes smoothly through the day, across midnight too", () => {
    const step = 1 / 2000;
    for (let t = 0; t < 1; t += step) {
      const a = skyAt(t);
      const b = skyAt(t + step);
      expect(Math.abs(a.light - b.light)).toBeLessThan(0.05);
      expect(Math.abs(a.sky - b.sky)).toBeLessThan(0.05);
      expect(Math.abs(a.fogTint[0] - b.fogTint[0])).toBeLessThan(0.05);
    }
  });

  it("always lights from above, the sun swinging across the sky through the day", () => {
    for (let t = 0; t < 1; t += 0.01) expect(skyAt(t).lightDir.y).toBeLessThan(-0.15);
    const morning = skyAt(0.25).lightDir;
    const evening = skyAt(0.75).lightDir;
    expect(Math.hypot(morning.x - evening.x, morning.z - evening.z)).toBeGreaterThan(0.5);
  });

  it("is dimmest when the sun hands over to the moon", () => {
    for (const t of [DAY_PHASES.dawn, DAY_PHASES.night]) {
      expect(skyAt(t).sun).toBeLessThanOrEqual(skyAt(t - 0.01).sun);
      expect(skyAt(t).sun).toBeLessThanOrEqual(skyAt(t + 0.01).sun);
    }
  });
});

describe("lamps after dark", () => {
  it("AI lamps are off by day and on at night, dusk and dawn", () => {
    expect(lampsWanted(skyAt(0.5))).toBe(false);
    expect(lampsWanted(skyAt(0.3))).toBe(false);
    expect(lampsWanted(skyAt(0))).toBe(true);
    expect(lampsWanted(skyAt(TIME_NAMES.dusk))).toBe(true);
    expect(lampsWanted(skyAt(DAY_PHASES.dawn))).toBe(true);
  });

  it("darkness runs from 0 in daylight to 1 at night", () => {
    expect(darkness(skyAt(0.5))).toBe(0);
    expect(darkness(skyAt(0))).toBe(1);
    const dusk = darkness(skyAt(TIME_NAMES.dusk));
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    for (let t = 0; t < 1; t += 0.01) {
      const d = darkness(skyAt(t));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it("the headlight hint comes later in the evening than AI lamps", () => {
    expect(LIGHTS.hintBelow).toBeLessThan(LIGHTS.lampsBelow);
  });
});
