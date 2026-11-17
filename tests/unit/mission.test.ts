import { describe, expect, it } from "vitest";
import { FACTIONS } from "../../src/data/factions";
import { campaign, MISSIONS } from "../../src/data/missions";
import { PATRON_OFFER, PATRONS } from "../../src/data/patrons";
import { WORLD } from "../../src/data/world";
import {
  awaitedSites,
  BASE_PLACE,
  missionEvent,
  missionProblems,
  nextMission,
  objectiveText,
  parseMissionState,
  resumeMission,
  startMission,
  stepMission,
  type Action,
  type MissionDef,
  type MissionFacts,
  type StageDef,
} from "../../src/sim/mission";
import { buildWorldModel } from "../../src/sim/worldgen";

/** A world the tests can rearrange: where the player is and who is left where. */
function world(at: string[] = [], defenders: Record<string, number> = {}): MissionFacts & { at: string[]; defenders: Record<string, number>; squads: Record<string, string> } {
  const w = {
    at,
    defenders,
    /** Where each squad is, by tag. */
    squads: {} as Record<string, string>,
    squadIn: (tag: string, place: string) => w.squads[tag] === place,
    inArea: (place: string, radius?: number) => w.at.includes(radius === undefined ? place : `${place}@${radius}`),
    defendersAt: (site: string) => w.defenders[site] ?? 0,
  };
  return w;
}

const mission = (stages: StageDef[], extra: Partial<MissionDef> = {}): MissionDef => ({
  id: "test",
  title: "Test",
  type: "assault",
  requires: [],
  auto: true,
  stages,
  debrief: { title: "Done", text: "" },
  reward: { scrap: 0 },
  ...extra,
});

const kill = (extra: Partial<{ faction: string; site: string | null; tag: string | null; byPlayer: boolean }> = {}) =>
  ({ type: "mechDestroyed", faction: "combine", site: null, tag: null, byPlayer: true, ...extra }) as const;

describe("mission interpreter", () => {
  it("enters the first stage and does what it says on entry", () => {
    const def = mission([{ id: "a", objective: "", enter: [{ do: "notify", text: "Go." }], goals: [{ when: "inArea", place: "x" }] }]);
    const { state, effects } = startMission(def);
    expect(state).toEqual({ id: "test", stage: "a", goals: [0], fails: [], time: 0, status: "active" });
    expect(effects).toEqual([{ do: "stage", stage: "a" }, { do: "notify", text: "Go." }]);
  });

  it("moves on when every goal is met, and completes after the last stage", () => {
    const def = mission(
      [
        { id: "a", objective: "", goals: [{ when: "siteCleared", site: "post" }] },
        { id: "b", objective: "", enter: [{ do: "say", lines: [{ speaker: "Hale", text: "Come home." }] }], goals: [{ when: "inArea", place: BASE_PLACE }] },
      ],
      { complete: [{ do: "notify", text: "Paid." }] },
    );
    const w = world([], { post: 2 });
    const { state } = startMission(def);
    expect(stepMission(def, state, 1, w)).toEqual([]);
    w.defenders.post = 0;
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "stage", stage: "b" }, { do: "say", lines: [{ speaker: "Hale", text: "Come home." }] }]);
    expect(state.stage).toBe("b");
    expect(state.time).toBe(0);
    expect(stepMission(def, state, 1, w)).toEqual([]);
    w.at = [BASE_PLACE];
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "notify", text: "Paid." }, { do: "complete" }]);
    expect(state.status).toBe("complete");
    // A finished mission takes no further part.
    expect(stepMission(def, state, 1, w)).toEqual([]);
  });

  it("counts kills that match, since the stage began", () => {
    const def = mission([
      { id: "a", objective: "", goals: [{ when: "destroyed", count: 2, faction: "combine", byPlayer: true }] },
      { id: "b", objective: "", goals: [{ when: "destroyed", count: 1, tag: "ace" }] },
    ]);
    const w = world();
    const { state } = startMission(def);
    missionEvent(def, state, kill({ faction: "wardens" }));
    missionEvent(def, state, kill({ byPlayer: false }));
    missionEvent(def, state, kill());
    expect(stepMission(def, state, 1, w)).toEqual([]);
    missionEvent(def, state, kill({ tag: "ace" }));
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "stage", stage: "b" }]);
    // The ace died in the first stage: it does not count toward the second.
    expect(stepMission(def, state, 1, w)).toEqual([]);
    missionEvent(def, state, kill({ tag: "ace", byPlayer: false }));
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "complete" }]);
  });

  it("counts kills at a site, items collected and sites captured", () => {
    const def = mission([
      {
        id: "a",
        objective: "",
        goals: [
          { when: "destroyed", count: 1, site: "post" },
          { when: "collected", count: 3 },
          { when: "collected", count: 1, tag: "key" },
          { when: "siteCaptured", site: "post", by: "player" },
        ],
      },
    ]);
    const { state } = startMission(def);
    missionEvent(def, state, kill({ site: "elsewhere" }));
    missionEvent(def, state, kill({ site: "post" }));
    missionEvent(def, state, { type: "itemCollected", tag: null, count: 2 });
    missionEvent(def, state, { type: "itemCollected", tag: "key", count: 1 });
    missionEvent(def, state, { type: "siteCaptured", site: "post", by: "combine" });
    expect(state.goals).toEqual([1, 3, 1, 0]);
    expect(stepMission(def, state, 1, world())).toEqual([]);
    missionEvent(def, state, { type: "siteCaptured", site: "post", by: "player" });
    expect(stepMission(def, state, 1, world())).toEqual([{ do: "complete" }]);
  });

  it("remembers a place once visited, so several can be visited in any order", () => {
    const def = mission([{ id: "a", objective: "", goals: [{ when: "inArea", place: "north" }, { when: "inArea", place: "south" }] }]);
    const w = world(["south"]);
    const { state } = startMission(def);
    expect(stepMission(def, state, 1, w)).toEqual([]);
    w.at = [];
    expect(stepMission(def, state, 1, w)).toEqual([]);
    w.at = ["north"];
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "complete" }]);
  });

  it("waits out a timer", () => {
    const def = mission([{ id: "hold", objective: "Hold: {left}s", goals: [{ when: "elapsed", seconds: 3 }] }]);
    const w = world();
    const { state } = startMission(def);
    expect(stepMission(def, state, 1.5, w)).toEqual([]);
    expect(objectiveText(def, state, w)).toBe("Hold: 2s");
    expect(stepMission(def, state, 1.5, w)).toEqual([{ do: "complete" }]);
  });

  it("fails on leaving the area, on running out of time, and on the player's death", () => {
    const stage = (fail: StageDef["fail"]): MissionDef => mission([{ id: "a", objective: "", goals: [{ when: "inArea", place: "goal" }], fail }]);
    const w = world(["zone"]);

    const left = stage([{ when: "outsideArea", place: "zone" }]);
    let { state } = startMission(left);
    expect(stepMission(left, state, 1, w)).toEqual([]);
    expect(stepMission(left, state, 1, world())).toEqual([{ do: "fail" }]);
    expect(state.status).toBe("failed");

    const timed = stage([{ when: "elapsed", seconds: 2 }]);
    ({ state } = startMission(timed));
    expect(stepMission(timed, state, 1, w)).toEqual([]);
    expect(stepMission(timed, state, 1, w)).toEqual([{ do: "fail" }]);

    const lethal = stage([{ when: "playerDestroyed" }]);
    ({ state } = startMission(lethal));
    missionEvent(lethal, state, { type: "playerDestroyed" });
    // Failing comes first, even if the goal is met on the same step.
    expect(stepMission(lethal, state, 1, world(["goal"]))).toEqual([{ do: "fail" }]);
    missionEvent(lethal, state, kill());
    expect(stepMission(lethal, state, 1, w)).toEqual([]);
  });

  it("follows `next` rather than the order written", () => {
    const def = mission([
      { id: "a", objective: "", goals: [{ when: "inArea", place: "x" }], next: "c" },
      { id: "b", objective: "", goals: [{ when: "inArea", place: "x" }] },
      { id: "c", objective: "", goals: [{ when: "inArea", place: "x" }] },
    ]);
    const w = world(["x"]);
    const { state } = startMission(def);
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "stage", stage: "c" }]);
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "complete" }]);
  });

  it("writes the objective line from what is left", () => {
    const def = mission([
      { id: "a", objective: "Clear it: {left} hostile{s} remaining", goals: [{ when: "siteCleared", site: "post" }] },
      { id: "b", objective: "Destroy {left} more", goals: [{ when: "destroyed", count: 3 }] },
      { id: "c", objective: "Return to base{salvage}", goals: [{ when: "inArea", place: BASE_PLACE }] },
    ]);
    const w = world([], { post: 5 });
    const { state } = startMission(def);
    expect(objectiveText(def, state, w)).toBe("Clear it: 5 hostiles remaining");
    w.defenders.post = 1;
    expect(objectiveText(def, state, w)).toBe("Clear it: 1 hostile remaining");
    expect(awaitedSites(def, state)).toEqual(["post"]);
    w.defenders.post = 0;
    stepMission(def, state, 1, w);
    missionEvent(def, state, kill());
    expect(objectiveText(def, state, w)).toBe("Destroy 2 more");
    expect(awaitedSites(def, state)).toEqual([]);
    missionEvent(def, state, kill());
    missionEvent(def, state, kill());
    stepMission(def, state, 1, w);
    expect(objectiveText(def, state, w, 2)).toBe("Return to base (2 salvage left)");
    expect(objectiveText(def, state, w)).toBe("Return to base");
  });
});

describe("mission order and saved state", () => {
  const a = mission([{ id: "s", objective: "", goals: [{ when: "inArea", place: "x" }] }], { id: "a" });
  const b = mission([{ id: "s", objective: "", goals: [{ when: "destroyed", count: 2 }], fail: [{ when: "playerDestroyed" }] }], { id: "b", requires: ["a"] });
  const c = mission([{ id: "s", objective: "", goals: [{ when: "inArea", place: "x" }] }], { id: "c", requires: ["b"] });

  it("picks a saved mission up at the start of its stage, bringing its squads back", () => {
    const def = mission([
      { id: "a", objective: "", goals: [{ when: "inArea", place: "x" }] },
      { id: "b", objective: "", enter: [{ do: "spawn", tag: "wave", faction: "syndicate", members: ["line", "scout"], at: "x" }], goals: [{ when: "destroyed", tag: "wave", count: 2 }] },
    ]);
    const { state } = startMission(def);
    stepMission(def, state, 1, world(["x"]));
    missionEvent(def, state, kill({ tag: "wave" }));
    stepMission(def, state, 5, world());
    expect(resumeMission(def, state)).toEqual([{ do: "stage", stage: "b" }, def.stages[1]!.enter![0]]);
    expect(state).toMatchObject({ stage: "b", goals: [0], time: 0, status: "active" });
  });

  it("offers missions in order, as their requirements are met", () => {
    expect(nextMission([a, b, c], [])?.id).toBe("a");
    expect(nextMission([a, b, c], ["a"])?.id).toBe("b");
    expect(nextMission([a, b, c], ["a", "b", "c"])).toBeNull();
    // With b undone, c is not on offer whatever else is.
    expect(nextMission([b, c], [])).toBeNull();
  });

  it("reads back a saved state, and drops one that no longer fits the mission", () => {
    const { state } = startMission(b);
    missionEvent(b, state, kill());
    state.time = 12.5;
    expect(parseMissionState(JSON.parse(JSON.stringify(state)), [a, b])).toEqual(state);
    expect(parseMissionState({ ...state, id: "gone" }, [a, b])).toBeNull();
    expect(parseMissionState({ ...state, stage: "gone" }, [a, b])).toBeNull();
    expect(parseMissionState({ ...state, goals: [1, 1] }, [a, b])).toBeNull();
    expect(parseMissionState({ ...state, fails: [] }, [a, b])).toBeNull();
    expect(parseMissionState({ ...state, time: -1 }, [a, b])).toBeNull();
    expect(parseMissionState({ ...state, status: "complete" }, [a, b])).toBeNull();
    expect(parseMissionState("junk", [a, b])).toBeNull();
  });
});

describe("mission data", () => {
  const refs = { sites: new Set(buildWorldModel(WORLD).sites.map((s) => s.id)), factions: new Set(Object.keys(FACTIONS)) };

  it("has no problems", () => {
    expect(missionProblems(MISSIONS, refs)).toEqual([]);
    expect(MISSIONS.length).toBeGreaterThan(0);
  });

  it("has no problems whichever patron the player takes", () => {
    for (const patron of PATRONS) {
      const missions = campaign(patron.faction);
      expect(missionProblems(missions, refs)).toEqual([]);
      // The patron's missions follow the shared ones, and none can be reached without a patron.
      expect(missions.slice(0, MISSIONS.length)).toEqual(MISSIONS);
      expect(refs.factions.has(patron.faction)).toBe(true);
      // Six missions, one of each type, ending in a part handed over.
      expect(missions.map((m) => m.type).sort()).toEqual(["assault", "defend", "duel", "escort", "recon", "salvage"]);
      expect(missions.at(-1)!.reward.items).toHaveLength(1);
    }
    expect(campaign(null)).toEqual(MISSIONS);
    expect(MISSIONS.at(-1)!.id).toBe(PATRON_OFFER.after);
  });

  it("is checked: a part given as a reward must be a real one", () => {
    const def = mission([{ id: "a", objective: "", goals: [{ when: "elapsed", seconds: 1 }] }], { reward: { scrap: 0, items: [{ id: "lanceBeam", tier: 3, mods: ["rapid"] }] } });
    expect(missionProblems([def], refs)).toEqual(['test: rewards a part that is not valid: {"id":"lanceBeam","tier":3,"mods":["rapid"]}']);
  });

  it("is checked: pickups must lie somewhere real and be the ones goals wait for", () => {
    const def = mission([
      { id: "a", objective: "", enter: [{ do: "drop", tag: "key", name: "Key", at: "nowhere" }, { do: "drop", tag: "key", name: "Key", at: "post" }], goals: [{ when: "collected", tag: "kee", count: 1 }] },
    ]);
    expect(missionProblems([def], { sites: new Set(["post"]), factions: new Set() })).toEqual([
      'test: pickup "key" lies at unknown place "nowhere"',
      'test: pickup tag "key" is used twice',
      'test: stage "a": no pickup is tagged "kee"',
    ]);
  });

  it("waits for a squad to arrive somewhere, and can fail if it is destroyed on the way", () => {
    const engineer: Action = { do: "spawn", tag: "engineer", faction: "wardens", members: ["scout"], at: "start", route: ["mid", "end"], keep: true };
    const def = mission([
      { id: "a", objective: "", enter: [engineer], goals: [{ when: "arrived", tag: "engineer", place: "mid" }], fail: [{ when: "destroyed", tag: "engineer", count: 1 }] },
      { id: "b", objective: "", enter: [{ ...engineer, at: "mid", route: ["end"] }], goals: [{ when: "arrived", tag: "engineer", place: "end" }], fail: [{ when: "destroyed", tag: "engineer", count: 1 }] },
    ]);
    expect(missionProblems([def], { sites: new Set(["start", "mid", "end"]), factions: new Set(["wardens"]) })).toEqual([]);
    const w = world();
    const { state } = startMission(def);
    expect(stepMission(def, state, 1, w)).toEqual([]);
    w.squads.engineer = "mid";
    expect(stepMission(def, state, 1, w)[0]).toEqual({ do: "stage", stage: "b" });
    missionEvent(def, state, kill({ faction: "wardens", tag: "engineer", byPlayer: false }));
    expect(stepMission(def, state, 1, w)).toEqual([{ do: "fail" }]);

    // A squad named in two stages must be kept in both, and its route and goal must be real.
    const bad = mission([
      { id: "a", objective: "", enter: [{ ...engineer, route: ["nowhere"] }], goals: [{ when: "arrived", tag: "engineer", place: "mid" }] },
      { id: "b", objective: "", enter: [{ ...engineer, keep: false }], goals: [{ when: "arrived", tag: "enginer", place: "moon" }] },
    ]);
    expect(missionProblems([bad], { sites: new Set(["start", "mid", "end"]), factions: new Set(["wardens"]) })).toEqual([
      'test: squad "engineer" has unknown place "nowhere" on its route',
      'test: squad tag "engineer" is used twice',
      'test: stage "b": no squad is tagged "enginer"',
      'test: stage "b": unknown place "moon"',
    ]);
  });

  it("shows the time left on a stage with a limit", () => {
    const def = mission([{ id: "a", objective: "Run: {time}s", goals: [{ when: "inArea", place: "x" }], fail: [{ when: "playerDestroyed" }, { when: "elapsed", seconds: 20 }] }]);
    const { state } = startMission(def);
    stepMission(def, state, 4.5, world());
    expect(objectiveText(def, state, world())).toBe("Run: 16s");
  });

  it("begins with a mission that starts by itself against the first outpost", () => {
    const first = nextMission(MISSIONS, [])!;
    expect(first.auto).toBe(true);
    expect(awaitedSites(first, startMission(first).state)).toEqual([WORLD.missionOutpost]);
  });

  it("is checked: the validator finds each kind of mistake", () => {
    const bad: MissionDef[] = [
      mission(
        [
          { id: "a", objective: "", waypoint: { place: "nowhere", label: "X" }, goals: [{ when: "siteCleared", site: "no-site" }], next: "c" },
          { id: "b", objective: "", goals: [] },
          { id: "c", objective: "", goals: [{ when: "inArea", place: "nowhere" }, { when: "destroyed", count: 0, faction: "nobody", site: "no-site" }], fail: [{ when: "elapsed", seconds: 0 }], next: "z" },
          { id: "c", objective: "", goals: [{ when: "inArea", place: "mine" }] },
        ],
        { id: "m", requires: ["later"], places: { mine: { x: 0, z: 0, radius: 10 } }, reward: { scrap: 0, standing: { nobody: 5 } } },
      ),
      mission([], { id: "later" }),
      mission([{ id: "a", objective: "", goals: [{ when: "inArea", place: BASE_PLACE }] }], { id: "m" }),
    ];
    expect(missionProblems(bad, refs)).toEqual([
      'm: requires "later", which is not an earlier mission',
      'm: rewards standing with unknown faction "nobody"',
      'm: stage "a": waypoint at unknown place "nowhere"',
      'm: stage "a": unknown site "no-site"',
      'm: stage "b": has no goals, so it can never finish',
      'm: stage "c": next stage "z" does not exist',
      'm: stage "c": unknown place "nowhere"',
      'm: stage "c": unknown site "no-site"',
      'm: stage "c": unknown faction "nobody"',
      'm: stage "c": a count must be at least 1',
      'm: stage "c": a time must be more than 0',
      'm: stage "c": duplicate stage id',
      'm: stage "b" can never be reached',
      "later: has no stages",
      "m: duplicate mission id",
    ]);
    const unannounced = mission([{ id: "a", objective: "", goals: [{ when: "inArea", place: BASE_PLACE }] }], { auto: false });
    expect(missionProblems([unannounced], refs)).toEqual(["test: has no briefing, and does not start by itself"]);
  });

  it("is checked: squads must exist, be big enough and appear somewhere real", () => {
    const bad = mission(
      [
        {
          id: "a",
          objective: "",
          enter: [
            { do: "spawn", tag: "wave", faction: "combine", members: ["line", "scout"], at: "kestrel-outpost" },
            { do: "spawn", tag: "wave", faction: "combine", members: [], at: "nowhere" },
          ],
          goals: [{ when: "destroyed", tag: "wave", count: 3 }, { when: "destroyed", tag: "ghosts", count: 1 }],
        },
      ],
      { auto: true },
    );
    expect(missionProblems([bad], refs)).toEqual([
      'test: squad tag "wave" is used twice',
      'test: squad "wave" has no members',
      'test: squad "wave" appears at unknown place "nowhere"',
      'test: stage "a": squad "wave" has fewer than 3 pilots',
      'test: stage "a": no squad is tagged "ghosts"',
    ]);
  });
});
