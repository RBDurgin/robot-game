import { describe, expect, it } from "vitest";
import { SIM_DT } from "../../src/sim/clock";
import { AI_ROLES, blocksFire, createAiState, DEFAULT_AI, thinkAi, type AiConfig, type AiView } from "../../src/sim/ai/brain";
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

  it("will not fire through a friend, and sidesteps for a clear shot", () => {
    const ai = createAiState();
    const clear = baseView({ target: target(80) });
    run(ai, clear, 1);
    let fired = false;
    for (let t = 0; t < 4; t += SIM_DT) fired ||= thinkAi(ai, clear, DEFAULT_AI, SIM_DT, makeRng(2), 0).firePrimary;
    expect(fired).toBe(true);
    const blocked = { ...clear, fireBlocked: true };
    const rng = makeRng(3);
    for (let t = 0; t < 6; t += SIM_DT) {
      const intent = thinkAi(ai, blocked, DEFAULT_AI, SIM_DT, rng, 0);
      expect(intent.firePrimary || intent.fireSecondary || intent.fireTertiary).toBe(false);
      expect(intent.moveX).not.toBe(0);
    }
    // A support pilot normally stands still; with a friend in the way even it shuffles aside.
    const support = createAiState();
    support.mode = "engage";
    expect(thinkAi(support, { ...blocked, target: target(120) }, AI_ROLES.support, SIM_DT, makeRng(4), 0).moveX).not.toBe(0);
  });

  it("knows when a friend is in the line of fire", () => {
    const eye = { x: 0, y: 3, z: 0 };
    const foe = { x: 0, y: 3, z: 100 };
    expect(blocksFire(eye, foe, { x: 1, y: 3, z: 50 }, 3)).toBe(true);
    expect(blocksFire(eye, foe, { x: 8, y: 3, z: 50 }, 3)).toBe(false);
    // Behind the shooter or beyond the target is not in the way.
    expect(blocksFire(eye, foe, { x: 0, y: 3, z: -10 }, 3)).toBe(false);
    expect(blocksFire(eye, foe, { x: 0, y: 3, z: 130 }, 3)).toBe(false);
  });

  it("a wingman keeps station on its leader, and breaks off to fight", () => {
    const ai = createAiState();
    const far = run(ai, baseView({ follow: { x: 120, y: 0, z: 0 } }), 0.5);
    expect(far.moveZ).toBe(1);
    expect(far.sprint).toBe(true);
    expect(far.aimYaw).toBeCloseTo(Math.PI / 2, 5);
    const near = run(createAiState(), baseView({ follow: { x: 8, y: 0, z: 0 } }), 0.5);
    expect(near.moveZ).toBe(0);
    const fighting = createAiState();
    const intent = run(fighting, baseView({ follow: { x: 120, y: 0, z: 0 }, target: target(80) }), 2);
    expect(fighting.mode).toBe("engage");
    expect(intent.aimYaw).toBeCloseTo(0, 0);
  });

  it("forgets an alarm when there is nobody to fight", () => {
    const ai = createAiState();
    ai.alerted = true;
    run(ai, baseView(), 0.1);
    expect(ai.alerted).toBe(false);
    expect(ai.mode).toBe("patrol");
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

describe("roles", () => {
  /** Run an alerted pilot of a role against a visible target and collect what it did. */
  const fight = (cfg: AiConfig, distance: number, seconds = 10) => {
    const ai = createAiState();
    ai.alerted = true;
    const rng = makeRng(5);
    const view = baseView({ target: target(distance) });
    const seen = { strafed: 0, still: 0, dashes: 0, fired: false, steps: 0, last: thinkAi(ai, view, cfg, SIM_DT, rng, 0) };
    for (let t = 0; t < seconds; t += SIM_DT) {
      const intent = thinkAi(ai, view, cfg, SIM_DT, rng, seen.last.aimYaw);
      seen.steps++;
      if (intent.moveX !== 0) seen.strafed++;
      if (intent.moveX === 0 && intent.moveZ === 0) seen.still++;
      if (intent.boost) seen.dashes++;
      seen.fired ||= intent.firePrimary || intent.fireSecondary || intent.fireTertiary;
      seen.last = intent;
    }
    return seen;
  };

  it("a skirmisher closes to short range and never stands still", () => {
    expect(fight(AI_ROLES.skirmisher, 90, 1).last.moveZ).toBe(1); // a line pilot would hold at 90 m
    const close = fight(AI_ROLES.skirmisher, 30);
    expect(close.still).toBe(0);
    expect(close.strafed).toBe(close.steps);
    expect(close.dashes).toBeGreaterThan(fight(AI_ROLES.line, 80).dashes);
  });

  it("a skirmisher holds fire until its short-ranged weapons can reach", () => {
    expect(fight(AI_ROLES.skirmisher, AI_ROLES.skirmisher.fireRange + 30, 5).fired).toBe(false);
    expect(fight(AI_ROLES.skirmisher, 30, 5).fired).toBe(true);
  });

  it("heavy support plants its feet inside its band, far back, and fires its shoulder weapons", () => {
    const s = fight(AI_ROLES.support, 120);
    expect(s.still).toBe(s.steps); // standing still is what lets a heavy frame brace
    expect(s.fired).toBe(true);
    expect(s.last.fireTertiary).toBe(s.last.fireSecondary);
    // The same distance is too close for comfort once the target comes nearer.
    expect(fight(AI_ROLES.support, AI_ROLES.support.minRange - 20, 1).last.moveZ).toBe(-1);
    expect(AI_ROLES.support.minRange).toBeGreaterThan(AI_ROLES.line.minRange);
  });

  it("a pilot that stands its ground on purpose does not think it is stuck", () => {
    const ai = createAiState();
    ai.alerted = true;
    const rng = makeRng(2);
    const view = baseView({ target: target(120), speed: 0 });
    let jumped = false;
    for (let i = 0; i < 600; i++) jumped ||= thinkAi(ai, view, AI_ROLES.support, SIM_DT, rng, 0).jump;
    expect(jumped).toBe(false);
  });
});
