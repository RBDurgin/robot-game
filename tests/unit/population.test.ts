import { describe, expect, it } from "vitest";
import { GARRISONS } from "../../src/data/encounters";
import { STREAM } from "../../src/data/streaming";
import { WORLD } from "../../src/data/world";
import { rollCache } from "../../src/sim/loot";
import { makeRng } from "../../src/sim/math";
import { buildPopulation, garrisonLeft, populationChanges } from "../../src/sim/population";
import { heightAt } from "../../src/sim/terrain";
import { buildWorldModel } from "../../src/sim/worldgen";

const model = buildWorldModel(WORLD);

describe("population", () => {
  it("has one sleeping record per garrison member, standing on the ground", () => {
    const records = buildPopulation(model);
    const expected = model.sites.reduce((n, s) => n + (s.garrison ? GARRISONS[s.garrison].reduce((m, q) => m + q.members.length, 0) : 0), 0);
    expect(records.length).toBe(expected);
    expect(records.every((r) => r.alive && !r.active)).toBe(true);
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    for (const r of records) expect(r.patrol[0]!.y).toBe(heightAt(model, r.patrol[0]!.x, r.patrol[0]!.z));
    expect(garrisonLeft(records, WORLD.missionOutpost)).toBe(5);
  });

  it("squads at different sites never share an alarm", () => {
    const records = buildPopulation(model);
    const bySquad = new Map<string, Set<string>>();
    for (const r of records) bySquad.set(r.squadId, (bySquad.get(r.squadId) ?? new Set()).add(r.siteId));
    for (const sites of bySquad.values()) expect(sites.size).toBe(1);
  });

  it("leaves out garrisons that were already destroyed", () => {
    const records = buildPopulation(model, new Set([WORLD.missionOutpost]));
    expect(garrisonLeft(records, WORLD.missionOutpost)).toBe(0);
    expect(records.length).toBe(buildPopulation(model).length - 5);
  });

  it("wakes the nearest sleepers a few at a time and puts far mechs back to sleep", () => {
    const records = buildPopulation(model);
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
