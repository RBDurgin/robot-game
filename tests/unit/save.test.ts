import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { freshSave, parseSave } from "../../src/game/save";
import { loadoutProblems } from "../../src/sim/loadout";

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
    expect(save.loadout).toEqual({ weapons: { armR: "slugCannon" }, plating: "lightPlating" });
    expect(save.inventory).toEqual(old.inventory);
    expect(save.scrap).toBe(87);
    expect(save.settings).toEqual(old.settings);
    expect(loadoutProblems(FRAMES[save.frame], save.loadout, save.inventory)).toEqual([]);
  });

  it("round-trips the current format", () => {
    const save = freshSave();
    save.frame = "heavy";
    save.loadout = { weapons: { armR: "lanceBeam", shoulderL: "seekerRack" }, plating: "heavyPlating" };
    save.inventory = { lanceBeam: 1, seekerRack: 2, heavyPlating: 1 };
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
    expect(save.loadout).toEqual({ weapons: { armL: "pulseRifle" }, plating: "standardPlating" });
    expect(save.scrap).toBe(0);
    // The inventory always covers what is fitted.
    expect(save.inventory).toEqual({ pulseRifle: 1, standardPlating: 1 });
  });
});
