import { describe, expect, it } from "vitest";
import { freshSave, SAVE_VERSION } from "../../src/game/save";
import { LEGACY_KEY, localBackend, memoryBackend, readSaveFile, SaveStore, SLOT_COUNT, SLOT_KEY, writeSaveFile, type KeyValue } from "../../src/game/saveStore";

function prefs(initial: Record<string, string> = {}): KeyValue & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("SaveStore", () => {
  it("starts fresh on slot 1 with every slot empty", async () => {
    const store = new SaveStore(memoryBackend(), prefs());
    expect(store.slot).toBe(1);
    expect(await store.load()).toEqual(freshSave());
    const slots = await store.list();
    expect(slots.map((s) => s.slot)).toEqual(Array.from({ length: SLOT_COUNT }, (_, i) => i + 1));
    expect(slots.every((s) => s.summary === null)).toBe(true);
    expect(slots.map((s) => s.active)).toEqual([true, false, false]);
  });

  it("writes to the slot in use and reads it back", async () => {
    const backend = memoryBackend();
    const store = new SaveStore(backend, prefs(), () => 1234);
    const save = freshSave();
    save.scrap = 77;
    store.write(save);
    save.scrap = 9999; // changes after the write are not part of it
    await store.flush();
    expect((await new SaveStore(backend, prefs()).load()).scrap).toBe(77);
    expect((await store.list())[0]!.summary).toEqual({ frame: "Warden", scrap: 77, parts: 3, sites: 0, savedAt: 1234 });
  });

  it("keeps slots apart", async () => {
    const backend = memoryBackend();
    const p = prefs();
    const store = new SaveStore(backend, p);
    const one = freshSave();
    one.scrap = 1;
    store.write(one);
    await store.flush();
    store.select(2);
    expect(p.data.get(SLOT_KEY)).toBe("2");
    expect(store.slot).toBe(2);
    expect((await store.load()).scrap).toBe(0);
    const two = freshSave();
    two.scrap = 2;
    store.write(two);
    await store.flush();
    expect((await store.list()).map((s) => s.summary?.scrap ?? null)).toEqual([1, 2, null]);
    store.clear();
    await store.flush();
    expect((await store.list()).map((s) => s.summary?.scrap ?? null)).toEqual([1, null, null]);
    // A slot number that makes no sense falls back to the first.
    p.data.set(SLOT_KEY, "banana");
    expect(store.slot).toBe(1);
  });

  it("moves a save from before there were slots into the first slot, once", async () => {
    const backend = memoryBackend();
    const p = prefs({ [LEGACY_KEY]: JSON.stringify({ loadout: { armL: null, armR: "slugCannon", plating: "lightPlating" }, inventory: { slugCannon: 1 }, scrap: 41 }) });
    const loaded = await new SaveStore(backend, p).load();
    expect(loaded).toMatchObject({ version: SAVE_VERSION, scrap: 41 });
    expect(p.data.has(LEGACY_KEY)).toBe(false);
    expect((await new SaveStore(backend, p).load()).scrap).toBe(41);
    // An old save turning up later does not replace a slot, or fill an empty one beside it.
    p.data.set(LEGACY_KEY, JSON.stringify({ scrap: 5 }));
    expect((await new SaveStore(backend, p).load()).scrap).toBe(41);
    const second = new SaveStore(backend, p);
    second.select(2);
    expect((await second.load()).scrap).toBe(0);
  });

  it("resetting a slot does not bring an old save back", async () => {
    const backend = memoryBackend();
    const p = prefs({ [LEGACY_KEY]: JSON.stringify({ scrap: 41 }) });
    const store = new SaveStore(backend, p);
    await store.load();
    p.data.set(LEGACY_KEY, JSON.stringify({ scrap: 41 }));
    store.clear();
    await store.flush();
    expect((await new SaveStore(backend, p).load()).scrap).toBe(0);
  });

  it("writes nothing once closed", async () => {
    const backend = memoryBackend();
    const store = new SaveStore(backend, prefs());
    const save = freshSave();
    save.scrap = 10;
    store.write(save);
    await store.close();
    save.scrap = 20;
    store.write(save);
    await store.flush();
    expect((await new SaveStore(backend, prefs()).load()).scrap).toBe(10);
  });

  it("survives storage that throws or holds rubbish", async () => {
    const broken = { get: async () => Promise.reject(new Error("no")), set: async () => Promise.reject(new Error("no")), remove: async () => Promise.reject(new Error("no")) };
    const store = new SaveStore(broken, null);
    expect(await store.load()).toEqual(freshSave());
    store.write(freshSave());
    await expect(store.flush()).resolves.toBeUndefined();
    expect((await store.list()).every((s) => s.summary === null)).toBe(true);
    const p = prefs({ "robot-game-slot-1": "{not json" });
    expect(await new SaveStore(localBackend(p), p).load()).toEqual(freshSave());
  });

  it("the localStorage fallback behaves like any other backend", async () => {
    const p = prefs();
    const store = new SaveStore(localBackend(p), p);
    const save = freshSave();
    save.scrap = 3;
    store.write(save);
    await store.flush();
    expect((await new SaveStore(localBackend(p), p).load()).scrap).toBe(3);
  });
});

describe("save files", () => {
  it("round-trip a save", () => {
    const save = freshSave();
    save.scrap = 512;
    save.unlocks = ["lightFrame"];
    expect(readSaveFile(writeSaveFile(save))).toEqual(save);
  });

  it("read a file exported by an older version", () => {
    expect(readSaveFile(JSON.stringify({ loadout: { armL: null, armR: "slugCannon", plating: "lightPlating" }, inventory: { slugCannon: 1 }, scrap: 87 }))).toMatchObject({ version: SAVE_VERSION, scrap: 87 });
  });

  it("refuse anything that is not a save, saying why", () => {
    expect(() => readSaveFile("not json")).toThrow(/not valid JSON/);
    expect(() => readSaveFile("[1, 2]")).toThrow(/not a save from this game/);
    expect(() => readSaveFile('{"name": "something else"}')).toThrow(/not a save from this game/);
  });
});
