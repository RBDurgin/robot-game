import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { ENEMY_LOADOUTS, STARTING_LOADOUT, type Loadout } from "../../src/data/loadouts";
import { PLATING } from "../../src/data/parts";
import { WEAPONS } from "../../src/data/weapons";
import { addItem, itemsUsed, loadoutProblems, loadoutStats, startingInventory } from "../../src/sim/loadout";
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
    const light = loadoutStats(frame, { armL: null, armR: "pulseRifle", plating: "lightPlating" });
    const heavy = loadoutStats(frame, { armL: null, armR: "slugCannon", plating: "heavyPlating" });
    expect(light.mobility).toBeGreaterThan(1);
    expect(heavy.mobility).toBeLessThan(light.mobility);
    expect(heavy.armorScale).toBeGreaterThan(light.armorScale);
  });

  it("flags an overweight build", () => {
    const build: Loadout = { armL: "arcLauncher", armR: "slugCannon", plating: "heavyPlating" };
    const inv = itemsUsed(build);
    expect(loadoutStats(frame, build).overweight).toBe(true);
    expect(loadoutProblems(frame, build, inv).some((p) => p.includes("Over capacity"))).toBe(true);
  });

  it("requires owning every fitted item, twice for a matched pair", () => {
    const inv = startingInventory(STARTING_LOADOUT);
    expect(loadoutProblems(frame, STARTING_LOADOUT, inv)).toEqual([]);
    const twin: Loadout = { armL: "pulseRifle", armR: "pulseRifle", plating: "standardPlating" };
    expect(loadoutProblems(frame, twin, inv).length).toBe(1);
    addItem(inv, "pulseRifle");
    expect(loadoutProblems(frame, twin, inv)).toEqual([]);
  });

  it("refuses to deploy unarmed", () => {
    const build: Loadout = { armL: null, armR: null, plating: "standardPlating" };
    expect(loadoutProblems(frame, build, itemsUsed(build))).toContain("No weapon fitted");
  });

  it("every enemy loadout is deployable", () => {
    for (const loadout of Object.values(ENEMY_LOADOUTS)) {
      expect(loadoutProblems(frame, loadout, itemsUsed(loadout))).toEqual([]);
    }
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
  });
});
