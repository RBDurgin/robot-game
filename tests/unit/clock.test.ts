import { describe, expect, it } from "vitest";
import { FixedStepClock, SIM_DT } from "../../src/sim/clock";

describe("FixedStepClock", () => {
  it("runs one step per fixed interval", () => {
    const clock = new FixedStepClock();
    expect(clock.advance(SIM_DT * 0.5)).toBe(0);
    expect(clock.advance(SIM_DT * 0.6)).toBe(1);
    expect(clock.tick).toBe(1);
  });

  it("carries the remainder forward", () => {
    const clock = new FixedStepClock();
    expect(clock.advance(SIM_DT * 2.5)).toBe(2);
    expect(clock.alpha).toBeCloseTo(0.5, 5);
    expect(clock.advance(SIM_DT * 0.5)).toBe(1);
  });

  it("caps catch-up after a long stall", () => {
    const clock = new FixedStepClock();
    expect(clock.advance(10)).toBe(5);
    expect(clock.alpha).toBe(0);
  });

  it("ignores negative time", () => {
    const clock = new FixedStepClock();
    expect(clock.advance(-1)).toBe(0);
  });
});
