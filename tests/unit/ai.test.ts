import { describe, expect, it } from "vitest";
import { SIM_DT } from "../../src/sim/clock";
import { createAiState, DEFAULT_AI, thinkAi, type AiView } from "../../src/sim/ai/brain";
import { pickAttackers } from "../../src/sim/ai/squad";
import { makeRng } from "../../src/sim/math";

const baseView = (over: Partial<AiView> = {}): AiView => ({
  feet: { x: 0, y: 0, z: 0 },
  eye: { x: 0, y: 3, z: 0 },
  speed: 5,
  healthFrac: 1,
  heatFrac: 0,
  energyFrac: 1,
  target: null,
  weaponsFree: true,
  blockedAhead: false,
  patrol: [
    { x: 0, y: 0, z: 50 },
    { x: 50, y: 0, z: 50 },
  ],
  home: { x: 0, y: 0, z: -100 },
  ...over,
});
const target = (z: number, visible = true) => ({ center: { x: 0, y: 3, z }, vel: { x: 0, y: 0, z: 0 }, visible });

function run(ai: ReturnType<typeof createAiState>, view: AiView, seconds: number) {
  const rng = makeRng(1);
  let intent = thinkAi(ai, view, DEFAULT_AI, SIM_DT, rng, 0);
  for (let t = 0; t < seconds; t += SIM_DT) intent = thinkAi(ai, view, DEFAULT_AI, SIM_DT, rng, intent.aimYaw);
  return intent;
}

describe("thinkAi", () => {
  it("patrols toward its waypoint without firing", () => {
    const ai = createAiState();
    const intent = run(ai, baseView(), 1);
    expect(ai.mode).toBe("patrol");
    expect(intent.moveZ).toBeGreaterThan(0);
    expect(intent.aimYaw).toBeCloseTo(0, 5);
    expect(intent.firePrimary).toBe(false);
  });

  it("advances to the next waypoint on arrival", () => {
    const ai = createAiState();
    run(ai, baseView({ feet: { x: 0, y: 0, z: 48 } }), 0.1);
    expect(ai.patrolIndex).toBe(1);
  });

  it("ignores targets that are out of range or out of sight", () => {
    const far = createAiState();
    run(far, baseView({ target: target(DEFAULT_AI.detectRange + 50) }), 2);
    expect(far.mode).toBe("patrol");
    const hidden = createAiState();
    run(hidden, baseView({ target: target(60, false) }), 2);
    expect(hidden.mode).toBe("patrol");
  });

  it("engages a visible target after its reaction time, aims at it and fires", () => {
    const ai = createAiState();
    const view = baseView({ target: target(80) });
    run(ai, view, DEFAULT_AI.reaction * 0.5);
    expect(ai.mode).toBe("patrol");
    let fired = false;
    const rng = makeRng(2);
    for (let i = 0; i < 300; i++) {
      const intent = thinkAi(ai, view, DEFAULT_AI, SIM_DT, rng, 0);
      fired ||= intent.firePrimary;
      if (ai.mode === "engage") expect(Math.abs(intent.aimYaw)).toBeLessThanOrEqual(DEFAULT_AI.aimJitter + 1e-9);
    }
    expect(ai.mode).toBe("engage");
    expect(fired).toBe(true);
  });

  it("engages immediately when alerted, even without line of sight", () => {
    const ai = createAiState();
    ai.alerted = true;
    const intent = run(ai, baseView({ target: target(250, false) }), 0.1);
    expect(ai.mode).toBe("engage");
    expect(intent.moveZ).toBe(1); // closes in to find the target
    expect(intent.firePrimary).toBe(false); // but does not shoot what it cannot see
  });

  it("keeps its distance: closes when far, backs off when too close", () => {
    const farAi = createAiState();
    farAi.alerted = true;
    expect(run(farAi, baseView({ target: target(DEFAULT_AI.maxRange + 40) }), 0.5).moveZ).toBe(1);
    const nearAi = createAiState();
    nearAi.alerted = true;
    expect(run(nearAi, baseView({ target: target(DEFAULT_AI.minRange - 20) }), 0.5).moveZ).toBe(-1);
  });

  it("holds fire when running hot", () => {
    const ai = createAiState();
    ai.alerted = true;
    const view = baseView({ target: target(80), heatFrac: 0.95 });
    const rng = makeRng(3);
    for (let i = 0; i < 300; i++) expect(thinkAi(ai, view, DEFAULT_AI, SIM_DT, rng, 0).firePrimary).toBe(false);
  });

  it("retreats toward home once when badly damaged, then fights on", () => {
    const ai = createAiState();
    ai.alerted = true;
    const view = baseView({ target: target(80), healthFrac: 0.1 });
    const intent = run(ai, view, 0.2);
    expect(ai.mode).toBe("retreat");
    expect(intent.moveZ).toBeLessThan(0); // home is behind it while it faces the target
    run(ai, view, 8);
    expect(ai.mode).toBe("engage");
    expect(ai.hasRetreated).toBe(true);
  });

  it("hops with its jets when stuck", () => {
    const ai = createAiState();
    const intent = run(ai, baseView({ speed: 0 }), 1);
    expect(intent.jump).toBe(true);
  });

  it("returns to patrol when no target remains", () => {
    const ai = createAiState();
    ai.alerted = true;
    run(ai, baseView({ target: target(80) }), 0.5);
    run(ai, baseView({ target: null }), 0.1);
    expect(ai.mode).toBe("patrol");
    expect(ai.alerted).toBe(false);
  });
});

describe("attack slots", () => {
  it("a pilot without a slot holds fire and backs off to the edge of the fighting band", () => {
    const ai = createAiState();
    ai.alerted = true;
    const rng = makeRng(3);
    const view = baseView({ target: target(70), weaponsFree: false });
    let fired = false;
    let intent = thinkAi(ai, view, DEFAULT_AI, SIM_DT, rng, 0);
    for (let i = 0; i < 600; i++) {
      intent = thinkAi(ai, view, DEFAULT_AI, SIM_DT, rng, intent.aimYaw);
      fired ||= intent.firePrimary || intent.fireSecondary || intent.melee;
    }
    expect(ai.mode).toBe("engage");
    expect(fired).toBe(false);
    expect(intent.moveZ).toBe(-1); // 70 m is inside maxRange: retreat to the rim
  });

  it("gives slots to the closest pilots and keeps a holder unless clearly out-ranged", () => {
    const c = (pilot: string, distance: number, holding = false) => ({ pilot, distance, holding });
    expect([...pickAttackers([c("a", 90), c("b", 40), c("c", 60)], 2)].sort()).toEqual(["b", "c"]);
    // "a" holds a slot and is only 10 m farther than "c": it keeps it.
    expect([...pickAttackers([c("a", 70, true), c("b", 40, true), c("c", 60)], 2)].sort()).toEqual(["a", "b"]);
    // 30 m farther is too much: the slot moves.
    expect([...pickAttackers([c("a", 90, true), c("b", 40, true), c("c", 60)], 2)].sort()).toEqual(["b", "c"]);
    expect(pickAttackers([c("a", 10)], 0).size).toBe(0);
  });
});
