import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { SIM_DT } from "../../src/sim/clock";
import { idleIntent } from "../../src/sim/intent";
import { addHeat, createMechState, stepMech } from "../../src/sim/mech";

const frame = FRAMES.medium;
const run = (s: ReturnType<typeof createMechState>, intent: ReturnType<typeof idleIntent>, grounded: boolean, steps: number) => {
  for (let i = 0; i < steps; i++) stepMech(s, frame, intent, grounded, SIM_DT);
};

describe("stepMech", () => {
  it("accelerates to walk speed in the aim direction", () => {
    const s = createMechState(frame);
    run(s, { ...idleIntent(Math.PI / 2), moveZ: 1 }, true, 60);
    expect(s.vel.x).toBeCloseTo(frame.walkSpeed, 3);
    expect(s.vel.z).toBeCloseTo(0, 3);
  });

  it("sprints only when moving forward", () => {
    const s = createMechState(frame);
    run(s, { ...idleIntent(), moveZ: 1, sprint: true }, true, 60);
    expect(s.vel.z).toBeCloseTo(frame.sprintSpeed, 3);
    run(s, { ...idleIntent(), moveZ: -1, sprint: true }, true, 90);
    expect(s.vel.z).toBeCloseTo(-frame.walkSpeed, 3);
  });

  it("diagonal input is not faster than straight", () => {
    const s = createMechState(frame);
    run(s, { ...idleIntent(), moveX: 1, moveZ: 1 }, true, 60);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeCloseTo(frame.walkSpeed, 3);
  });

  it("boost spends energy, bursts to boost speed, then respects its cooldown", () => {
    const s = createMechState(frame);
    stepMech(s, frame, { ...idleIntent(), moveZ: 1, boost: true }, true, SIM_DT);
    expect(s.energy).toBeCloseTo(frame.energyMax - frame.boostCost, 5);
    expect(s.vel.z).toBeCloseTo(frame.boostSpeed, 5);
    run(s, { ...idleIntent(), moveZ: 1, boost: true }, true, 10);
    expect(s.energy).toBeCloseTo(frame.energyMax - frame.boostCost, 5); // held key does not re-trigger
  });

  it("cannot boost without enough energy", () => {
    const s = createMechState(frame);
    s.energy = frame.boostCost - 1;
    s.energyRegenDelay = 10;
    stepMech(s, frame, { ...idleIntent(), boost: true }, true, SIM_DT);
    expect(s.boostTime).toBe(0);
  });

  it("jumps from the ground, jets while airborne, and falls when energy runs out", () => {
    const s = createMechState(frame);
    stepMech(s, frame, { ...idleIntent(), jump: true }, true, SIM_DT);
    expect(s.vel.y).toBe(frame.jumpSpeed);
    run(s, { ...idleIntent(), jump: true }, false, 30);
    expect(s.jetting).toBe(true);
    expect(s.vel.y).toBeLessThanOrEqual(frame.jetMaxRise + 1e-6);
    expect(s.vel.y).toBeGreaterThan(0);
    run(s, { ...idleIntent(), jump: true }, false, 600);
    expect(s.energy).toBe(0);
    expect(s.jetting).toBe(false);
    expect(s.vel.y).toBeLessThan(0);
  });

  it("energy recharges after the delay", () => {
    const s = createMechState(frame);
    stepMech(s, frame, { ...idleIntent(), boost: true }, true, SIM_DT);
    const after = s.energy;
    run(s, idleIntent(), true, Math.round(frame.energyRegenDelay / SIM_DT) - 5);
    expect(s.energy).toBe(after);
    run(s, idleIntent(), true, 240);
    expect(s.energy).toBe(frame.energyMax);
  });

  it("overheats at the cap and unlocks once cooled to half", () => {
    const s = createMechState(frame);
    expect(addHeat(s, frame, frame.heatCapacity - 1)).toBe(false);
    expect(addHeat(s, frame, 5)).toBe(true);
    expect(s.overheated).toBe(true);
    run(s, idleIntent(), true, 60);
    expect(s.overheated).toBe(true);
    run(s, idleIntent(), true, 240);
    expect(s.overheated).toBe(false);
  });

  it("leg damage slows the mech", () => {
    const s = createMechState(frame);
    s.mobility = 0.45;
    run(s, { ...idleIntent(), moveZ: 1 }, true, 60);
    expect(s.vel.z).toBeCloseTo(frame.walkSpeed * 0.45, 3);
  });

  it("torso turns toward the aim at a limited rate", () => {
    const s = createMechState(frame);
    stepMech(s, frame, idleIntent(Math.PI), true, SIM_DT);
    expect(Math.abs(s.torsoYaw)).toBeCloseTo(frame.torsoTurnRate * SIM_DT, 5);
  });
});
