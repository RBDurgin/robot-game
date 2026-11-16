import { describe, expect, it } from "vitest";
import { ECONOMY, PRICES } from "../../src/data/economy";
import { FRAMES, FRAME_IDS } from "../../src/data/frames";
import { STARTING_LOADOUT, type Loadout } from "../../src/data/loadouts";
import { LOOT } from "../../src/data/lootTables";
import { applyDamage, createHealth, repairAll } from "../../src/sim/damage";
import { buyItem, buyPrice, repairBill, repairCost, sellItem, sellPrice, spareCount, type Wallet } from "../../src/sim/economy";
import { startingInventory, type ItemId } from "../../src/sim/loadout";

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
  const wallet = (scrap: number): Wallet => ({ scrap, inventory: startingInventory(STARTING_LOADOUT) });

  it("sells for less than it buys, so trading round in circles loses scrap", () => {
    for (const id of Object.keys(PRICES) as ItemId[]) {
      expect(buyPrice(id)).toBeGreaterThan(0);
      expect(sellPrice(id)).toBeGreaterThan(0);
      expect(sellPrice(id)).toBeLessThan(buyPrice(id));
    }
  });

  it("buys only what the player can afford", () => {
    const w = wallet(PRICES.slugCannon - 1);
    expect(buyItem(w, "slugCannon")).toBe(false);
    expect(w).toEqual(wallet(PRICES.slugCannon - 1));
    w.scrap += 1;
    expect(buyItem(w, "slugCannon")).toBe(true);
    expect(w.scrap).toBe(0);
    expect(w.inventory.slugCannon).toBe(1);
  });

  it("will not sell a part that a loadout is using", () => {
    const w = wallet(0);
    const bench: Loadout = { weapons: { armR: "pulseRifle" }, plating: "standardPlating" };
    // The launcher is off the bench build but still on the deployed one.
    expect(spareCount(w.inventory, "arcLauncher", [bench])).toBe(1);
    expect(sellItem(w, "arcLauncher", [bench, STARTING_LOADOUT])).toBe(false);
    expect(w.scrap).toBe(0);
    w.inventory.arcLauncher = 2;
    expect(sellItem(w, "arcLauncher", [bench, STARTING_LOADOUT])).toBe(true);
    expect(sellItem(w, "arcLauncher", [bench, STARTING_LOADOUT])).toBe(false);
    expect(w.inventory.arcLauncher).toBe(1);
    expect(w.scrap).toBe(sellPrice("arcLauncher"));
  });

  it("removes the last of an item from the inventory when it is sold", () => {
    const w = wallet(0);
    w.inventory.heavyPlating = 1;
    expect(sellItem(w, "heavyPlating", [STARTING_LOADOUT])).toBe(true);
    expect("heavyPlating" in w.inventory).toBe(false);
  });
});
