import { describe, expect, it } from "vitest";
import { CONTRACTS } from "../../src/data/contracts";
import { areHostile, FACTIONS } from "../../src/data/factions";
import { WORLD } from "../../src/data/world";
import { parseSave } from "../../src/game/save";
import { contractDef, contractId, contractsOnOffer, isContractId, parseContract, type ContractSpec } from "../../src/sim/contracts";
import { missionProblems, startMission } from "../../src/sim/mission";
import { startingStanding } from "../../src/sim/reputation";
import { buildWarMap, initialWar } from "../../src/sim/war";
import { buildWorldModel } from "../../src/sim/worldgen";

const model = buildWorldModel(WORLD);
const map = buildWarMap(model);
const refs = { sites: new Set(model.sites.map((s) => s.id)), factions: new Set(Object.keys(FACTIONS)) };
const danger = (regionId: string) => WORLD.regions.find((r) => r.id === regionId)!.danger;
const friendly = { drifters: 50, wardens: 50, combine: 50, syndicate: 50 };
const board = (war = initialWar(map), standing = startingStanding()) => contractsOnOffer(war, map, standing, danger);

describe("contracts", () => {
  it("come only from factions that will deal with the player, against their enemies", () => {
    const war = initialWar(map);
    const all = [0, 1, 2].flatMap((turn) => board({ ...war, tick: turn * CONTRACTS.refreshTicks }, friendly));
    expect(all.length).toBeGreaterThan(0);
    for (const spec of all) expect(areHostile(spec.giver, spec.enemy)).toBe(true);
    // A new pilot is hostile to the Combine and the Syndicate: neither offers work.
    const offered = board();
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(CONTRACTS.max);
    for (const spec of offered) expect(["drifters", "wardens"]).toContain(spec.giver);
    expect(board(war, { drifters: -90, wardens: -90, combine: -90, syndicate: -90 })).toEqual([]);
  });

  it("reflect the war: raids go at enemy sites on the giver's border, defences stand on the giver's own", () => {
    const war = initialWar(map);
    for (const spec of [0, 1, 2, 3].flatMap((turn) => board({ ...war, tick: turn * CONTRACTS.refreshTicks }, friendly))) {
      const site = map.byId.get(spec.site)!;
      if (spec.kind === "raid") {
        expect(war.sites[site.id]).toMatchObject({ owner: spec.enemy, troops: spec.troops });
        expect(site.home).toBeNull();
        expect(site.links.some((id) => war.sites[id]!.owner === spec.giver)).toBe(true);
      } else {
        expect(war.sites[site.id]!.owner).toBe(spec.giver);
        expect(site.links.some((id) => war.sites[id]!.owner === spec.enemy)).toBe(true);
      }
    }
  });

  it("ask for a site to be held when a raid is marching on it", () => {
    const war = initialWar(map);
    const target = map.sites.find((s) => war.sites[s.id]!.owner === "wardens" && !s.home)!;
    const from = map.sites.find((s) => war.sites[s.id]!.owner === "combine")!;
    war.raids.push({ id: 1, faction: "combine", from: from.id, to: target.id, troops: 3, eta: 20, staged: false });
    const defend = [0, 1, 2, 3].flatMap((turn) => board({ ...war, tick: turn * CONTRACTS.refreshTicks }, friendly)).find((c) => c.kind === "defend" && c.giver === "wardens")!;
    expect(defend).toMatchObject({ site: target.id, enemy: "combine" });
    // The attackers come from the side their base is on.
    const bearing = (defend.bearing * Math.PI) / 180;
    expect(Math.sin(bearing) * (from.x - target.x) + Math.cos(bearing) * (from.z - target.z)).toBeGreaterThan(0);
  });

  it("stop being offered once the work is done", () => {
    const war = initialWar(map);
    const raid = [0, 1, 2, 3].flatMap((turn) => board({ ...war, tick: turn * CONTRACTS.refreshTicks }, friendly)).find((c) => c.kind === "raid")!;
    war.sites[raid.site] = { owner: null, troops: 0 };
    expect([0, 1, 2, 3].flatMap((turn) => board({ ...war, tick: turn * CONTRACTS.refreshTicks }, friendly)).some((c) => c.kind === "raid" && c.site === raid.site)).toBe(false);
  });

  it("each stand for a sound mission, paying more where it is more dangerous", () => {
    const specs = [0, 1, 2, 3].flatMap((turn) => board({ ...initialWar(map), tick: turn * CONTRACTS.refreshTicks }, friendly));
    for (const spec of specs) {
      const def = contractDef(spec);
      expect(missionProblems([def], refs)).toEqual([]);
      expect(isContractId(def.id)).toBe(true);
      expect(def.reward.scrap).toBeGreaterThan(0);
      expect(def.reward.standing).toEqual({ [spec.giver]: CONTRACTS[spec.kind].standing });
    }
    const spec: ContractSpec = { ...specs.find((s) => s.kind === "defend")!, danger: 1 };
    expect(contractDef({ ...spec, danger: 3 }).reward.scrap).toBeGreaterThan(contractDef(spec).reward.scrap);
    // Two waves, the second one bigger, and leaving the ground voids it.
    const def = contractDef(spec);
    expect(def.stages.map((s) => s.goals[0])).toMatchObject([{ when: "inArea" }, { when: "destroyed", count: spec.troops }, { when: "destroyed", count: spec.troops + 1 }]);
    expect(def.stages[1]!.fail).toContainEqual({ when: "outsideArea", place: spec.site, radius: CONTRACTS.defend.radius });
  });

  it("are saved with the mission in progress, and dropped without it", () => {
    const spec = board()[0]!;
    expect(parseContract(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
    for (const junk of [null, 4, {}, { ...spec, kind: "escort" }, { ...spec, giver: "freelancer" }, { ...spec, enemy: spec.giver }, { ...spec, troops: 0 }, { ...spec, danger: 9 }]) expect(parseContract(junk)).toBeNull();
    const active = startMission(contractDef(spec)).state;
    expect(active.id).toBe(contractId(spec));
    const saved = parseSave({ version: 5, missions: { done: ["first-outpost"], active, patron: null, contract: spec } }).missions;
    expect(saved).toEqual({ done: ["first-outpost"], active, patron: null, contract: spec });
    expect(parseSave({ version: 5, missions: { done: [], active: null, contract: spec } }).missions.contract).toBeNull();
    expect(parseSave({ version: 5, missions: { done: [], active, contract: null } }).missions.active).toBeNull();
  });
});
