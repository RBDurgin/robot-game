import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { applyDamage, createHealth, healthFraction, mobilityFor, repairAll } from "../../src/sim/damage";

const frame = FRAMES.medium;

describe("damage", () => {
  it("armor absorbs before structure", () => {
    const h = createHealth(frame);
    applyDamage(h, "torso", 50);
    expect(h.sections.torso.armor).toBe(frame.sections.torso.armor - 50);
    expect(h.sections.torso.structure).toBe(frame.sections.torso.structure);
  });

  it("destroying an arm does not kill, and overflow carries into the torso", () => {
    const h = createHealth(frame);
    const arm = frame.sections.armL;
    const r = applyDamage(h, "armL", arm.armor + arm.structure + 30);
    expect(r.destroyed).toEqual(["armL"]);
    expect(r.killed).toBe(false);
    expect(h.alive).toBe(true);
    expect(h.sections.torso.armor).toBe(frame.sections.torso.armor - 30);
  });

  it("hits on a destroyed section pass through to the torso", () => {
    const h = createHealth(frame);
    applyDamage(h, "armR", frame.sections.armR.armor + frame.sections.armR.structure);
    expect(h.sections.armR.destroyed).toBe(true);
    const torsoBefore = h.sections.torso.armor + h.sections.torso.structure;
    applyDamage(h, "armR", 25);
    expect(h.sections.torso.armor + h.sections.torso.structure).toBe(torsoBefore - 25);
  });

  it("destroying the torso kills the mech", () => {
    const h = createHealth(frame);
    const r = applyDamage(h, "torso", 10_000);
    expect(r.killed).toBe(true);
    expect(h.alive).toBe(false);
    expect(healthFraction(h)).toBe(0);
    expect(applyDamage(h, "torso", 10).killed).toBe(false); // already dead: no double kill
  });

  it("leg damage reduces mobility", () => {
    const h = createHealth(frame);
    expect(mobilityFor(h)).toBe(1);
    applyDamage(h, "legs", frame.sections.legs.armor + frame.sections.legs.structure * 0.6);
    expect(mobilityFor(h)).toBe(0.75);
    applyDamage(h, "legs", 1000);
    expect(mobilityFor(h)).toBe(0.45);
  });

  it("armor scale changes armor only, and repair restores everything", () => {
    const h = createHealth(frame, 0.5);
    expect(h.sections.torso.maxArmor).toBe(frame.sections.torso.armor / 2);
    expect(h.sections.torso.maxStructure).toBe(frame.sections.torso.structure);
    applyDamage(h, "torso", 10_000);
    repairAll(h);
    expect(h.alive).toBe(true);
    expect(healthFraction(h)).toBe(1);
  });
});
