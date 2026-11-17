/**
 * Scripted missions. A mission is data (`MissionDef`): a list of stages, each with goals to meet
 * and, optionally, ways to fail. This file is the interpreter that walks a mission through its
 * stages. It knows nothing about the game world: the world feeds it events as they happen
 * (`missionEvent`), answers questions about the present (`MissionFacts`), and carries out the
 * effects it hands back (`stepMission`).
 */

import type { RosterSlot, WarFactionId } from "../data/factions";

export type MissionType = "assault" | "defend" | "escort" | "recon" | "salvage" | "duel";

/** A line of dialogue over the radio. */
export interface Line {
  speaker: string;
  text: string;
}

/** A circle on the ground that a mission names for itself. */
export interface PlaceDef {
  x: number;
  z: number;
  radius: number;
}

/** The place id for "the nearest base the player can use", wherever that is at the time. */
export const BASE_PLACE = "base";

/** Things that happen in the world. Counted goals are fed by these. */
export type WorldEvent =
  | { type: "mechDestroyed"; faction: string; site: string | null; tag: string | null; byPlayer: boolean }
  | { type: "siteCleared"; site: string; byPlayer: boolean }
  | { type: "siteCaptured"; site: string; by: string }
  | { type: "itemCollected"; tag: string | null; count: number }
  | { type: "playerDestroyed" };

/**
 * Something a stage waits for. As a goal, a condition stays met once it has been met; a stage
 * is finished when all its goals are. As a way to fail, a condition ends the mission the moment
 * it holds.
 */
export type Condition =
  /** No defenders are left at a site. */
  | { when: "siteCleared"; site: string }
  /** The player is inside a place: a site, one of the mission's own places, or `BASE_PLACE`. */
  | { when: "inArea"; place: string }
  /** The player is not inside a place. */
  | { when: "outsideArea"; place: string }
  /** So many mechs destroyed since the stage began, optionally only those matching. */
  | { when: "destroyed"; count: number; tag?: string; faction?: string; site?: string; byPlayer?: boolean }
  /** So many items picked up since the stage began. */
  | { when: "collected"; count: number; tag?: string }
  /** A site taken by someone (or by `by`) since the stage began. */
  | { when: "siteCaptured"; site: string; by?: string }
  /** The stage has lasted this long. */
  | { when: "elapsed"; seconds: number }
  /** The player's suit destroyed since the stage began. */
  | { when: "playerDestroyed" };

/**
 * A squad a mission brings into the world. Its pilots come from the faction's roster, start
 * `distance` metres from the middle of a place on a compass `bearing`, and walk in to it.
 */
export interface SpawnDef {
  /** Names the squad for `destroyed` goals. Unique within the mission. */
  tag: string;
  faction: WarFactionId;
  members: RosterSlot[];
  at: string;
  /** Metres out from the place. Default 0: the squad starts there, circling it. */
  distance?: number;
  /** Degrees clockwise from north (+Z). Default 0. */
  bearing?: number;
  /**
   * How the squad regards the player whatever their standing with its faction. Without one it
   * behaves as any pilot of its faction would.
   */
  stance?: "hostile" | "allied";
  /** Already hunting when it appears, rather than waiting to spot someone. */
  alert?: boolean;
}

/** Something a mission does to the world on entering a stage or on finishing. */
export type Action = { do: "say"; lines: Line[] } | { do: "notify"; text: string; seconds?: number } | ({ do: "spawn" } & SpawnDef);

export interface StageDef {
  id: string;
  /**
   * The objective line on the HUD. `{left}` is what remains of the first goal (defenders,
   * kills, items or time), `{s}` is "s" unless that is exactly one, and `{salvage}` notes
   * salvage still lying about.
   */
  objective: string;
  /** Where the compass points during the stage. */
  waypoint?: { place: string; label: string };
  /** Done on entering the stage. */
  enter?: Action[];
  /** All must be met to finish the stage. */
  goals: Condition[];
  /** Any one of these fails the mission. */
  fail?: Condition[];
  /** The stage that follows. Without one, the next in the list; the last stage ends the mission. */
  next?: string;
}

export interface MissionDef {
  id: string;
  title: string;
  type: MissionType;
  /** Missions that must be finished before this one is on offer. */
  requires: string[];
  /** Begins by itself as soon as it is on offer, rather than being taken at a base. */
  auto?: boolean;
  /** What the player is told before taking the mission. Missions that start by themselves need none. */
  briefing?: { from: string; text: string[] };
  /** The summary offers to play the mission again from the start. */
  replayable?: boolean;
  /** Places the stages refer to, besides the world's sites. */
  places?: Record<string, PlaceDef>;
  stages: StageDef[];
  /** Done when the last stage is finished, before the summary. */
  complete?: Action[];
  /** Heading and text of the summary shown at the end. */
  debrief: { title: string; text: string };
  /** Paid on completion. Standing is by faction id. */
  reward: { scrap: number; standing?: Record<string, number> };
}

/** Where a mission in progress has got to. Plain data: it is saved as it is. */
export interface MissionState {
  id: string;
  stage: string;
  /** Per goal of the stage: a count for counted goals, 1 once met for the rest. */
  goals: number[];
  /** Per way of failing: the count so far. */
  fails: number[];
  /** Seconds the stage has lasted. */
  time: number;
  status: "active" | "complete" | "failed";
}

/** What the interpreter asks about the world as it stands. */
export interface MissionFacts {
  inArea(place: string): boolean;
  defendersAt(site: string): number;
}

export type MissionEffect = Action | { do: "stage"; stage: string } | { do: "complete" } | { do: "fail" };

const stageOf = (def: MissionDef, id: string): StageDef | undefined => def.stages.find((s) => s.id === id);

/** The stage a mission is in. */
export function currentStage(def: MissionDef, state: MissionState): StageDef {
  return stageOf(def, state.stage) ?? def.stages[0]!;
}

function enterStage(state: MissionState, stage: StageDef): MissionEffect[] {
  state.stage = stage.id;
  state.goals = stage.goals.map(() => 0);
  state.fails = (stage.fail ?? []).map(() => 0);
  state.time = 0;
  return [{ do: "stage", stage: stage.id }, ...(stage.enter ?? [])];
}

/** Begin a mission at its first stage. */
export function startMission(def: MissionDef): { state: MissionState; effects: MissionEffect[] } {
  const state: MissionState = { id: def.id, stage: "", goals: [], fails: [], time: 0, status: "active" };
  return { state, effects: enterStage(state, def.stages[0]!) };
}

/**
 * Pick a saved mission up again. Stages are the checkpoints: the one in progress starts over,
 * because the squads it brought in are not kept in the save.
 */
export function resumeMission(def: MissionDef, state: MissionState): MissionEffect[] {
  return enterStage(state, currentStage(def, state));
}

const targetOf = (c: Condition): number => (c.when === "destroyed" || c.when === "collected" ? c.count : 1);

/** How much an event adds to a counted condition. */
function counted(c: Condition, e: WorldEvent): number {
  switch (c.when) {
    case "destroyed":
      if (e.type !== "mechDestroyed") return 0;
      if (c.tag !== undefined && c.tag !== e.tag) return 0;
      if (c.faction !== undefined && c.faction !== e.faction) return 0;
      if (c.site !== undefined && c.site !== e.site) return 0;
      if (c.byPlayer !== undefined && c.byPlayer !== e.byPlayer) return 0;
      return 1;
    case "collected":
      return e.type === "itemCollected" && (c.tag === undefined || c.tag === e.tag) ? e.count : 0;
    case "siteCaptured":
      return e.type === "siteCaptured" && e.site === c.site && (c.by === undefined || c.by === e.by) ? 1 : 0;
    case "playerDestroyed":
      return e.type === "playerDestroyed" ? 1 : 0;
    default:
      return 0;
  }
}

/** Tell a mission about something that has happened. Stages change in `stepMission`. */
export function missionEvent(def: MissionDef, state: MissionState, event: WorldEvent): void {
  if (state.status !== "active") return;
  const stage = currentStage(def, state);
  stage.goals.forEach((c, i) => (state.goals[i] = (state.goals[i] ?? 0) + counted(c, event)));
  (stage.fail ?? []).forEach((c, i) => (state.fails[i] = (state.fails[i] ?? 0) + counted(c, event)));
}

/** Whether a condition holds now, given the count of matching events so far. */
function holds(c: Condition, count: number, time: number, facts: MissionFacts): boolean {
  switch (c.when) {
    case "siteCleared":
      return facts.defendersAt(c.site) === 0;
    case "inArea":
      return facts.inArea(c.place);
    case "outsideArea":
      return !facts.inArea(c.place);
    case "elapsed":
      return time >= c.seconds;
    default:
      return count >= targetOf(c);
  }
}

/**
 * Advance a mission by `dt` seconds: fail it, or move it on a stage if every goal is met.
 * Returns what the world should do about it, in order.
 */
export function stepMission(def: MissionDef, state: MissionState, dt: number, facts: MissionFacts): MissionEffect[] {
  if (state.status !== "active") return [];
  const stage = currentStage(def, state);
  state.time += dt;
  if ((stage.fail ?? []).some((c, i) => holds(c, state.fails[i] ?? 0, state.time, facts))) {
    state.status = "failed";
    return [{ do: "fail" }];
  }
  let done = true;
  stage.goals.forEach((c, i) => {
    const count = state.goals[i] ?? 0;
    // A goal that is a state of the world (in an area, a site cleared) is latched once seen.
    if (count < targetOf(c) && holds(c, count, state.time, facts)) state.goals[i] = targetOf(c);
    if ((state.goals[i] ?? 0) < targetOf(c)) done = false;
  });
  if (!done) return [];
  const index = def.stages.indexOf(stage);
  const next = stage.next !== undefined ? stageOf(def, stage.next) : def.stages[index + 1];
  if (next) return enterStage(state, next);
  state.status = "complete";
  return [...(def.complete ?? []), { do: "complete" }];
}

/** What is left of a stage's first goal, for the objective line; null if it has no number. */
function remaining(stage: StageDef, state: MissionState, facts: MissionFacts): number | null {
  const goal = stage.goals[0];
  if (!goal) return null;
  if (goal.when === "siteCleared") return facts.defendersAt(goal.site);
  if (goal.when === "elapsed") return Math.max(0, Math.ceil(goal.seconds - state.time));
  if (goal.when === "destroyed" || goal.when === "collected") return Math.max(0, goal.count - (state.goals[0] ?? 0));
  return null;
}

/** The objective line for the HUD. `salvage` is how many crates lie uncollected. */
export function objectiveText(def: MissionDef, state: MissionState, facts: MissionFacts, salvage = 0): string {
  const stage = currentStage(def, state);
  const left = remaining(stage, state, facts);
  return stage.objective
    .replace("{left}", left === null ? "" : String(left))
    .replace("{s}", left === 1 ? "" : "s")
    .replace("{salvage}", salvage > 0 ? ` (${salvage} salvage left)` : "");
}

/** Sites whose garrison a mission in progress is waiting on: the war leaves them alone meanwhile. */
export function awaitedSites(def: MissionDef, state: MissionState): string[] {
  if (state.status !== "active") return [];
  return currentStage(def, state).goals.flatMap((c) => (c.when === "siteCleared" ? [c.site] : []));
}

/** The first mission, in order, that is not done and whose requirements are. */
export function nextMission(defs: readonly MissionDef[], done: readonly string[]): MissionDef | null {
  return defs.find((m) => !done.includes(m.id) && m.requires.every((id) => done.includes(id))) ?? null;
}

/**
 * Read a saved mission state, checking it against the mission as it is now written. A state
 * that no longer fits (the stage is gone, the goals have changed) is dropped: null.
 */
export function parseMissionState(raw: unknown, defs: readonly MissionDef[]): MissionState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<MissionState>;
  const def = defs.find((m) => m.id === r.id);
  const stage = def && typeof r.stage === "string" ? stageOf(def, r.stage) : undefined;
  const counts = (v: unknown, n: number): number[] | null =>
    Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) ? [...(v as number[])] : null;
  if (!def || !stage || r.status !== "active") return null;
  const goals = counts(r.goals, stage.goals.length);
  const fails = counts(r.fails, (stage.fail ?? []).length);
  if (!goals || !fails || typeof r.time !== "number" || !Number.isFinite(r.time) || r.time < 0) return null;
  return { id: def.id, stage: stage.id, goals, fails, time: r.time, status: "active" };
}

/** What the missions may refer to, for `missionProblems`. */
export interface MissionRefs {
  sites: ReadonlySet<string>;
  factions: ReadonlySet<string>;
}

/** Everything wrong with a set of missions as written. Empty when they are sound. */
export function missionProblems(defs: readonly MissionDef[], refs: MissionRefs): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const def of defs) {
    const say = (text: string) => problems.push(`${def.id}: ${text}`);
    if (ids.has(def.id)) say("duplicate mission id");
    ids.add(def.id);
    for (const id of def.requires) if (!defs.slice(0, defs.indexOf(def)).some((m) => m.id === id)) say(`requires "${id}", which is not an earlier mission`);
    for (const f of Object.keys(def.reward.standing ?? {})) if (!refs.factions.has(f)) say(`rewards standing with unknown faction "${f}"`);
    if (def.stages.length === 0) {
      say("has no stages");
      continue;
    }
    const place = (id: string): boolean => id === BASE_PLACE || refs.sites.has(id) || def.places?.[id] !== undefined;
    const stageIds = new Set<string>();
    const spawns = def.stages.flatMap((stage) => (stage.enter ?? []).flatMap((a) => (a.do === "spawn" ? [a] : [])));
    const tags = new Set<string>();
    for (const spawn of spawns) {
      if (tags.has(spawn.tag)) say(`squad tag "${spawn.tag}" is used twice`);
      tags.add(spawn.tag);
      if (spawn.members.length === 0) say(`squad "${spawn.tag}" has no members`);
      if (!place(spawn.at) || spawn.at === BASE_PLACE) say(`squad "${spawn.tag}" appears at unknown place "${spawn.at}"`);
    }
    if (!def.auto && !def.briefing) say("has no briefing, and does not start by itself");
    for (const stage of def.stages) {
      const at = (text: string) => say(`stage "${stage.id}": ${text}`);
      if (stageIds.has(stage.id)) at("duplicate stage id");
      stageIds.add(stage.id);
      if (stage.goals.length === 0) at("has no goals, so it can never finish");
      if (stage.next !== undefined && !stageOf(def, stage.next)) at(`next stage "${stage.next}" does not exist`);
      if (stage.waypoint && !place(stage.waypoint.place)) at(`waypoint at unknown place "${stage.waypoint.place}"`);
      for (const c of [...stage.goals, ...(stage.fail ?? [])]) {
        if ((c.when === "inArea" || c.when === "outsideArea") && !place(c.place)) at(`unknown place "${c.place}"`);
        if ((c.when === "siteCleared" || c.when === "siteCaptured") && !refs.sites.has(c.site)) at(`unknown site "${c.site}"`);
        if (c.when === "destroyed" && c.site !== undefined && !refs.sites.has(c.site)) at(`unknown site "${c.site}"`);
        if (c.when === "destroyed" && c.tag !== undefined && !tags.has(c.tag)) at(`no squad is tagged "${c.tag}"`);
        if (c.when === "destroyed" && c.tag !== undefined && c.count > (spawns.find((sp) => sp.tag === c.tag)?.members.length ?? Infinity)) at(`squad "${c.tag}" has fewer than ${c.count} pilots`);
        if (c.when === "destroyed" && c.faction !== undefined && !refs.factions.has(c.faction)) at(`unknown faction "${c.faction}"`);
        if ((c.when === "destroyed" || c.when === "collected") && !(c.count >= 1)) at("a count must be at least 1");
        if (c.when === "elapsed" && !(c.seconds > 0)) at("a time must be more than 0");
      }
    }
    // Walk the stages from the first: any not visited can never be played.
    const reached = new Set<string>();
    for (let stage: StageDef | undefined = def.stages[0]; stage && !reached.has(stage.id); ) {
      reached.add(stage.id);
      stage = stage.next !== undefined ? stageOf(def, stage.next) : def.stages[def.stages.indexOf(stage) + 1];
    }
    for (const stage of def.stages) if (!reached.has(stage.id)) say(`stage "${stage.id}" can never be reached`);
  }
  return problems;
}
