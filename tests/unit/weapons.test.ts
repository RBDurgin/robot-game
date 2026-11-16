import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { WEAPON_RULES, WEAPONS } from "../../src/data/weapons";
import { SIM_DT } from "../../src/sim/clock";
import { idleIntent } from "../../src/sim/intent";
import { makeRng, type Vec3 } from "../../src/sim/math";
import { addHeat, createMechState, stepMech } from "../../src/sim/mech";
import { angleBetween, beamPulses, clearLock, createLock, lockProgress, pelletDirections, steerMissile, stepLock } from "../../src/sim/weapons";

const FORWARD: Vec3 = { x: 0, y: 0, z: 1 };

describe("beam", () => {
  const beam = WEAPONS.lanceBeam;

  it("delivers its damage per second in pulses", () => {
    const weapon = { beamTime: 0 };
    let pulses = 0;
    for (let i = 0; i < 120; i++) pulses += beamPulses(weapon, SIM_DT, WEAPON_RULES.beamPulse);
    expect(pulses).toBe(20);
    expect(pulses * WEAPON_RULES.beamPulse * beam.damage).toBeCloseTo(beam.damage * 2, 5);
  });

  it("overheats a suit that holds the trigger, sooner on a light frame", () => {
    const secondsToOverheat = (frame: (typeof FRAMES)[keyof typeof FRAMES]): number => {
      const s = createMechState(frame);
      for (let i = 1; i < 60 * 60; i++) {
        stepMech(s, frame, idleIntent(), true, SIM_DT);
        if (addHeat(s, frame, beam.heat * SIM_DT)) return i * SIM_DT;
      }
      return Infinity;
    };
    const light = secondsToOverheat(FRAMES.light);
    const medium = secondsToOverheat(FRAMES.medium);
    const heavy = secondsToOverheat(FRAMES.heavy);
    // Net heating is the beam's heat less the frame's dissipation.
    expect(medium).toBeCloseTo(FRAMES.medium.heatCapacity / (beam.heat - FRAMES.medium.heatDissipation), 0);
    expect(light).toBeLessThan(medium);
    expect(heavy).toBeGreaterThan(medium * 1.5);
    expect(light).toBeGreaterThan(3); // long enough to be worth firing
  });
});

describe("scatter", () => {
  const gun = WEAPONS.scatterGun;

  it("fires one ray per pellet, all inside the spread cone", () => {
    const dirs = pelletDirections(FORWARD, gun.spread, gun.pellets, makeRng(3));
    expect(dirs.length).toBe(gun.pellets);
    for (const d of dirs) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
      expect(angleBetween(FORWARD, d)).toBeLessThan(gun.spread * 1.8);
    }
    expect(new Set(dirs.map((d) => d.x.toFixed(6))).size).toBeGreaterThan(1);
  });

  it("is strong up close and weak at range", () => {
    // Share of pellets that would land on a 2 m wide, 4.6 m tall target.
    const share = (distance: number): number => {
      const rng = makeRng(9);
      let hits = 0;
      const shots = 400;
      for (let i = 0; i < shots; i++) {
        for (const d of pelletDirections(FORWARD, gun.spread, gun.pellets, rng)) {
          const t = distance / d.z;
          if (Math.abs(d.x * t) < 1 && Math.abs(d.y * t) < 2.3) hits++;
        }
      }
      return hits / (shots * gun.pellets);
    };
    expect(share(12)).toBeGreaterThan(0.95);
    expect(share(90)).toBeLessThan(0.2);
    // Point blank it out-damages the slug cannon per shot; at range it does not.
    expect(gun.damage * gun.pellets * share(12)).toBeGreaterThan(WEAPONS.slugCannon.damage);
    expect(gun.damage * gun.pellets * share(90)).toBeLessThan(WEAPONS.slugCannon.damage);
  });

  it("a zero spread leaves the direction alone", () => {
    expect(pelletDirections(FORWARD, 0, 3, makeRng(1))).toEqual([FORWARD, FORWARD, FORWARD]);
  });
});

describe("missile lock", () => {
  const lockTime = WEAPONS.seekerRack.lockTime;
  const grace = WEAPON_RULES.lockGrace;
  const hold = (lock: ReturnType<typeof createLock<string>>, target: string | null, seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += SIM_DT) stepLock(lock, target, SIM_DT, grace);
  };

  it("builds while the crosshair stays on one target", () => {
    const lock = createLock<string>();
    hold(lock, "a", lockTime / 2);
    expect(lockProgress(lock, lockTime)).toBeCloseTo(0.5, 1);
    hold(lock, "a", lockTime / 2 + 0.1);
    expect(lockProgress(lock, lockTime)).toBe(1);
  });

  it("starts again on a different target", () => {
    const lock = createLock<string>();
    hold(lock, "a", lockTime + 0.1);
    stepLock(lock, "b", SIM_DT, grace);
    expect(lock.target).toBe("b");
    expect(lockProgress(lock, lockTime)).toBeLessThan(0.1);
  });

  it("survives a brief slip off the target, then drops", () => {
    const lock = createLock<string>();
    hold(lock, "a", lockTime + 0.1);
    hold(lock, null, grace * 0.5);
    expect(lockProgress(lock, lockTime)).toBe(1);
    hold(lock, "a", 0.1);
    hold(lock, null, grace + 0.1);
    expect(lock.target).toBeNull();
    expect(lockProgress(lock, lockTime)).toBe(0);
  });

  it("can be cleared", () => {
    const lock = createLock<string>();
    hold(lock, "a", 1);
    clearLock(lock);
    expect(lock).toEqual({ target: null, time: 0, lost: 0 });
  });
});

describe("guided missile", () => {
  const { turnRate, projectileSpeed: speed } = WEAPONS.seekerRack;

  it("turns toward its target at no more than its turn rate, keeping its speed", () => {
    const vel = { x: 0, y: 0, z: speed };
    const next = steerMissile(vel, { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, turnRate, SIM_DT);
    expect(Math.hypot(next.x, next.y, next.z)).toBeCloseTo(speed, 6);
    expect(angleBetween(FORWARD, { x: next.x / speed, y: next.y / speed, z: next.z / speed })).toBeCloseTo(turnRate * SIM_DT, 6);
    expect(next.x).toBeGreaterThan(0);
  });

  it("snaps onto the target once it is nearly lined up, and climbs as well as turns", () => {
    const next = steerMissile({ x: 0, y: 0, z: speed }, { x: 0, y: 0, z: 0 }, { x: 0.01, y: 0.01, z: 100 }, turnRate, SIM_DT);
    expect(next.x / next.z).toBeCloseTo(0.0001, 6);
    const up = steerMissile({ x: 0, y: 0, z: speed }, { x: 0, y: 0, z: 0 }, { x: 0, y: 100, z: 100 }, turnRate, SIM_DT);
    expect(up.y).toBeGreaterThan(0);
  });

  const fly = (target: (t: number) => Vec3, seconds: number): number => {
    let pos = { x: 0, y: 0, z: 0 };
    let vel = { x: 0, y: 0, z: speed };
    let closest = Infinity;
    for (let t = 0; t < seconds; t += SIM_DT) {
      const at = target(t);
      vel = steerMissile(vel, pos, at, turnRate, SIM_DT);
      pos = { x: pos.x + vel.x * SIM_DT, y: pos.y + vel.y * SIM_DT, z: pos.z + vel.z * SIM_DT };
      closest = Math.min(closest, Math.hypot(at.x - pos.x, at.y - pos.y, at.z - pos.z));
    }
    return closest;
  };

  it("runs down a target walking across its path", () => {
    expect(fly((t) => ({ x: -40 + FRAMES.medium.walkSpeed * t, y: 0, z: 150 }), 6)).toBeLessThan(2);
  });

  it("turns round for a target behind it", () => {
    expect(fly(() => ({ x: 0, y: 0, z: -200 }), 8)).toBeLessThan(2);
  });

  it("can be dodged by a late sidestep at close range", () => {
    // The target dashes sideways when the missile is 25 m out: too tight a turn to follow.
    const dashAt = (150 - 25) / speed;
    const light = FRAMES.light;
    const miss = fly((t) => ({ x: t < dashAt ? 0 : Math.min(light.boostSpeed * (t - dashAt), light.boostSpeed * light.boostDuration), y: 0, z: 150 }), 150 / speed + 0.2);
    expect(miss).toBeGreaterThan(4);
  });
});
