import { FRAMES, HARDPOINT_IDS, isFrameId, type FrameId } from "../data/frames";
import { STARTING_LOADOUT, type Loadout } from "../data/loadouts";
import { isWarFactionId, type WarFactionId } from "../data/factions";
import { campaign } from "../data/missions";
import { patronOf } from "../data/patrons";
import { addItem, findItem, fitFromLoadout, isPlatingItem, isWeaponItem, parseSpec, plainSpec, type Fit, type Inventory, type Item } from "../sim/items";
import { isPlatingId, isWeaponId } from "../sim/loadout";
import { contractDef, contractId, parseContract, type ContractSpec } from "../sim/contracts";
import { parseMissionState, type MissionState } from "../sim/mission";
import { parseStanding, startingStanding, type Standing } from "../sim/reputation";
import { frameUnlocked, isUnlockId, mountUnlocked, unlocksUsed } from "../sim/unlocks";
import type { UnlockId } from "../data/unlocks";
import type { WarState } from "../sim/war";

export interface Settings {
  /** Radians of look per pixel of mouse travel. */
  sensitivity: number;
  /** 0..1 master volume. */
  volume: number;
  defaultView: "third" | "cockpit";
}

/**
 * The save format's version. Saves from before versions were written count as 1, whatever phase
 * they came from: `parseSave` has always read those leniently. Each later change adds a step to
 * `MIGRATIONS`, so any old save is brought forward one version at a time.
 *
 * 2: parts are individual items with a tier and modifiers; the loadout became a `fit` of them.
 * 3: frames and shoulder mounts have to be unlocked.
 * 4: scripted missions: which are done and how far the one in progress has got.
 * 5: the patron the player chose at the midpoint of the campaign, and the contract in progress.
 */
export const SAVE_VERSION = 5;

export interface SaveData {
  version: number;
  /** The frame the player's suit is built on. */
  frame: FrameId;
  /** Which of the player's items are on the suit. */
  fit: Fit;
  /** Every part the player owns, fitted ones included. */
  inventory: Inventory;
  scrap: number;
  /** Frames and mounts the player has earned the use of. */
  unlocks: UnlockId[];
  settings: Settings;
  /** Where the player was last, or null to start at the home base. */
  position: SavedPosition | null;
  /** Ids of sites the player has found. They show on the map. */
  discovered: string[];
  /** Ids of bases the player holds, besides their home. Kept in step with the war. */
  held: string[];
  /** Ids of sites whose garrison the player has destroyed at some time. */
  cleared: string[];
  /** Ids of sites whose salvage cache has been taken. */
  looted: string[];
  /** The player's standing with each faction. */
  standing: Standing;
  /**
   * The faction war, or null before the first game (and in saves from before phase 4, where
   * `held` and `cleared` say what the player had done). Checked against the world when the game
   * starts, by `parseWar`.
   */
  war: WarState | null;
  /** Scripted missions: the ids of those finished, and the one in progress. */
  missions: MissionProgress;
}

export interface MissionProgress {
  done: string[];
  active: MissionState | null;
  /** The faction the player took as patron at the midpoint of the campaign, once they have. */
  patron: WarFactionId | null;
  /** The contract `active` is the mission of, when it is one. */
  contract: ContractSpec | null;
}

export interface SavedPosition {
  x: number;
  z: number;
  yaw: number;
}

export const DEFAULT_SETTINGS: Settings = { sensitivity: 0.0022, volume: 0.6, defaultView: "third" };

export function freshSave(): SaveData {
  const inventory: Inventory = [];
  return {
    version: SAVE_VERSION,
    frame: "medium",
    fit: fitFromLoadout(STARTING_LOADOUT, inventory),
    inventory,
    scrap: 0,
    unlocks: [],
    settings: { ...DEFAULT_SETTINGS },
    position: null,
    discovered: [],
    held: [],
    cleared: [],
    looted: [],
    standing: startingStanding(),
    war: null,
    missions: { done: [], active: null, patron: null, contract: null },
  };
}

/**
 * Read a loadout in either shape: the current one (`weapons` keyed by hardpoint) or the one
 * saved before frames had hardpoints (`armL` and `armR` beside the plating).
 */
function parseLoadout(raw: unknown): Loadout | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  if (!isPlatingId(l.plating)) return null;
  const source = (l.weapons && typeof l.weapons === "object" ? l.weapons : l) as Record<string, unknown>;
  const weapons: Loadout["weapons"] = {};
  for (const id of HARDPOINT_IDS) {
    const weapon = source[id];
    if (isWeaponId(weapon)) weapons[id] = weapon;
  }
  return { weapons, plating: l.plating };
}

/** A list of ids, dropping anything that is not a string and any repeats. */
function parseIds(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === "string"))] : [];
}

/**
 * Version 1 to 2: the inventory was a count per part id and the loadout named part ids. Every
 * part owned becomes a plain Mk I item, and the fit picks out the ones the loadout used. A
 * loadout always gets its parts, even if the old inventory did not list them.
 */
function toItems(data: Record<string, unknown>): void {
  const inventory: Inventory = [];
  if (data.inventory && typeof data.inventory === "object" && !Array.isArray(data.inventory)) {
    for (const [id, count] of Object.entries(data.inventory)) {
      if (!(isWeaponId(id) || isPlatingId(id)) || typeof count !== "number") continue;
      for (let i = 0; i < Math.min(99, Math.floor(count)); i++) addItem(inventory, plainSpec(id));
    }
  }
  const loadout = parseLoadout(data.loadout) ?? STARTING_LOADOUT;
  data.fit = fitFromLoadout(loadout, inventory);
  data.inventory = inventory;
  delete data.loadout;
}

/**
 * Version 2 to 3: there were no locks, so a pilot already on another frame, or with weapons on
 * their shoulders, keeps the use of what they have. Anything else is still to be earned.
 */
function toUnlocks(data: Record<string, unknown>): void {
  const slots = ((data.fit as { weapons?: unknown } | undefined)?.weapons ?? {}) as Record<string, unknown>;
  data.unlocks = isFrameId(data.frame) ? unlocksUsed(data.frame, slots) : [];
}

/**
 * Version 3 to 4: there was one mission, built into the game: clear the first outpost and come
 * home. It counted as over once the outpost had been cleared, and still does.
 */
function toMissions(data: Record<string, unknown>): void {
  const cleared = Array.isArray(data.cleared) && data.cleared.includes("kestrel-outpost");
  data.missions = { done: cleared ? ["first-outpost"] : [], active: null };
}

/** Version 4 to 5: nobody had been asked to choose a patron yet, and there were no contracts. */
function toPatron(data: Record<string, unknown>): void {
  if (data.missions && typeof data.missions === "object") data.missions = { ...data.missions, patron: null, contract: null };
}

/** `MIGRATIONS[n]` turns version n data into version n + 1, in place. */
const MIGRATIONS: Record<number, (data: Record<string, unknown>) => void> = { 1: toItems, 2: toUnlocks, 3: toMissions, 4: toPatron };

/** A copy of stored data brought up to the current version. */
export function migrateSave(raw: Record<string, unknown>): Record<string, unknown> {
  const data = { ...raw };
  let version = typeof data.version === "number" && data.version >= 1 ? Math.floor(data.version) : 1;
  for (; version < SAVE_VERSION; version++) MIGRATIONS[version]!(data);
  data.version = SAVE_VERSION;
  return data;
}

/** Read the items and the fit, dropping anything invalid, and never leave the suit unusable. */
function parseParts(data: Record<string, unknown>): { inventory: Inventory; fit: Fit } {
  const inventory: Inventory = [];
  for (const raw of Array.isArray(data.inventory) ? data.inventory : []) {
    const spec = parseSpec(raw);
    const uid = (raw as { uid?: unknown } | null)?.uid;
    if (!spec || typeof uid !== "number" || !Number.isInteger(uid) || uid < 1 || findItem(inventory, uid)) continue;
    inventory.push({ uid, ...spec });
  }
  const stored = (data.fit && typeof data.fit === "object" ? data.fit : {}) as { weapons?: unknown; plating?: unknown };
  const slots = (stored.weapons && typeof stored.weapons === "object" ? stored.weapons : {}) as Record<string, unknown>;
  const weapons: Fit["weapons"] = {};
  const used = new Set<number>();
  for (const id of HARDPOINT_IDS) {
    const item = typeof slots[id] === "number" ? findItem(inventory, slots[id]) : undefined;
    if (!item || !isWeaponItem(item) || used.has(item.uid)) continue;
    weapons[id] = item.uid;
    used.add(item.uid);
  }
  // With no weapon to their name the player could be stuck: issue the starting pair again.
  if (!inventory.some((item: Item) => isWeaponItem(item))) Object.assign(weapons, fitFromLoadout(STARTING_LOADOUT, inventory).weapons);
  const fitted = typeof stored.plating === "number" ? findItem(inventory, stored.plating) : undefined;
  const plating = fitted && isPlatingItem(fitted) ? fitted : (inventory.find((item) => isPlatingItem(item)) ?? addItem(inventory, plainSpec(STARTING_LOADOUT.plating)));
  return { inventory, fit: { weapons, plating: plating.uid } };
}

/** Build a save from stored data, keeping whatever is valid and defaulting the rest. */
export function parseSave(raw: unknown): SaveData {
  const save = freshSave();
  if (!raw || typeof raw !== "object") return save;
  const data = migrateSave(raw as Record<string, unknown>);
  save.unlocks = Array.isArray(data.unlocks) ? [...new Set(data.unlocks.filter(isUnlockId))] : [];
  // Saves from before there was a choice of frame have none: they were all medium.
  if (isFrameId(data.frame) && frameUnlocked(save.unlocks, data.frame)) save.frame = data.frame;
  Object.assign(save, parseParts(data));
  // Nothing stays on a mount the player has no use of.
  for (const h of FRAMES[save.frame].hardpoints) if (!mountUnlocked(save.unlocks, h.mount)) delete save.fit.weapons[h.id];
  if (typeof data.scrap === "number" && data.scrap >= 0) save.scrap = Math.floor(data.scrap);
  const s = data.settings as Partial<Settings> | undefined;
  if (s && typeof s === "object") {
    if (typeof s.sensitivity === "number") save.settings.sensitivity = Math.min(0.006, Math.max(0.0005, s.sensitivity));
    if (typeof s.volume === "number") save.settings.volume = Math.min(1, Math.max(0, s.volume));
    if (s.defaultView === "third" || s.defaultView === "cockpit") save.settings.defaultView = s.defaultView;
  }
  // Saves from before the open world have none of these: the player starts at home with
  // nothing found. Ids are checked against the world when they are used.
  const p = data.position as Partial<SavedPosition> | null | undefined;
  if (p && typeof p === "object" && [p.x, p.z, p.yaw].every((v) => typeof v === "number" && Number.isFinite(v))) {
    save.position = { x: p.x!, z: p.z!, yaw: p.yaw! };
  }
  save.discovered = parseIds(data.discovered);
  save.held = parseIds(data.held);
  save.cleared = parseIds(data.cleared);
  save.looted = parseIds(data.looted);
  // Saves from before the faction war have neither of these: the war starts afresh around
  // what the player had taken and cleared.
  save.standing = parseStanding(data.standing);
  save.war = data.war && typeof data.war === "object" ? (data.war as WarState) : null;
  // A mission that has been rewritten since the save restarts from its first stage.
  const m = (data.missions && typeof data.missions === "object" ? data.missions : {}) as { done?: unknown; active?: unknown; patron?: unknown; contract?: unknown };
  const patron = isWarFactionId(m.patron) && patronOf(m.patron) ? m.patron : null;
  const missions = campaign(patron);
  const done = parseIds(m.done).filter((id) => missions.some((def) => def.id === id));
  // A contract is kept only with the mission it stands for.
  const contract = parseContract(m.contract);
  const active = parseMissionState(m.active, contract ? [...missions, contractDef(contract)] : missions);
  const working = active !== null && contract !== null && active.id === contractId(contract);
  save.missions = { done, active: active && !done.includes(active.id) ? active : null, patron, contract: working ? contract : null };
  return save;
}
