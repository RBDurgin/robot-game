import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { STARTING_LOADOUT } from "../../src/data/loadouts";
import { CACHE_LOOT, LOOT } from "../../src/data/lootTables";
import { MOD_IDS, MODS, TIERS, type ModDef } from "../../src/data/mods";
import { PLATING } from "../../src/data/parts";
import { WEAPONS, type WeaponDef } from "../../src/data/weapons";
import { PRICES } from "../../src/data/economy";
import { addItem, fitFromLoadout, fitKit, fitLoadout, fitProblems, fitToFrame, modFits, plainSpec, rollSpec, specName, tunedPlating, tunedWeapon, type Inventory } from "../../src/sim/items";
import { kitOf, kitStats, type ItemId } from "../../src/sim/loadout";
import { makeRng } from "../../src/sim/math";

const ITEM_IDS = Object.keys(PRICES) as ItemId[];

describe("tiers and modifiers", () => {
  it("leave a plain Mk I part exactly as the data has it", () => {
    for (const id of Object.keys(WEAPONS) as (keyof typeof WEAPONS)[]) expect(tunedWeapon(plainSpec(id) as { id: typeof id; tier: number; mods: [] })).toEqual(WEAPONS[id]);
    expect(tunedPlating({ id: "heavyPlating", tier: 1, mods: [] })).toEqual(PLATING.heavyPlating);
  });

  it("raise damage or armor by a modest step per tier and nothing else", () => {
    const mk3 = tunedWeapon({ id: "slugCannon", tier: 3, mods: [] });
    expect(mk3.damage).toBeCloseTo(WEAPONS.slugCannon.damage * (1 + 2 * TIERS.step), 1);
    expect({ ...mk3, damage: 0 }).toEqual({ ...WEAPONS.slugCannon, damage: 0 });
    // The best part there is stays within a fifth of a plain one.
    expect(mk3.damage / WEAPONS.slugCannon.damage).toBeLessThan(1.2);
    expect(tunedPlating({ id: "lightPlating", tier: 2, mods: [] }).armorScale).toBeCloseTo(0.7 * 1.08, 3);
  });

  it("apply each modifier to the number it names, always for the better", () => {
    const base: WeaponDef = WEAPONS.pulseRifle;
    expect(tunedWeapon({ id: "pulseRifle", tier: 1, mods: ["cooled"] }).heat).toBeLessThan(base.heat);
    expect(tunedWeapon({ id: "pulseRifle", tier: 1, mods: ["light"] }).mass).toBeLessThan(base.mass);
    expect(tunedWeapon({ id: "pulseRifle", tier: 1, mods: ["longRange"] }).range).toBeGreaterThan(base.range);
    expect(tunedWeapon({ id: "pulseRifle", tier: 1, mods: ["steady"] }).spread).toBeLessThan(base.spread);
    expect(tunedWeapon({ id: "pulseRifle", tier: 1, mods: ["rapid"] }).cooldown).toBeLessThan(base.cooldown);
    expect(tunedPlating({ id: "heavyPlating", tier: 1, mods: ["reinforced", "light"] })).toMatchObject({ armorScale: 1.484, mass: 4.25 });
  });

  it("only offer modifiers that mean something on the part", () => {
    expect(modFits("rapid", "lanceBeam")).toBe(false);
    expect(modFits("rapid", "pulseRifle")).toBe(true);
    expect(modFits("reinforced", "pulseRifle")).toBe(false);
    expect(modFits("cooled", "heavyPlating")).toBe(false);
    expect(modFits("light", "heavyPlating")).toBe(true);
    for (const id of ITEM_IDS) expect(MOD_IDS.filter((m) => modFits(m, id)).length, id).toBeGreaterThanOrEqual(2);
    // No modifier changes a number by more than a quarter.
    for (const m of MOD_IDS) for (const by of Object.values((MODS[m] as ModDef).scale)) expect(Math.abs(by - 1)).toBeLessThanOrEqual(0.25);
  });

  it("name a part by its mark and modifiers", () => {
    expect(specName(plainSpec("slugCannon"))).toBe("SC-9 Slug Cannon");
    expect(specName({ id: "slugCannon", tier: 2, mods: ["cooled", "rapid"] })).toBe("SC-9 Slug Cannon Mk II · Cooled, Rapid");
  });
});

describe("rollSpec", () => {
  it("stays within bounds for every part and both tables, and is reproducible", () => {
    for (const odds of [LOOT, CACHE_LOOT]) {
      const rng = makeRng(3);
      const tiers = [0, 0, 0, 0];
      let modded = 0;
      for (let i = 0; i < 3000; i++) {
        const id = ITEM_IDS[i % ITEM_IDS.length]!;
        const spec = rollSpec(id, rng, odds);
        expect(spec.tier).toBeGreaterThanOrEqual(1);
        expect(spec.tier).toBeLessThanOrEqual(TIERS.max);
        expect(spec.mods.length).toBeLessThanOrEqual(2);
        expect(new Set(spec.mods).size).toBe(spec.mods.length);
        for (const m of spec.mods) expect(modFits(m, id), `${m} on ${id}`).toBe(true);
        tiers[spec.tier]!++;
        if (spec.mods.length > 0) modded++;
      }
      // Most drops are plain Mk I; Mk III is rare but does turn up.
      expect(tiers[1]).toBeGreaterThan(tiers[2]!);
      expect(tiers[2]).toBeGreaterThan(tiers[3]!);
      expect(tiers[3]).toBeGreaterThan(0);
      expect(modded / 3000).toBeCloseTo(odds.modChance, 1);
    }
    expect(rollSpec("pulseRifle", makeRng(9), LOOT)).toEqual(rollSpec("pulseRifle", makeRng(9), LOOT));
  });
});

describe("fits", () => {
  it("a loadout becomes a fit of the player's own items, the best of each kind first", () => {
    const inventory: Inventory = [];
    addItem(inventory, plainSpec("pulseRifle"));
    const good = addItem(inventory, { id: "pulseRifle", tier: 3, mods: [] });
    const fit = fitFromLoadout(STARTING_LOADOUT, inventory);
    expect(fit.weapons.armR).toBe(good.uid);
    expect(fitLoadout(fit, inventory)).toEqual(STARTING_LOADOUT);
    expect(fitProblems(FRAMES.medium, fit, inventory)).toEqual([]);
    // The launcher and plating were missing, so plain ones were added.
    expect(inventory.map((item) => item.id).sort()).toEqual(["arcLauncher", "pulseRifle", "pulseRifle", "standardPlating"]);
  });

  it("a fit's kit carries the items' own numbers, and lighter parts free up capacity", () => {
    const inventory: Inventory = [];
    const fit = fitFromLoadout(STARTING_LOADOUT, inventory);
    expect(fitKit(fit, inventory)).toEqual(kitOf(STARTING_LOADOUT));
    const light = addItem(inventory, { id: "arcLauncher", tier: 2, mods: ["light"] });
    const better = { ...fit, weapons: { ...fit.weapons, armL: light.uid } };
    expect(fitKit(better, inventory).weapons.armL!.damage).toBeGreaterThan(WEAPONS.arcLauncher.damage);
    expect(kitStats(FRAMES.medium, fitKit(better, inventory)).mass).toBeLessThan(kitStats(FRAMES.medium, fitKit(fit, inventory)).mass);
  });

  it("one item cannot be in two mounts, and a missing item is a problem", () => {
    const inventory: Inventory = [];
    const fit = fitFromLoadout({ weapons: { armR: "pulseRifle" }, plating: "standardPlating" }, inventory);
    const twin = { ...fit, weapons: { armR: fit.weapons.armR, armL: fit.weapons.armR } };
    expect(fitProblems(FRAMES.medium, twin, inventory).some((p) => p.includes("fitted twice"))).toBe(true);
    expect(fitProblems(FRAMES.medium, { weapons: { armR: 404 }, plating: fit.plating }, inventory)).toContain("A fitted weapon is no longer in the store");
    expect(fitProblems(FRAMES.medium, { weapons: {}, plating: fit.plating }, inventory)).toContain("No weapon fitted");
  });

  it("changing frame takes off what the new frame cannot mount", () => {
    const inventory: Inventory = [];
    const fit = fitFromLoadout({ weapons: { armR: "slugCannon", shoulderR: "seekerRack", shoulderL: "arcLauncher" }, plating: "standardPlating" }, inventory);
    expect(fitToFrame(FRAMES.heavy, fit, inventory)).toEqual(fit);
    expect(fitToFrame(FRAMES.medium, fit, inventory)).toEqual({ weapons: { armR: fit.weapons.armR }, plating: fit.plating });
  });
});
