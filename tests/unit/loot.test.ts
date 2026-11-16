import { describe, expect, it } from "vitest";
import { DANGER, ENEMY_TUNING } from "../../src/data/encounters";
import { WAR_FACTION_IDS } from "../../src/data/factions";
import { ENEMY_LOADOUTS } from "../../src/data/loadouts";
import { CACHE_LOOT, DANGER_LOOT, FACTION_LOOT, LOOT } from "../../src/data/lootTables";
import { MOD_IDS } from "../../src/data/mods";
import { WORLD, type Danger } from "../../src/data/world";
import type { ItemSpec } from "../../src/sim/items";
import { cacheTableFor, lootTableFor, rollCache, rollLoot } from "../../src/sim/loot";
import { makeRng } from "../../src/sim/math";
import { regionAt } from "../../src/sim/terrain";

const DANGERS: Danger[] = [1, 2, 3];

/** Everything dropped by many wrecks of one kind. */
function sample(faction: (typeof WAR_FACTION_IDS)[number], danger: Danger, n = 2000): { items: ItemSpec[]; scrap: number } {
  const rng = makeRng(17);
  const table = lootTableFor(faction, danger);
  const items: ItemSpec[] = [];
  let scrap = 0;
  for (let i = 0; i < n; i++) {
    const drop = rollLoot(ENEMY_LOADOUTS.trooper, rng, table);
    items.push(...drop.items);
    scrap += drop.scrap;
  }
  return { items, scrap: scrap / n };
}

const share = (items: ItemSpec[], test: (item: ItemSpec) => boolean): number => items.filter(test).length / items.length;

describe("region danger", () => {
  it("every region has one, the game starts somewhere gentle, and every level is used", () => {
    const home = WORLD.sites.find((s) => s.id === WORLD.homeBase)!;
    expect(regionAt(WORLD, home.x, home.z).danger).toBe(1);
    const post = WORLD.sites.find((s) => s.id === WORLD.missionOutpost)!;
    expect(regionAt(WORLD, post.x, post.z).danger).toBe(1);
    expect(new Set(WORLD.regions.map((r) => r.danger))).toEqual(new Set(DANGERS));
  });

  it("makes pilots tougher step by step, but never more than the player can answer", () => {
    expect(DANGER[1]).toMatchObject({ armorScale: 1, damageScale: 1 });
    for (const d of [2, 3] as Danger[]) {
      expect(DANGER[d].armorScale).toBeGreaterThan(DANGER[(d - 1) as Danger].armorScale);
      expect(DANGER[d].damageScale).toBeGreaterThan(DANGER[(d - 1) as Danger].damageScale);
    }
    // Even at the top, an AI pilot still hits the player for less than its weapons' face value.
    expect(ENEMY_TUNING.damageScale * DANGER[3].damageScale).toBeLessThan(1);
  });
});

describe("loot tables", () => {
  it("are valid for every faction and danger", () => {
    for (const faction of WAR_FACTION_IDS) {
      for (const mod of Object.keys(FACTION_LOOT[faction].modWeights ?? {})) expect(MOD_IDS).toContain(mod);
      for (const danger of DANGERS) {
        const t = lootTableFor(faction, danger);
        expect(t.weaponChance).toBeGreaterThan(0);
        expect(t.weaponChance).toBeLessThanOrEqual(1);
        expect(t.scrapMax).toBeGreaterThan(t.scrapMin);
        expect(Object.values(t.platingWeights).some((w) => w > 0)).toBe(true);
        expect(t.tierWeights).toEqual(DANGER_LOOT[danger].tierWeights);
      }
    }
    // The plain tables are the danger 1 ones.
    expect(LOOT.tierWeights).toEqual(DANGER_LOOT[1].tierWeights);
    expect(CACHE_LOOT.tierWeights).toEqual(DANGER_LOOT[1].tierWeights);
  });

  it("dangerous regions give better parts and more scrap", () => {
    const safe = sample("combine", 1);
    const hard = sample("combine", 3);
    expect(share(hard.items, (i) => i.tier >= 2)).toBeGreaterThan(share(safe.items, (i) => i.tier >= 2) * 2);
    expect(share(hard.items, (i) => i.tier === 3)).toBeGreaterThan(0.1);
    expect(share(safe.items, (i) => i.tier === 3)).toBeLessThan(0.05);
    expect(hard.scrap).toBeGreaterThan(safe.scrap * 1.5);
  });

  it("each faction's wrecks give up different things", () => {
    const by = Object.fromEntries(WAR_FACTION_IDS.map((f) => [f, sample(f, 2)]));
    const plating = (f: string, id: string): number => share(by[f]!.items.filter((i) => i.id.endsWith("Plating")), (i) => i.id === id);
    expect(plating("wardens", "heavyPlating")).toBeGreaterThan(0.7);
    expect(plating("drifters", "lightPlating")).toBeGreaterThan(0.7);
    const mod = (f: string, m: string): number => share(by[f]!.items.filter((i) => i.mods.length > 0), (i) => (i.mods as string[]).includes(m));
    expect(mod("syndicate", "rapid")).toBeGreaterThan(mod("combine", "rapid") * 1.5);
    expect(mod("drifters", "longRange")).toBeGreaterThan(mod("wardens", "longRange") * 1.5);
    expect(by.syndicate!.scrap).toBeGreaterThan(by.wardens!.scrap);
    expect(by.combine!.items.length).toBeGreaterThan(by.syndicate!.items.length);
  });

  it("crates follow the region too", () => {
    const tiers = (danger: Danger): number => {
      const rng = makeRng(4);
      const items: ItemSpec[] = [];
      for (let i = 0; i < 1500; i++) items.push(...rollCache(rng, cacheTableFor(danger)).items);
      return share(items, (i) => i.tier >= 2);
    };
    expect(tiers(3)).toBeGreaterThan(tiers(1) * 2);
    expect(cacheTableFor(3).scrapMin).toBeGreaterThan(CACHE_LOOT.scrapMin);
  });
});
