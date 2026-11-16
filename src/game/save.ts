import { HARDPOINT_IDS, isFrameId, type FrameId } from "../data/frames";
import { STARTING_LOADOUT, type Loadout } from "../data/loadouts";
import { isPlatingId, isWeaponId, startingInventory, type Inventory } from "../sim/loadout";

export interface Settings {
  /** Radians of look per pixel of mouse travel. */
  sensitivity: number;
  /** 0..1 master volume. */
  volume: number;
  defaultView: "third" | "cockpit";
}

export interface SaveData {
  /** The frame the player's suit is built on. */
  frame: FrameId;
  loadout: Loadout;
  inventory: Inventory;
  scrap: number;
  settings: Settings;
}

const KEY = "robot-game-save-v1";

export const DEFAULT_SETTINGS: Settings = { sensitivity: 0.0022, volume: 0.6, defaultView: "third" };

export function freshSave(): SaveData {
  return {
    frame: "medium",
    loadout: { weapons: { ...STARTING_LOADOUT.weapons }, plating: STARTING_LOADOUT.plating },
    inventory: startingInventory(STARTING_LOADOUT),
    scrap: 0,
    settings: { ...DEFAULT_SETTINGS },
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

/** Build a save from stored data, keeping whatever is valid and defaulting the rest. */
export function parseSave(raw: unknown): SaveData {
  const save = freshSave();
  if (!raw || typeof raw !== "object") return save;
  const data = raw as Record<string, unknown>;
  // Saves from before there was a choice of frame have none: they were all medium.
  if (isFrameId(data.frame)) save.frame = data.frame;
  const loadout = parseLoadout(data.loadout);
  if (loadout) save.loadout = loadout;
  if (data.inventory && typeof data.inventory === "object") {
    const inv: Inventory = {};
    for (const [id, count] of Object.entries(data.inventory)) {
      if ((isWeaponId(id) || isPlatingId(id)) && typeof count === "number" && count > 0) inv[id] = Math.floor(count);
    }
    // Never let a save leave the player without what their loadout needs.
    for (const [id, count] of Object.entries(startingInventory(save.loadout))) {
      const key = id as keyof Inventory;
      inv[key] = Math.max(inv[key] ?? 0, count);
    }
    save.inventory = inv;
  } else {
    save.inventory = startingInventory(save.loadout);
  }
  if (typeof data.scrap === "number" && data.scrap >= 0) save.scrap = Math.floor(data.scrap);
  const s = data.settings as Partial<Settings> | undefined;
  if (s && typeof s === "object") {
    if (typeof s.sensitivity === "number") save.settings.sensitivity = Math.min(0.006, Math.max(0.0005, s.sensitivity));
    if (typeof s.volume === "number") save.settings.volume = Math.min(1, Math.max(0, s.volume));
    if (s.defaultView === "third" || s.defaultView === "cockpit") save.settings.defaultView = s.defaultView;
  }
  return save;
}

/** Load the saved game, falling back to a fresh one if storage is unavailable or the data is bad. */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseSave(JSON.parse(raw));
  } catch {
    // Private windows and blocked storage land here; play on with defaults.
  }
  return freshSave();
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Not being able to save is not fatal.
  }
}
