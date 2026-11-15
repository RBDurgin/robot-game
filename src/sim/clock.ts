/** Simulation runs at a fixed rate so gameplay is deterministic and independent of frame rate. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** Cap on catch-up steps per frame, so a long stall (tab switch, slow frame) cannot spiral. */
const MAX_STEPS_PER_FRAME = 5;

/**
 * Accumulates variable frame time and reports how many fixed simulation steps to run.
 */
export class FixedStepClock {
  private accumulator = 0;
  /** Total simulation steps taken since start. */
  tick = 0;

  /** Feed elapsed real seconds; returns the number of fixed steps to run this frame. */
  advance(frameSeconds: number): number {
    this.accumulator += Math.max(0, frameSeconds);
    // The epsilon stops float rounding from dropping a step when time lands exactly on a boundary.
    let steps = Math.floor(this.accumulator / SIM_DT + 1e-9);
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      this.accumulator = 0;
    } else {
      this.accumulator = Math.max(0, this.accumulator - steps * SIM_DT);
    }
    this.tick += steps;
    return steps;
  }

  /** Fraction of a step left over, for render interpolation (0..1). */
  get alpha(): number {
    return this.accumulator / SIM_DT;
  }
}
