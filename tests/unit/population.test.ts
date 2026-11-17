import { describe, expect, it } from "vitest";
import { garrisonCapacity } from "../../src/data/encounters";
import { FACTIONS } from "../../src/data/factions";
import { WAR } from "../../src/data/war";
import { STREAM } from "../../src/data/streaming";
import { WORLD } from "../../src/data/world";
import { rollCache } from "../../src/sim/loot";
import { makeRng } from "../../src/sim/math";
import { buildPopulation, garrisonLeft, missionRecords, populationChanges, raidersLeft, raidRecords, syncGarrison } from "../../src/sim/population";
import { buildWarMap, clearSite, initialWar } from "../../src/sim/war";
import { heightAt } from "../../src/sim/terrain";
import { buildWorldModel } from "../../src/sim/worldgen";

const model = buildWorldModel(WORLD);

const map = buildWarMap(model);
const build = (war = initialWar(map)) => buildPopulation(model, war, { next: 0 });

describe("population", () => {
  it("has one sleeping record per garrison pilot, standing on the ground", () => {
    const records = build();
    const expected = model.sites.reduce((n, s) => n + (s.garrison ? garrisonCapacity(s.garrison) : 0), 0);
    expect(records.length).toBe(expected);
    expect(records.every((r) => r.alive && !r.active)).toBe(true);
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    for (const r of records) expect(r.patrol[0]!.y).toBe(heightAt(model, r.patrol[0]!.x, r.patrol[0]!.z));
    expect(garrisonLeft(records, WORLD.missionOutpost)).toBe(5);
  });

  it("fills a garrison from the roster of whoever holds the site", () => {
    const war = initialWar(map);
    const post = WORLD.missionOutpost;
    const combine = build(war).filter((r) => r.siteId === post);
    expect(combine.map((r) => `${r.member.frame} ${r.member.loadout}`)).toEqual(["medium trooper", "heavy bombard", "medium marksman", "light skirmisher", "light lancer"]);
    war.sites[post] = { owner: "wardens", troops: 3 };
    const wardens = build(war).filter((r) => r.siteId === post);
    expect(wardens.map((r) => r.faction)).toEqual(["wardens", "wardens", "wardens"]);
    // Short-handed, the squad listed first is kept up to strength.
    expect(wardens.map((r) => r.squadId)).toEqual([`${post}:garrison`, `${post}:garrison`, `${post}:garrison`]);
    expect(wardens[0]!.member).toEqual(FACTIONS.wardens.roster.line);
  });

  it("squads at different sites never share an alarm", () => {
    const records = build();
    const bySquad = new Map<string, Set<string>>();
    for (const r of records) bySquad.set(r.squadId, (bySquad.get(r.squadId) ?? new Set()).add(r.siteId));
    for (const sites of bySquad.values()) expect(sites.size).toBe(1);
  });

  it("leaves out sites nobody holds", () => {
    const war = initialWar(map);
    clearSite(war, map, WORLD.missionOutpost, true);
    const records = build(war);
    expect(garrisonLeft(records, WORLD.missionOutpost)).toBe(0);
    expect(records.length).toBe(build().length - 5);
  });

  it("follows the war: a sleeping garrison is replaced, pilots who are awake are kept", () => {
    const war = initialWar(map);
    const ids = { next: 0 };
    const records = buildPopulation(model, war, ids);
    const site = model.siteById.get("pan-relay")!;
    const total = records.length;
    // Taken unseen by two Combine pilots.
    war.sites[site.id] = { owner: "combine", troops: 2 };
    syncGarrison(records, model, site, war, ids);
    const now = records.filter((r) => r.siteId === site.id);
    expect(now.map((r) => r.faction)).toEqual(["combine", "combine"]);
    expect(records.length).toBe(total - 1);
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    // Reinforced while one of them is awake: he stays, with his damage, and one more arrives.
    now[0]!.active = true;
    war.sites[site.id]!.troops = 3;
    syncGarrison(records, model, site, war, ids);
    const after = records.filter((r) => r.siteId === site.id);
    expect(after).toContain(now[0]);
    expect(after.length).toBe(3);
    expect(garrisonLeft(records, site.id, "combine")).toBe(3);
    expect(garrisonLeft(records, site.id, "drifters")).toBe(0);
    // Emptied: nobody is left asleep there.
    war.sites[site.id] = { owner: null, troops: 0 };
    syncGarrison(records, model, site, war, ids);
    expect(records.filter((r) => r.siteId === site.id)).toEqual([now[0]]);
  });

  it("stages a raid outside its target, on the side it came from, apart from the garrison", () => {
    const war = initialWar(map);
    const ids = { next: 0 };
    const records = buildPopulation(model, war, ids);
    const target = model.siteById.get("pan-relay")!;
    const from = model.siteById.get("citadel")!;
    const raid = { id: 7, faction: "combine" as const, from: from.id, to: target.id, troops: 4, eta: 0, staged: true };
    const raiders = raidRecords(model, raid, target, from, WAR.raidSpawnDistance, ids);
    records.push(...raiders);
    expect(raiders.length).toBe(4);
    expect(raidersLeft(records, 7)).toBe(4);
    expect(garrisonLeft(records, target.id)).toBe(3);
    for (const r of raiders) {
      const d = Math.hypot(r.x - target.x, r.z - target.z);
      expect(d).toBeGreaterThan(WAR.raidSpawnDistance - 30);
      expect(d).toBeLessThan(WAR.raidSpawnDistance + 30);
      // Nearer the place they marched from than the target is.
      expect(Math.hypot(r.x - from.x, r.z - from.z)).toBeLessThan(Math.hypot(target.x - from.x, target.z - from.z));
      expect(r.squadId).toBe("raid:7");
      expect(Math.hypot(r.patrol[0]!.x - target.x, r.patrol[0]!.z - target.z)).toBeLessThan(target.radius);
    }
    // The player sees a watched fight coming: raiders appear beyond waking distance of the site's middle only if the site is wide.
    expect(WAR.observeRange).toBeGreaterThan(STREAM.mechSleep + 100);
    expect(WAR.raidSpawnDistance).toBeLessThan(STREAM.mechWake);
  });

  it("wakes the nearest sleepers a few at a time and puts far mechs back to sleep", () => {
    const records = build();
    const post = model.siteById.get(WORLD.missionOutpost)!;
    expect(populationChanges(records, post.x - 2000, post.z, STREAM)).toEqual({ wake: [], sleep: [] });

    const woken = new Set<number>();
    for (let step = 0; step < 20; step++) {
      const { wake, sleep } = populationChanges(records, post.x, post.z - 100, STREAM);
      expect(wake.length).toBeLessThanOrEqual(STREAM.wakesPerStep);
      expect(sleep).toEqual([]);
      for (const r of wake) {
        expect(r.siteId).toBe(post.id);
        r.active = true;
        woken.add(r.id);
      }
    }
    expect(woken.size).toBe(5);

    // Between the two distances nothing changes either way.
    const between = (STREAM.mechWake + STREAM.mechSleep) / 2;
    const one = records.find((r) => r.active)!;
    expect(populationChanges(records, one.x + between, one.z, STREAM).sleep).not.toContain(one);
    expect(populationChanges(records, one.x + STREAM.mechSleep + 10, one.z, STREAM).sleep).toContain(one);
    one.active = false;
    expect(populationChanges([one], one.x + between, one.z, STREAM).wake).toEqual([]);

    // The dead stay dead.
    one.alive = false;
    expect(populationChanges([one], one.x, one.z, STREAM).wake).toEqual([]);
    expect(garrisonLeft(records, post.id)).toBe(4);
  });
});

describe("cache loot", () => {
  it("always gives scrap and sometimes a part", () => {
    const rng = makeRng(5);
    let items = 0;
    for (let i = 0; i < 200; i++) {
      const drop = rollCache(rng);
      expect(drop.scrap).toBeGreaterThanOrEqual(20);
      expect(drop.scrap).toBeLessThanOrEqual(45);
      items += drop.items.length;
    }
    expect(items).toBeGreaterThan(80);
    expect(items).toBeLessThan(160);
  });
});

describe("mission squads", () => {
  it("start out from the place on the bearing given, walk in, and belong to no site", () => {
    const model = buildWorldModel(WORLD);
    const at = model.siteById.get("the-needle")!;
    const ids = { next: 500 };
    const wave = missionRecords(model, { tag: "wave", faction: "syndicate", members: ["line", "scout", "rifle"], at: at.id, distance: 300, bearing: 90, stance: "hostile", alert: true }, at, "mission:test:1", ids);
    expect(wave.map((r) => r.id)).toEqual([500, 501, 502]);
    for (const r of wave) {
      expect(r).toMatchObject({ faction: "syndicate", siteId: "mission:test:1", squadId: "mission:test:1:wave", mission: { tag: "wave", stance: "hostile", alert: true }, alive: true, active: false });
      // East of the place, 300 m out, abreast.
      expect(r.x - at.x).toBeCloseTo(300, 0);
      expect(Math.abs(r.z - at.z)).toBeLessThanOrEqual(14);
      expect(Math.hypot(r.patrol[0]!.x - at.x, r.patrol[0]!.z - at.z)).toBeLessThan(30);
    }
    expect(garrisonLeft(wave, at.id)).toBe(0);
    // With no distance, the squad is already on its loop round the place.
    const team = missionRecords(model, { tag: "team", faction: "combine", members: ["line", "marksman"], at: at.id }, at, "mission:test:1", ids);
    for (const r of team) expect(Math.hypot(r.x - at.x, r.z - at.z)).toBeLessThan(30);
    expect(team[0]!.mission).toEqual({ tag: "team", stance: undefined, alert: false });
  });
});
