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
  loadout: Loadout;
  inventory: Inventory;
  scrap: number;
  settings: Settings;
}

const KEY = "robot-game-save-v1";

export const DEFAULT_SETTINGS: Settings = { sensitivity: 0.0022, volume: 0.6, defaultView: "third" };

export function freshSave(): SaveData {
  return {
    loadout: { ...STARTING_LOADOUT },
    inventory: startingInventory(STARTING_LOADOUT),
    scrap: 0,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Load the saved game, falling back to a fresh one if storage is unavailable or the data is bad. */
export function loadSave(): SaveData {
  const save = freshSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return save;
    const data = JSON.parse(raw) as Partial<SaveData>;
    const l = data.loadout;
    if (l && isPlatingId(l.plating) && (l.armL === null || isWeaponId(l.armL)) && (l.armR === null || isWeaponId(l.armR))) {
      save.loadout = { armL: l.armL, armR: l.armR, plating: l.plating };
    }
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
    }
    if (typeof data.scrap === "number" && data.scrap >= 0) save.scrap = Math.floor(data.scrap);
    const s = data.settings;
    if (s) {
      if (typeof s.sensitivity === "number") save.settings.sensitivity = Math.min(0.006, Math.max(0.0005, s.sensitivity));
      if (typeof s.volume === "number") save.settings.volume = Math.min(1, Math.max(0, s.volume));
      if (s.defaultView === "third" || s.defaultView === "cockpit") save.settings.defaultView = s.defaultView;
    }
  } catch {
    // Private windows and blocked storage land here; play on with defaults.
  }
  return save;
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Not being able to save is not fatal.
  }
}
