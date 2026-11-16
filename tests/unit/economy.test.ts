import { describe, expect, it } from "vitest";
import { ECONOMY, PRICES } from "../../src/data/economy";
import { FRAMES, FRAME_IDS } from "../../src/data/frames";
import { STARTING_LOADOUT } from "../../src/data/loadouts";
import { LOOT } from "../../src/data/lootTables";
import { applyDamage, createHealth, repairAll } from "../../src/sim/damage";
import { buyItem, buyPrice, isSpare, repairBill, repairCost, sellItem, sellPrice, type Wallet } from "../../src/sim/economy";
import { addItem, fitFromLoadout, plainSpec, type Fit, type Inventory } from "../../src/sim/items";
import type { ItemId } from "../../src/sim/loadout";

describe("repairs", () => {
  it("cost nothing for an undamaged suit and more as damage mounts", () => {
    const h = createHealth(FRAMES.medium);
    expect(repairCost(h)).toBe(0);
    applyDamage(h, "legs", 40);
    const some = repairCost(h);
    applyDamage(h, "torso", 80);
    const more = repairCost(h);
    expect(some).toBe(Math.ceil(40 * ECONOMY.repairPerPoint));
    expect(more).toBeGreaterThan(some);
    repairAll(h);
    expect(repairCost(h)).toBe(0);
  });

  it("are capped, and never take more than the player has", () => {
    expect(repairBill(30, 500)).toBe(30);
    expect(repairBill(1000, 500)).toBe(ECONOMY.repairCap);
    expect(repairBill(60, 25)).toBe(25);
    expect(repairBill(60, 0)).toBe(0);
  });

  it("price a lost suit at a few kills' worth of scrap on every frame", () => {
    const kill = (LOOT.scrapMin + LOOT.scrapMax) / 2;
    for (const id of FRAME_IDS) {
      const h = createHealth(FRAMES[id]);
      applyDamage(h, "torso", 1e6);
      const bill = repairBill(repairCost(h), 1e6);
      expect(bill).toBeGreaterThanOrEqual(kill * 0.5);
      expect(bill).toBeLessThanOrEqual(kill * 5);
    }
  });
});

describe("shop", () => {
  const wallet = (scrap: number): Wallet & { fit: Fit } => {
    const inventory: Inventory = [];
    const fit = fitFromLoadout(STARTING_LOADOUT, inventory);
    return { scrap, inventory, fit };
  };

  it("sells for less than it buys, so trading round in circles loses scrap", () => {
    for (const id of Object.keys(PRICES) as ItemId[]) {
      expect(buyPrice(id)).toBeGreaterThan(0);
      expect(sellPrice(plainSpec(id))).toBeGreaterThan(0);
      expect(sellPrice(plainSpec(id))).toBeLessThan(buyPrice(id));
    }
  });

  it("values better marks and modified parts above plain ones", () => {
    const plain = sellPrice(plainSpec("slugCannon"));
    const mk3 = sellPrice({ id: "slugCannon", tier: 3, mods: [] });
    const modded = sellPrice({ id: "slugCannon", tier: 3, mods: ["cooled", "rapid"] });
    expect(mk3).toBeGreaterThan(plain);
    expect(modded).toBeGreaterThan(mk3);
  });

  it("buys only what the player can afford, and what it buys is plain", () => {
    const w = wallet(PRICES.slugCannon - 1);
    expect(buyItem(w, "slugCannon")).toBeNull();
    expect(w).toEqual(wallet(PRICES.slugCannon - 1));
    w.scrap += 1;
    const bought = buyItem(w, "slugCannon");
    expect(bought).toMatchObject({ id: "slugCannon", tier: 1, mods: [] });
    expect(w.scrap).toBe(0);
    expect(w.inventory).toContain(bought);
    expect(new Set(w.inventory.map((item) => item.uid)).size).toBe(w.inventory.length);
  });

  it("will not sell a part that a fit is using", () => {
    const w = wallet(0);
    const launcher = w.fit.weapons.armL!;
    // The launcher is off the bench build but still on the deployed one.
    const bench: Fit = { weapons: { armR: w.fit.weapons.armR }, plating: w.fit.plating };
    expect(isSpare(launcher, [bench])).toBe(true);
    expect(sellItem(w, launcher, [bench, w.fit])).toBe(false);
    expect(w.scrap).toBe(0);
    const second = addItem(w.inventory, plainSpec("arcLauncher"));
    expect(sellItem(w, second.uid, [bench, w.fit])).toBe(true);
    expect(sellItem(w, second.uid, [bench, w.fit])).toBe(false);
    expect(w.inventory.filter((item) => item.id === "arcLauncher").length).toBe(1);
    expect(w.scrap).toBe(sellPrice(plainSpec("arcLauncher")));
  });
});
