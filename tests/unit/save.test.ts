import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { DEFAULT_QUALITY } from "../../src/data/quality";
import { freshSave, migrateSave, parseSave, SAVE_VERSION } from "../../src/game/save";
import { addItem, fitFromLoadout, fitLoadout, fitProblems } from "../../src/sim/items";

describe("parseSave", () => {
  it("loads a save from before frames and hardpoints existed", () => {
    const old = {
      loadout: { armL: null, armR: "slugCannon", plating: "lightPlating" },
      inventory: { slugCannon: 1, pulseRifle: 2, arcLauncher: 1, lightPlating: 1, standardPlating: 1 },
      scrap: 87,
      settings: { sensitivity: 0.003, volume: 0.4, defaultView: "cockpit" },
    };
    const save = parseSave(old);
    expect(save.frame).toBe("medium");
    expect(save.version).toBe(SAVE_VERSION);
    expect(fitLoadout(save.fit, save.inventory)).toEqual({ weapons: { armR: "slugCannon" }, plating: "lightPlating" });
    // Every part counted in the old inventory is now a plain item of its own.
    expect(save.inventory.map((item) => item.id).sort()).toEqual(["arcLauncher", "lightPlating", "pulseRifle", "pulseRifle", "slugCannon", "standardPlating"]);
    expect(save.inventory.every((item) => item.tier === 1 && item.mods.length === 0)).toBe(true);
    expect(new Set(save.inventory.map((item) => item.uid)).size).toBe(6);
    expect(save.scrap).toBe(87);
    // Saves from before phase 7 have no graphics setting and take the default.
    expect(save.settings).toEqual({ ...old.settings, quality: DEFAULT_QUALITY });
    expect(fitProblems(FRAMES[save.frame], save.fit, save.inventory)).toEqual([]);
  });

  it("keeps a valid graphics quality and replaces a bad one", () => {
    expect(parseSave({ ...freshSave(), settings: { ...freshSave().settings, quality: "high" } }).settings.quality).toBe("high");
    expect(parseSave({ ...freshSave(), settings: { ...freshSave().settings, quality: "ultra" } }).settings.quality).toBe(DEFAULT_QUALITY);
  });

  it("round-trips the current format", () => {
    const save = freshSave();
    save.frame = "heavy";
    save.unlocks = ["heavyFrame", "shoulderMounts"];
    save.inventory = [];
    save.fit = fitFromLoadout({ weapons: { armR: "lanceBeam", shoulderL: "seekerRack" }, plating: "heavyPlating" }, save.inventory);
    addItem(save.inventory, { id: "seekerRack", tier: 3, mods: ["cooled", "light"] });
    addItem(save.inventory, { id: "heavyPlating", tier: 2, mods: ["reinforced"] });
    save.scrap = 12;
    save.standing.wardens = -40;
    save.war = { tick: 12, sites: { "pan-relay": { owner: "combine", troops: 2 } }, raids: [], nextRaid: 1 };
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it("loads a save from before the faction war", () => {
    const save = parseSave({ frame: "light", held: ["tarn-lookout"], cleared: ["kestrel-outpost"], discovered: ["tarn-lookout"] });
    expect(save.held).toEqual(["tarn-lookout"]);
    expect(save.cleared).toEqual(["kestrel-outpost"]);
    expect(save.war).toBeNull();
    expect(save.standing).toEqual(freshSave().standing);
  });

  it("falls back to defaults for anything it does not recognise", () => {
    expect(parseSave(null)).toEqual(freshSave());
    expect(parseSave("nonsense")).toEqual(freshSave());
    const save = parseSave({ frame: "titan", loadout: { weapons: { armR: "deathRay", armL: "pulseRifle" }, plating: "standardPlating" }, scrap: -5 });
    expect(save.frame).toBe("medium");
    expect(fitLoadout(save.fit, save.inventory)).toEqual({ weapons: { armL: "pulseRifle" }, plating: "standardPlating" });
    expect(save.scrap).toBe(0);
    // The inventory always covers what is fitted.
    expect(save.inventory.map((item) => item.id).sort()).toEqual(["pulseRifle", "standardPlating"]);
  });

  it("brings an unversioned save forward and leaves a current one alone", () => {
    const old = migrateSave({ loadout: { armL: null, armR: "slugCannon", plating: "lightPlating" }, inventory: { slugCannon: 1 }, scrap: 3 });
    expect(old.version).toBe(SAVE_VERSION);
    expect(old.loadout).toBeUndefined();
    expect(Array.isArray(old.inventory)).toBe(true);
    const current = JSON.parse(JSON.stringify(freshSave())) as Record<string, unknown>;
    expect(migrateSave(current)).toEqual(current);
  });

  it("drops invalid items and repairs a fit that points at nothing", () => {
    const save = parseSave({
      version: 2,
      inventory: [
        { uid: 1, id: "slugCannon", tier: 9, mods: ["cooled", "reinforced", "nonsense"] },
        { uid: 1, id: "pulseRifle", tier: 1, mods: [] }, // repeated uid
        { uid: 2, id: "deathRay", tier: 1, mods: [] },
        { uid: 3, id: "lanceBeam", tier: 2, mods: ["rapid"] }, // a beam cannot be rapid
        "junk",
      ],
      fit: { weapons: { armR: 1, armL: 1, shoulderR: 77 }, plating: 2 },
    });
    expect(save.inventory.slice(0, 2)).toEqual([
      { uid: 1, id: "slugCannon", tier: 3, mods: ["cooled"] },
      { uid: 3, id: "lanceBeam", tier: 2, mods: [] },
    ]);
    // The same item cannot sit in two mounts, and with no plating owned a standard one is issued.
    expect(save.fit.weapons).toEqual({ armR: 1 });
    expect(fitLoadout(save.fit, save.inventory)).toEqual({ weapons: { armR: "slugCannon" }, plating: "standardPlating" });
    expect(fitProblems(FRAMES.medium, save.fit, save.inventory)).toEqual([]);
  });

  it("carries the built-in first mission over from a version 3 save", () => {
    // Before missions were data, the one mission was over once the first outpost was cleared.
    expect(parseSave({ version: 3, cleared: ["kestrel-outpost"] }).missions).toEqual({ done: ["first-outpost"], active: null, patron: null, contract: null });
    expect(parseSave({ version: 3, cleared: ["pan-relay"] }).missions).toEqual({ done: [], active: null, patron: null, contract: null });
    expect(parseSave({ scrap: 4 }).missions).toEqual({ done: [], active: null, patron: null, contract: null });
  });

  it("keeps a mission in progress, and drops one it cannot make sense of", () => {
    const active = { id: "first-outpost", stage: "return", goals: [0], fails: [], time: 31, status: "active" };
    expect(parseSave({ version: 4, missions: { done: [], active } }).missions).toEqual({ done: [], active, patron: null, contract: null });
    expect(parseSave({ version: 4, missions: { done: ["first-outpost", "no-such-mission", 7], active } }).missions).toEqual({ done: ["first-outpost"], active: null, patron: null, contract: null });
    expect(parseSave({ version: 4, missions: { done: [], active: { ...active, stage: "gone" } } }).missions).toEqual({ done: [], active: null, patron: null, contract: null });
    expect(parseSave({ version: 4, missions: "junk" }).missions).toEqual({ done: [], active: null, patron: null, contract: null });
  });

  it("never leaves the player without a weapon", () => {
    const save = parseSave({ version: 2, inventory: [{ uid: 5, id: "heavyPlating", tier: 1, mods: [] }], fit: { weapons: {}, plating: 5 } });
    expect(fitLoadout(save.fit, save.inventory)).toEqual({ weapons: { armL: "arcLauncher", armR: "pulseRifle" }, plating: "heavyPlating" });
  });
});
