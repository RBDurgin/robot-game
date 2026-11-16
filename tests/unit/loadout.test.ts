import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { ENEMY_LOADOUTS, STARTING_LOADOUT, type Loadout } from "../../src/data/loadouts";
import { PLATING } from "../../src/data/parts";
import { WEAPONS } from "../../src/data/weapons";
import { SLICE_SQUADS } from "../../src/data/encounters";
import { addItem, fitToFrame, itemsUsed, loadoutProblems, loadoutStats, startingInventory } from "../../src/sim/loadout";
import { rollLoot } from "../../src/sim/loot";
import { makeRng } from "../../src/sim/math";

const frame = FRAMES.medium;

describe("loadout", () => {
  it("sums mass from weapons and plating", () => {
    const stats = loadoutStats(frame, STARTING_LOADOUT);
    expect(stats.mass).toBeCloseTo(WEAPONS.arcLauncher.mass + WEAPONS.pulseRifle.mass + PLATING.standardPlating.mass, 5);
    expect(stats.overweight).toBe(false);
    expect(stats.mobility).toBeCloseTo(1, 5); // the stock build moves at rated speed
  });

  it("lighter builds are quicker and better-armored builds are slower", () => {
    const light = loadoutStats(frame, { weapons: { armR: "pulseRifle" }, plating: "lightPlating" });
    const heavy = loadoutStats(frame, { weapons: { armR: "slugCannon" }, plating: "heavyPlating" });
    expect(light.mobility).toBeGreaterThan(1);
    expect(heavy.mobility).toBeLessThan(light.mobility);
    expect(heavy.armorScale).toBeGreaterThan(light.armorScale);
  });

  it("flags an overweight build", () => {
    const build: Loadout = { weapons: { armL: "arcLauncher", armR: "slugCannon" }, plating: "heavyPlating" };
    const inv = itemsUsed(build);
    expect(loadoutStats(frame, build).overweight).toBe(true);
    expect(loadoutProblems(frame, build, inv).some((p) => p.includes("Over capacity"))).toBe(true);
  });

  it("requires owning every fitted item, twice for a matched pair", () => {
    const inv = startingInventory(STARTING_LOADOUT);
    expect(loadoutProblems(frame, STARTING_LOADOUT, inv)).toEqual([]);
    const twin: Loadout = { weapons: { armL: "pulseRifle", armR: "pulseRifle" }, plating: "standardPlating" };
    expect(loadoutProblems(frame, twin, inv).length).toBe(1);
    addItem(inv, "pulseRifle");
    expect(loadoutProblems(frame, twin, inv)).toEqual([]);
  });

  it("refuses to deploy unarmed", () => {
    const build: Loadout = { weapons: {}, plating: "standardPlating" };
    expect(loadoutProblems(frame, build, itemsUsed(build))).toContain("No weapon fitted");
  });

  it("every enemy in every squad carries a loadout its frame can deploy", () => {
    for (const squad of SLICE_SQUADS) {
      for (const member of squad.members) {
        const loadout = ENEMY_LOADOUTS[member.loadout];
        expect(loadoutProblems(FRAMES[member.frame], loadout, itemsUsed(loadout)), `${squad.id} ${member.loadout}`).toEqual([]);
      }
    }
  });

  it("squads field more than one frame", () => {
    expect(new Set(SLICE_SQUADS.flatMap((s) => s.members.map((m) => m.frame))).size).toBeGreaterThan(1);
  });
});

describe("hardpoints", () => {
  const heavy = FRAMES.heavy;
  const shoulders: Loadout = { weapons: { armR: "slugCannon", shoulderR: "seekerRack", shoulderL: "arcLauncher" }, plating: "standardPlating" };

  it("only the heavy frame has shoulder mounts", () => {
    expect(heavy.hardpoints.map((h) => h.id)).toEqual(["armR", "armL", "shoulderR", "shoulderL"]);
    expect(FRAMES.light.hardpoints.map((h) => h.id)).toEqual(["armR", "armL"]);
    expect(loadoutProblems(heavy, shoulders, itemsUsed(shoulders))).toEqual([]);
    expect(loadoutProblems(frame, shoulders, itemsUsed(shoulders)).some((p) => p.includes("no mount"))).toBe(true);
  });

  it("shoulder mounts refuse weapons that are not built for them", () => {
    const build: Loadout = { weapons: { shoulderR: "pulseRifle" }, plating: "standardPlating" };
    expect(loadoutProblems(heavy, build, itemsUsed(build)).some((p) => p.includes("does not fit"))).toBe(true);
  });

  it("counts shoulder weapons toward mass and items used", () => {
    const stats = loadoutStats(heavy, shoulders);
    expect(stats.mass).toBeCloseTo(WEAPONS.slugCannon.mass + WEAPONS.seekerRack.mass + WEAPONS.arcLauncher.mass + PLATING.standardPlating.mass, 5);
    expect(itemsUsed(shoulders)).toEqual({ slugCannon: 1, seekerRack: 1, arcLauncher: 1, standardPlating: 1 });
  });

  it("moving a build to a smaller frame drops what it cannot mount", () => {
    expect(fitToFrame(frame, shoulders)).toEqual({ weapons: { armR: "slugCannon" }, plating: "standardPlating" });
    expect(fitToFrame(heavy, shoulders)).toEqual(shoulders);
  });

  it("there are at least seven weapons across four families", () => {
    const all = Object.values(WEAPONS);
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect(new Set(all.map((w) => w.family)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("rollLoot", () => {
  it("is reproducible for a given seed", () => {
    expect(rollLoot(ENEMY_LOADOUTS.trooper, makeRng(7))).toEqual(rollLoot(ENEMY_LOADOUTS.trooper, makeRng(7)));
  });

  it("only drops weapons the enemy carried, and scrap within range", () => {
    const rng = makeRng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const drop = rollLoot(ENEMY_LOADOUTS.marksman, rng);
      expect(drop.scrap).toBeGreaterThanOrEqual(12);
      expect(drop.scrap).toBeLessThanOrEqual(30);
      for (const item of drop.items) seen.add(item);
    }
    expect(seen.has("slugCannon")).toBe(true);
    expect(seen.has("pulseRifle")).toBe(false);
    expect(seen.has("arcLauncher")).toBe(false);
    expect(seen.has("standardPlating")).toBe(false); // weight 0 in the table
    expect(seen.has("heavyPlating") || seen.has("lightPlating")).toBe(true);
  });

  it("respects drop chances at the extremes", () => {
    const never = { weaponChance: 0, platingChance: 0, platingWeights: { lightPlating: 1, standardPlating: 0, heavyPlating: 1 }, scrapMin: 5, scrapMax: 5 };
    expect(rollLoot(ENEMY_LOADOUTS.trooper, makeRng(1), never)).toEqual({ items: [], scrap: 5 });
    const always = { ...never, weaponChance: 1 };
    expect(rollLoot(ENEMY_LOADOUTS.trooper, makeRng(1), always).items).toEqual(["pulseRifle", "arcLauncher"]);
    // Shoulder weapons can be salvaged too.
    expect(rollLoot(ENEMY_LOADOUTS.bombard, makeRng(1), always).items).toEqual(["slugCannon", "seekerRack", "seekerRack"]);
  });
});
