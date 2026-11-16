import { describe, expect, it } from "vitest";
import { FRAME_IDS, FRAMES, type FrameDef } from "../../src/data/frames";
import { SIM_DT } from "../../src/sim/clock";
import { raycastMech } from "../../src/sim/hit";
import { idleIntent, type Intent } from "../../src/sim/intent";
import { createMechState, stepMech, type MechState } from "../../src/sim/mech";

const { light, medium, heavy } = FRAMES;
const run = (s: MechState, frame: FrameDef, intent: Intent, steps: number, grounded = true): void => {
  for (let i = 0; i < steps; i++) stepMech(s, frame, intent, grounded, SIM_DT);
};
const forward = { ...idleIntent(), moveZ: 1 };

describe("frames", () => {
  it("each frame reaches its own walk and sprint speed", () => {
    for (const id of FRAME_IDS) {
      const frame: FrameDef = FRAMES[id];
      const s = createMechState(frame);
      run(s, frame, forward, 120);
      expect(s.vel.z, `${id} walk`).toBeCloseTo(frame.walkSpeed, 3);
      run(s, frame, { ...forward, sprint: true }, 120);
      expect(s.vel.z, `${id} sprint`).toBeCloseTo(frame.sprintSpeed, 3);
    }
  });

  it("play distinct roles: lighter is faster, heavier is tougher and carries more", () => {
    const toughness = (f: FrameDef): number => f.sections.torso.armor + f.sections.torso.structure;
    const ordered: FrameDef[] = [light, medium, heavy];
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!;
      const b = ordered[i]!;
      expect(a.sprintSpeed).toBeGreaterThan(b.sprintSpeed * 1.3);
      expect(a.torsoTurnRate).toBeGreaterThan(b.torsoTurnRate);
      expect(toughness(b)).toBeGreaterThan(toughness(a) * 1.3);
      expect(b.loadCapacity).toBeGreaterThan(a.loadCapacity * 1.3);
      expect(b.heatCapacity).toBeGreaterThan(a.heatCapacity);
    }
  });

  it("the heavy frame gets up to speed more slowly", () => {
    const a = createMechState(light);
    const b = createMechState(heavy);
    run(a, light, forward, 6);
    run(b, heavy, forward, 6);
    expect(a.vel.z / light.walkSpeed).toBeGreaterThan(b.vel.z / heavy.walkSpeed);
  });

  it("hit volumes follow the frame's size and bulk", () => {
    const feet = { x: 0, y: 0, z: 0 };
    const none = (): boolean => false;
    // A shot 1.3 m off the centreline at chest height, from the front.
    const shot = (frame: FrameDef, y: number) => raycastMech({ x: 1.3, y, z: 50 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, frame, none)?.section ?? null;
    expect(shot(heavy, 3.6)).toBe("torso");
    expect(shot(medium, 3.2)).toBe("armR");
    expect(shot(light, 2.7)).toBe("armR");
    // Above the light frame's head, but still inside the heavy frame.
    expect(raycastMech({ x: 0, y: 4.4, z: 50 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, light, none)).toBeNull();
    expect(raycastMech({ x: 0, y: 4.4, z: 50 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, heavy, none)?.section).toBe("torso");
  });
});

describe("dash charges", () => {
  const dash = { ...idleIntent(), moveZ: 1, boost: true };

  it("the light frame can dash twice in a row, the medium only once", () => {
    for (const [frame, expected] of [
      [light, 2],
      [medium, 1],
    ] as [FrameDef, number][]) {
      const s = createMechState(frame);
      let dashes = 0;
      // Hold the key for just under one recharge period.
      for (let i = 0; i < Math.floor((frame.boostCooldown - 0.05) / SIM_DT); i++) {
        const before = s.boostCharges;
        stepMech(s, frame, dash, true, SIM_DT);
        if (s.boostCharges < before) dashes++;
      }
      expect(dashes, frame.id).toBe(expected);
    }
  });

  it("charges come back one at a time", () => {
    const s = createMechState(light);
    run(s, light, dash, Math.ceil((light.boostDuration * 2 + 0.1) / SIM_DT));
    expect(s.boostCharges).toBe(0);
    const perCharge = Math.ceil(light.boostCooldown / SIM_DT);
    run(s, light, idleIntent(), perCharge);
    expect(s.boostCharges).toBe(1);
    run(s, light, idleIntent(), perCharge);
    expect(s.boostCharges).toBe(2);
    expect(s.boostCooldown).toBe(0);
    run(s, light, idleIntent(), perCharge);
    expect(s.boostCharges).toBe(2); // never more than the frame holds
  });

  it("the second dash can go a different way", () => {
    const s = createMechState(light);
    run(s, light, dash, 1);
    expect(s.boostDirZ).toBeCloseTo(1, 5);
    run(s, light, idleIntent(), Math.ceil(light.boostDuration / SIM_DT) + 1);
    run(s, light, { ...idleIntent(), moveX: 1, boost: true }, 1);
    expect(s.boostDirX).toBeCloseTo(1, 5);
    expect(s.vel.x).toBeCloseTo(light.boostSpeed, 5);
  });
});

describe("brace stance", () => {
  const delaySteps = Math.ceil(heavy.brace.delay / SIM_DT);

  it("takes hold after standing still, and only on a frame that has it", () => {
    const s = createMechState(heavy);
    run(s, heavy, idleIntent(), delaySteps - 2);
    expect(s.braced).toBe(false);
    run(s, heavy, idleIntent(), 4);
    expect(s.braced).toBe(true);
    const m = createMechState(medium);
    run(m, medium, idleIntent(), 300);
    expect(m.braced).toBe(false);
  });

  it("turning the torso keeps it; walking, dashing, jumping or being airborne breaks it", () => {
    const braced = (): MechState => {
      const s = createMechState(heavy);
      run(s, heavy, idleIntent(), delaySteps + 2);
      expect(s.braced).toBe(true);
      return s;
    };
    let s = braced();
    run(s, heavy, idleIntent(1.2), 30);
    expect(s.braced).toBe(true);

    s = braced();
    run(s, heavy, forward, 1);
    expect(s.braced).toBe(false);

    s = braced();
    run(s, heavy, { ...idleIntent(), boost: true }, 1);
    expect(s.braced).toBe(false);

    s = braced();
    run(s, heavy, { ...idleIntent(), jump: true }, 1);
    expect(s.braced).toBe(false);

    s = braced();
    run(s, heavy, idleIntent(), 1, false);
    expect(s.braced).toBe(false);
  });

  it("has to settle again after stopping", () => {
    const s = createMechState(heavy);
    run(s, heavy, forward, 60);
    run(s, heavy, idleIntent(), 10);
    expect(s.braced).toBe(false); // still coasting to a halt
    run(s, heavy, idleIntent(), delaySteps + 30);
    expect(s.braced).toBe(true);
  });
});
