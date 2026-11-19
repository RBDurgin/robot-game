import { FRAMES } from "../data/frames";
import { freshSave, parseSave, type SaveData } from "./save";

export const SLOT_COUNT = 3;

/** Where the game was saved before there were slots. Read once, then left behind. */
export const LEGACY_KEY = "robot-game-save-v1";
/** A slot that could not be read is copied to this slot number plus its own before play goes on. */
export const DAMAGED_SLOT_OFFSET = 100;
/** Which slot is in use; a small preference, so it stays in localStorage. */
export const SLOT_KEY = "robot-game-slot";

/** Somewhere to keep one string per slot. */
export interface Backend {
  get(slot: number): Promise<string | null>;
  set(slot: number, value: string): Promise<void>;
  remove(slot: number): Promise<void>;
}

/** The part of `localStorage` the store uses. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SlotInfo {
  slot: number;
  active: boolean;
  /** Null for an empty slot. */
  summary: { frame: string; scrap: number; parts: number; sites: number; savedAt: number } | null;
}

/** What a slot holds: the save and when it was written. */
interface Stored {
  savedAt: number;
  save: unknown;
}

function decode(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Partial<Stored> | null;
    if (stored && typeof stored === "object" && stored.save && typeof stored.save === "object") {
      return { savedAt: typeof stored.savedAt === "number" ? stored.savedAt : 0, save: stored.save };
    }
  } catch {
    // Unreadable: treated as empty.
  }
  return null;
}

/** Read an exported save file. Throws with a message for the player if it is not one. */
export function readSaveFile(text: string): SaveData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not a save: it is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("scrap" in raw || "inventory" in raw || "frame" in raw)) {
    throw new Error("That file is not a save from this game.");
  }
  return parseSave(raw);
}

/** The text of a save file. It is the save itself, so any version of the game can read it back. */
export const writeSaveFile = (save: SaveData): string => JSON.stringify(save, null, 2);

/**
 * The game's saves: `SLOT_COUNT` slots, one of them in use. Writes are queued and never block
 * play; `flush` waits for them, for the moments just before the page reloads.
 */
export class SaveStore {
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  /**
   * Set by `load` when the slot held something that could not be read: the game starts fresh,
   * and the old contents are kept in the slot's damaged copy (`damagedCopy`) for the player.
   */
  damaged = false;

  constructor(
    private readonly backend: Backend,
    private readonly prefs: KeyValue | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** The slot in use, 1 to `SLOT_COUNT`. */
  get slot(): number {
    let stored = 1;
    try {
      stored = Number(this.prefs?.getItem(SLOT_KEY) ?? 1);
    } catch {
      // Blocked storage: slot 1.
    }
    return Number.isInteger(stored) && stored >= 1 && stored <= SLOT_COUNT ? stored : 1;
  }

  /** Use another slot from the next load on. */
  select(slot: number): void {
    try {
      this.prefs?.setItem(SLOT_KEY, String(slot));
    } catch {
      // Blocked storage: stays on slot 1.
    }
  }

  /**
   * The save in the slot in use, or a fresh one. A save from before there were slots is moved
   * into the slot the first time, provided every slot is empty.
   */
  async load(): Promise<SaveData> {
    let raw: string | null = null;
    try {
      raw = await this.backend.get(this.slot);
      const stored = decode(raw);
      if (stored) return parseSave(stored.save);
      if (raw) throw new Error("unreadable save");
      const legacy = this.prefs?.getItem(LEGACY_KEY);
      if (legacy && (await this.list()).every((s) => s.summary === null)) {
        const save = parseSave(JSON.parse(legacy));
        await this.backend.set(this.slot, this.encode(save));
        this.prefs?.removeItem(LEGACY_KEY);
        return save;
      }
    } catch {
      // Private windows and blocked storage land here; play on with defaults. A save that is
      // there but cannot be read is kept aside first, so starting fresh does not destroy it.
      if (raw) await this.setAside(raw);
    }
    return freshSave();
  }

  private async setAside(raw: string): Promise<void> {
    try {
      await this.backend.set(DAMAGED_SLOT_OFFSET + this.slot, raw);
      this.damaged = true;
    } catch {
      // Nowhere to keep it.
    }
  }

  /** What the slot in use holds, unread: for the player to download when the game cannot start. */
  async rawSlot(): Promise<string | null> {
    try {
      return await this.backend.get(this.slot);
    } catch {
      return null;
    }
  }

  /** The copy `load` kept of an unreadable save in the slot in use, if any. */
  async damagedCopy(): Promise<string | null> {
    try {
      return await this.backend.get(DAMAGED_SLOT_OFFSET + this.slot);
    } catch {
      return null;
    }
  }

  /**
   * The game cannot start from the slot in use: keep a copy of it aside, then empty it so the
   * next start is a fresh game.
   */
  async startOver(): Promise<void> {
    const raw = await this.rawSlot();
    if (raw) await this.setAside(raw);
    this.clear();
    await this.close();
  }

  private encode(save: SaveData): string {
    return JSON.stringify({ savedAt: this.now(), save } satisfies Stored);
  }

  /** Save to the slot in use. Returns at once; not being able to save is not fatal. */
  write(save: SaveData, slot = this.slot): void {
    if (this.closed) return;
    // Encoded now, so later changes to the save cannot leak into this write.
    const value = this.encode(save);
    this.pending = this.pending.then(() => this.backend.set(slot, value)).catch(() => undefined);
  }

  /** Empty a slot. */
  clear(slot = this.slot): void {
    this.pending = this.pending.then(() => this.backend.remove(slot)).catch(() => undefined);
    // An old save must not come back to fill the gap.
    try {
      this.prefs?.removeItem(LEGACY_KEY);
    } catch {
      // Nothing to remove.
    }
  }

  /**
   * Stop saving and wait for what has been written. Called before the page reloads onto another
   * slot or an imported save, so the game still running cannot write over it.
   */
  close(): Promise<void> {
    this.closed = true;
    return this.pending;
  }

  /** Resolves when everything written so far is stored. */
  flush(): Promise<void> {
    return this.pending;
  }

  async list(): Promise<SlotInfo[]> {
    const out: SlotInfo[] = [];
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      let stored: Stored | null = null;
      try {
        stored = decode(await this.backend.get(slot));
      } catch {
        // Shown as empty.
      }
      const save = stored ? parseSave(stored.save) : null;
      out.push({
        slot,
        active: slot === this.slot,
        summary: save && stored ? { frame: FRAMES[save.frame].name, scrap: save.scrap, parts: save.inventory.length, sites: save.cleared.length, savedAt: stored.savedAt } : null,
      });
    }
    return out;
  }
}

/** Slots kept in memory only: for tests, and for browsers that allow no storage at all. */
export function memoryBackend(): Backend {
  const slots = new Map<number, string>();
  return {
    get: async (slot) => slots.get(slot) ?? null,
    set: async (slot, value) => void slots.set(slot, value),
    remove: async (slot) => void slots.delete(slot),
  };
}

/** Slots kept in `localStorage`: the fallback where IndexedDB is not available. */
export function localBackend(storage: KeyValue): Backend {
  const key = (slot: number): string => `robot-game-slot-${slot}`;
  return {
    get: async (slot) => storage.getItem(key(slot)),
    set: async (slot, value) => storage.setItem(key(slot), value),
    remove: async (slot) => storage.removeItem(key(slot)),
  };
}

/** Slots kept in IndexedDB, which has room for saves far larger than `localStorage` allows. */
export function idbBackend(factory: IDBFactory): Promise<Backend> {
  const STORE = "saves";
  return new Promise((resolve, reject) => {
    const open = factory.open("robot-game", 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB unavailable"));
    open.onblocked = () => reject(new Error("IndexedDB blocked"));
    open.onsuccess = () => {
      const db = open.result;
      const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
        new Promise((done, fail) => {
          const tx = db.transaction(STORE, mode);
          const request = work(tx.objectStore(STORE));
          tx.oncomplete = () => done(request.result);
          tx.onerror = tx.onabort = () => fail(tx.error ?? new Error("IndexedDB write failed"));
        });
      resolve({
        get: async (slot) => ((await run("readonly", (s) => s.get(slot) as IDBRequest<unknown>)) as string | undefined) ?? null,
        set: async (slot, value) => void (await run("readwrite", (s) => s.put(value, slot))),
        remove: async (slot) => void (await run("readwrite", (s) => s.delete(slot))),
      });
    };
  });
}

/** The store for this browser: IndexedDB if it works, else `localStorage`, else memory. */
export async function openSaveStore(): Promise<SaveStore> {
  let prefs: KeyValue | null = null;
  try {
    prefs = window.localStorage;
  } catch {
    // Blocked storage.
  }
  let backend: Backend;
  try {
    backend = await idbBackend(window.indexedDB);
  } catch {
    backend = prefs ? localBackend(prefs) : memoryBackend();
  }
  return new SaveStore(backend, prefs);
}
