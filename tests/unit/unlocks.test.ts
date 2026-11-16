import { describe, expect, it } from "vitest";
import { FRAMES, FRAME_IDS } from "../../src/data/frames";
import { UNLOCK_IDS, UNLOCKS, type UnlockDef } from "../../src/data/unlocks";
import { REPUTATION } from "../../src/data/war";
import { freshSave, parseSave, SAVE_VERSION } from "../../src/game/save";
import { fitLoadout } from "../../src/sim/items";
import { startingStanding } from "../../src/sim/reputation";
import { buyUnlock, canUnlock, frameUnlocked, lockProblems, mountUnlocked, unlockNeeds, unlocksUsed, type Progress } from "../../src/sim/unlocks";

const progress = (over: Partial<Progress> = {}): Progress => ({ scrap: 0, unlocks: [], cleared: [], standing: startingStanding(), ...over });

describe("unlocks", () => {
  it("a new pilot has the medium frame and its arms, and nothing else", () => {
    const save = freshSave();
    expect(FRAME_IDS.filter((id) => frameUnlocked(save.unlocks, id))).toEqual(["medium"]);
    expect(mountUnlocked(save.unlocks, "arm")).toBe(true);
    expect(mountUnlocked(save.unlocks, "shoulder")).toBe(false);
    expect(lockProblems(FRAMES[save.frame], save.fit.weapons, save.unlocks)).toEqual([]);
  });

  it("every frame and every kind of mount can be earned, and the data names real things", () => {
    for (const id of UNLOCK_IDS) {
      const u: UnlockDef = UNLOCKS[id];
      expect(u.cost).toBeGreaterThan(0);
      expect(u.frame !== undefined || u.mount !== undefined, id).toBe(true);
      if (u.after) expect(UNLOCK_IDS).toContain(u.after);
    }
    const all = [...UNLOCK_IDS];
    expect(FRAME_IDS.every((id) => frameUnlocked(all, id))).toBe(true);
    expect(mountUnlocked(all, "shoulder")).toBe(true);
  });

  it("scrap alone buys the light frame", () => {
    const p = progress({ scrap: UNLOCKS.lightFrame.cost - 1 });
    expect(buyUnlock(p, "lightFrame")).toBe(false);
    p.scrap += 1;
    expect(buyUnlock(p, "lightFrame")).toBe(true);
    expect(p).toMatchObject({ scrap: 0, unlocks: ["lightFrame"] });
    // Not twice.
    p.scrap = 1000;
    expect(buyUnlock(p, "lightFrame")).toBe(false);
    expect(p.scrap).toBe(1000);
  });

  it("the heavy frame needs a milestone as well as scrap", () => {
    const p = progress({ scrap: 5000, cleared: ["a", "b"] });
    expect(unlockNeeds("heavyFrame", p)).toEqual(["Clear 3 sites (2 so far)"]);
    expect(canUnlock("heavyFrame", p)).toBe(false);
    p.cleared.push("c");
    expect(buyUnlock(p, "heavyFrame")).toBe(true);
  });

  it("shoulder mounts need the heavy frame and a faction's trust", () => {
    const p = progress({ scrap: 5000 });
    expect(unlockNeeds("shoulderMounts", p).length).toBe(2);
    p.unlocks.push("heavyFrame");
    // Being an ally, as the Drifters are from the start, is not enough.
    expect(Math.max(...Object.values(p.standing))).toBeGreaterThanOrEqual(REPUTATION.alliedAt);
    expect(Math.max(...Object.values(p.standing))).toBeLessThan(UNLOCKS.shoulderMounts.standing);
    expect(UNLOCKS.shoulderMounts.standing).toBeLessThanOrEqual(REPUTATION.max);
    expect(unlockNeeds("shoulderMounts", p)).toEqual(["Reach +70 standing with a faction (best so far +45)"]);
    p.standing.wardens = UNLOCKS.shoulderMounts.standing;
    expect(buyUnlock(p, "shoulderMounts")).toBe(true);
    // Falling out with them afterwards does not take the mounts away.
    p.standing.wardens = REPUTATION.min;
    expect(mountUnlocked(p.unlocks, "shoulder")).toBe(true);
  });

  it("a build on a locked frame or mount is refused", () => {
    expect(lockProblems(FRAMES.heavy, { armR: 1 }, [])).toEqual(["The Bastion frame is locked"]);
    expect(lockProblems(FRAMES.heavy, { armR: 1, shoulderL: 2 }, ["heavyFrame"])).toEqual(["The left shoulder mount is locked"]);
    expect(lockProblems(FRAMES.heavy, { armR: 1, shoulderL: 2 }, ["heavyFrame", "shoulderMounts"])).toEqual([]);
  });
});

describe("unlocks in saves", () => {
  it("a save from before there were locks keeps the use of what it was built on", () => {
    expect(unlocksUsed("heavy", { armR: 1, shoulderR: 2 })).toEqual(["heavyFrame", "shoulderMounts"]);
    expect(unlocksUsed("heavy", { armR: 1 })).toEqual(["heavyFrame"]);
    expect(unlocksUsed("medium", { armR: 1 })).toEqual([]);
    // Version 1: a heavy suit with a shoulder rack.
    const old = parseSave({ frame: "heavy", loadout: { weapons: { armR: "slugCannon", shoulderL: "seekerRack" }, plating: "heavyPlating" }, scrap: 9 });
    expect(old).toMatchObject({ version: SAVE_VERSION, frame: "heavy", unlocks: ["heavyFrame", "shoulderMounts"] });
    expect(fitLoadout(old.fit, old.inventory).weapons).toEqual({ armR: "slugCannon", shoulderL: "seekerRack" });
    // Version 2: a light suit.
    const v2 = parseSave({ version: 2, frame: "light", inventory: [{ uid: 1, id: "pulseRifle", tier: 1, mods: [] }], fit: { weapons: { armR: 1 }, plating: 0 } });
    expect(v2).toMatchObject({ frame: "light", unlocks: ["lightFrame"] });
  });

  it("a current save cannot claim a frame or mount it has not unlocked", () => {
    const base = { version: SAVE_VERSION, inventory: [{ uid: 1, id: "arcLauncher", tier: 1, mods: [] }, { uid: 2, id: "pulseRifle", tier: 1, mods: [] }], fit: { weapons: { armR: 2, shoulderR: 1 }, plating: 0 } };
    expect(parseSave({ ...base, frame: "heavy", unlocks: [] }).frame).toBe("medium");
    const noMounts = parseSave({ ...base, frame: "heavy", unlocks: ["heavyFrame", "madeUp"] });
    expect(noMounts).toMatchObject({ frame: "heavy", unlocks: ["heavyFrame"] });
    expect(noMounts.fit.weapons).toEqual({ armR: 2 });
    expect(parseSave({ ...base, frame: "heavy", unlocks: ["heavyFrame", "shoulderMounts"] }).fit.weapons).toEqual({ armR: 2, shoulderR: 1 });
  });
});
