import { describe, expect, it } from "vitest";
import { areHostile, WAR_FACTION_IDS, isWarFactionId } from "../../src/data/factions";
import { REPUTATION, WAR } from "../../src/data/war";
import { WORLD } from "../../src/data/world";
import { attitudeOf, hostileFactions, parseStanding, recordCapture, recordFriendlyFire, recordKill, startingStanding } from "../../src/sim/reputation";
import { buildWarMap, captureByRaid, clearSite, endRaid, factionTroops, initialWar, parseWar, regionControl, settleRaid, siteCounts, stepWar, QUIET, type WarContext, type WarEvent, type WarState } from "../../src/sim/war";
import { buildWorldModel } from "../../src/sim/worldgen";

const model = buildWorldModel(WORLD);
const map = buildWarMap(model);
const TICKS_PER_HOUR = 3600 / WAR.tickSeconds;

function run(state: WarState, ticks: number, ctx: WarContext = QUIET): WarEvent[] {
  const events: WarEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...stepWar(state, map, ctx));
  return events;
}

describe("war map", () => {
  it("gives every faction one home and a share of the sites", () => {
    const state = initialWar(map);
    const counts = siteCounts(state);
    for (const id of WAR_FACTION_IDS) {
      expect(map.sites.filter((s) => s.home === id).length, id).toBe(1);
      expect(counts[id], id).toBeGreaterThanOrEqual(3);
    }
    expect(state.sites[WORLD.homeBase]).toEqual({ owner: "player", troops: 0 });
    expect(state.sites[WORLD.missionOutpost]).toEqual({ owner: "combine", troops: 5 });
  });

  it("links sites both ways and leaves the player's home out", () => {
    for (const site of map.sites) {
      if (site.playerHome) {
        expect(site.links).toEqual([]);
        continue;
      }
      expect(site.links.length, site.id).toBeGreaterThanOrEqual(WAR.minLinks);
      for (const id of site.links) {
        expect(map.byId.get(id)!.links).toContain(site.id);
        expect(map.byId.get(id)!.playerHome).toBe(false);
      }
    }
  });

  it("puts every faction next to someone it is at war with", () => {
    const state = initialWar(map);
    for (const faction of WAR_FACTION_IDS) {
      const front = map.sites.some(
        (s) =>
          state.sites[s.id]!.owner === faction &&
          s.links.some((id) => {
            const other = state.sites[id]!.owner;
            return isWarFactionId(other) && areHostile(other, faction) && !map.byId.get(id)!.home;
          }),
      );
      expect(front, faction).toBe(true);
    }
  });
});

describe("war tick", () => {
  it("is deterministic: the same war replays exactly, also from a save taken part-way", () => {
    const a = initialWar(map);
    const b = initialWar(map);
    run(a, 400);
    run(b, 400);
    expect(b).toEqual(a);
    const resumed = parseWar(JSON.parse(JSON.stringify(a)), map);
    // Raid ids are renumbered on load; nothing else changes.
    expect(resumed.sites).toEqual(a.sites);
    run(a, 600);
    run(resumed, 600);
    expect(resumed.sites).toEqual(a.sites);
  });

  it("only changes strength by its stated rules", () => {
    const state = initialWar(map);
    for (let i = 0; i < 2 * TICKS_PER_HOUR; i++) {
      const before = Object.fromEntries(WAR_FACTION_IDS.map((f) => [f, factionTroops(state, f)]));
      const events = stepWar(state, map);
      for (const f of WAR_FACTION_IDS) {
        const gained = events.filter((e) => e.type === "reinforced" && state.sites[e.site]!.owner === f).length;
        const fought = events.some((e) => (e.type === "captured" || e.type === "repelled") && (e.by === f || (e.type === "captured" && e.from === f) || state.sites[e.site]!.owner === f));
        const joined = events.some((e) => e.type === "joined" && e.raid.faction === f);
        const now = factionTroops(state, f);
        // Without a battle or a raid standing down, a faction changes only by reinforcement.
        if (!fought && !joined) expect(now, `tick ${state.tick} ${f}`).toBe(before[f]! + gained);
        else expect(now).toBeLessThanOrEqual(before[f]! + gained);
      }
      for (const info of map.sites) {
        const s = state.sites[info.id]!;
        expect(s.troops).toBeGreaterThanOrEqual(0);
        expect(s.troops).toBeLessThanOrEqual(info.capacity);
        if (!isWarFactionId(s.owner)) expect(s.troops).toBe(0);
      }
    }
  });

  it("keeps moving for a long time without anyone being wiped out or running away with it", () => {
    const state = initialWar(map);
    const hours = 12;
    let flips = 0;
    let quietest = 0;
    let sinceFlip = 0;
    let dominated = 0;
    const contested = map.sites.filter((s) => !s.playerHome).length;
    for (let i = 0; i < hours * TICKS_PER_HOUR; i++) {
      const captured = stepWar(state, map).filter((e) => e.type === "captured").length;
      flips += captured;
      sinceFlip = captured ? 0 : sinceFlip + 1;
      quietest = Math.max(quietest, sinceFlip);
      const counts = siteCounts(state);
      for (const f of WAR_FACTION_IDS) {
        expect(counts[f], `${f} at tick ${state.tick}`).toBeGreaterThanOrEqual(1);
        expect(state.sites[map.sites.find((s) => s.home === f)!.id]!.owner).toBe(f);
      }
      if (Math.max(...Object.values(counts)) > contested * 0.6) dominated++;
    }
    const perHour = flips / hours;
    console.log(`war: ${perHour.toFixed(1)} sites change hands per hour; longest lull ${((quietest * WAR.tickSeconds) / 60).toFixed(0)} min; one faction held over 60% for ${((dominated / (hours * TICKS_PER_HOUR)) * 100).toFixed(0)}% of the time; final ${JSON.stringify(siteCounts(state))}`);
    // The front moves over tens of minutes: a site changes hands every 10 to 15 minutes or so.
    expect(perHour).toBeGreaterThan(3.5);
    expect(perHour).toBeLessThan(7.5);
    expect(quietest * WAR.tickSeconds).toBeLessThan(75 * 60);
    expect(dominated / (hours * TICKS_PER_HOUR)).toBeLessThan(0.1);
  });

  it("leaves frozen sites alone and hands observed fights to the game", () => {
    const state = initialWar(map);
    const frozen = WORLD.missionOutpost;
    const watched = "pan-relay";
    const ctx: WarContext = { observed: (id) => id === watched, frozen: (id) => id === frozen, hostileToPlayer: () => false };
    const events = run(state, 6 * TICKS_PER_HOUR, ctx);
    expect(state.sites[frozen]).toEqual({ owner: "combine", troops: 5 });
    expect(events.some((e) => (e.type === "launched" && (e.raid.to === frozen || e.raid.from === frozen)) || (e.type === "reinforced" && e.site === watched))).toBe(false);
    // Nothing is decided at a watched site until the game reports back.
    expect(events.some((e) => (e.type === "captured" || e.type === "repelled") && e.site === watched)).toBe(false);
    const staged = events.find((e) => e.type === "staged");
    expect(staged && staged.type === "staged" && staged.raid.to).toBe(watched);
    expect(state.sites[watched]!.owner).toBe("drifters");
    const raid = state.raids.find((r) => r.staged)!;
    expect(captureByRaid(state, map, raid.id, 2)).toMatchObject({ type: "captured", site: watched, from: "drifters" });
    expect(state.sites[watched]).toEqual({ owner: raid.faction, troops: 2 });
    expect(state.raids.includes(raid)).toBe(false);
  });

  it("settles or ends a staged raid on the game's say-so", () => {
    const state = initialWar(map);
    state.raids.push({ id: 90, faction: "combine", from: "citadel", to: "pan-relay", troops: 4, eta: 0, staged: true });
    expect(endRaid(state, 90)).toMatchObject({ type: "repelled" });
    expect(state.raids).toEqual([]);
    state.raids.push({ id: 91, faction: "combine", from: "citadel", to: "pan-relay", troops: 4, eta: 0, staged: true });
    const result = settleRaid(state, map, 91, 3, 0)!;
    expect(result.type).toBe("captured");
    expect(state.sites["pan-relay"]).toEqual({ owner: "combine", troops: 3 });
  });
});

describe("the player in the war", () => {
  it("takes bases by clearing them and leaves other sites empty for whoever comes next", () => {
    const state = initialWar(map);
    expect(clearSite(state, map, "meridian-gate", true)).toBe("player");
    expect(clearSite(state, map, "pan-relay", true)).toBe(null);
    expect(clearSite(state, map, "citadel", true)).toBe("combine"); // homes do not fall
    expect(state.sites["meridian-gate"]).toEqual({ owner: "player", troops: 0 });
    const events = run(state, 3 * TICKS_PER_HOUR);
    // Somebody walks into the empty outpost.
    expect(events.some((e) => e.type === "captured" && e.site === "pan-relay" && e.from === null)).toBe(true);
    // Nobody is hostile to the player in this run, so the base is left alone.
    expect(state.sites["meridian-gate"]!.owner).toBe("player");
  });

  it("loses an undefended base to a hostile faction, after a warning", () => {
    const state = initialWar(map);
    clearSite(state, map, "meridian-gate", true);
    const ctx: WarContext = { ...QUIET, hostileToPlayer: (f) => f === "combine" };
    let launchedAt = -1;
    for (let i = 0; i < 8 * TICKS_PER_HOUR && state.sites["meridian-gate"]!.owner === "player"; i++) {
      for (const e of stepWar(state, map, ctx)) if (e.type === "launched" && e.raid.to === "meridian-gate" && launchedAt < 0) launchedAt = state.tick;
    }
    expect(state.sites["meridian-gate"]!.owner).toBe("combine");
    expect(launchedAt).toBeGreaterThan(0);
    expect((state.tick - launchedAt) * WAR.tickSeconds).toBeGreaterThanOrEqual(WAR.siegeWarning - WAR.tickSeconds);
    // The home base is never on anyone's list.
    expect(state.sites[WORLD.homeBase]!.owner).toBe("player");
  });

  it("reads regions for the map", () => {
    const state = initialWar(map);
    const control = regionControl(state, map);
    expect(control["kestrel-rise"]).toEqual({ owner: "combine", contested: false });
    expect(control["greywall"]!.owner).toBe("wardens");
    clearSite(state, map, "meridian-gate", true);
    state.raids.push({ id: 5, faction: "syndicate", from: "ember-foundry", to: "meridian-gate", troops: 2, eta: 9, staged: false });
    expect(regionControl(state, map)["old-meridian"]!.contested).toBe(true);
  });

  it("ignores a saved war that does not fit", () => {
    expect(parseWar(null, map)).toEqual(initialWar(map));
    const odd = parseWar({ tick: 7, sites: { citadel: { owner: "drifters", troops: 2 }, "pan-relay": { owner: "nobody", troops: 99 }, "meridian-gate": { owner: "wardens", troops: 99 } }, raids: [{ faction: "combine", from: "nowhere", to: "pan-relay", troops: 2, eta: 3 }] }, map);
    expect(odd.tick).toBe(7);
    expect(odd.sites["citadel"]!.owner).toBe("combine");
    expect(odd.sites["pan-relay"]).toEqual({ owner: null, troops: 0 });
    expect(odd.sites["meridian-gate"]).toEqual({ owner: "wardens", troops: 3 });
    expect(odd.raids).toEqual([]);
  });
});

describe("reputation", () => {
  it("starts with friends and enemies", () => {
    const s = startingStanding();
    expect(attitudeOf(s, "drifters")).toBe("allied");
    expect(attitudeOf(s, "wardens")).toBe("neutral");
    expect(attitudeOf(s, "combine")).toBe("hostile");
    expect(hostileFactions("freelancer", "combine", s)).toBe(true);
    expect(hostileFactions("drifters", "freelancer", s)).toBe(false);
    expect(hostileFactions("drifters", "combine", s)).toBe(true);
    expect(hostileFactions("drifters", "wardens", s)).toBe(false);
    expect(hostileFactions("freelancer", "freelancer", s)).toBe(false);
  });

  it("turns a faction hostile at the threshold and wins over its enemies", () => {
    const s = startingStanding();
    let kills = 0;
    while (attitudeOf(s, "wardens") !== "hostile") {
      recordKill(s, "wardens");
      kills++;
    }
    expect(kills).toBe(Math.ceil((5 - REPUTATION.hostileAt) / -REPUTATION.kill));
    // The Wardens' enemies approve; the Drifters, at peace with them, do not care.
    expect(s.combine).toBe(-60 + kills * REPUTATION.killEnemyOf);
    expect(s.syndicate).toBe(-30 + kills * REPUTATION.killEnemyOf);
    expect(s.drifters).toBe(45);
    recordCapture(s, "combine");
    expect(s.drifters).toBe(45 + REPUTATION.captureEnemyOf);
  });

  it("stays in range and punishes friendly fire by the damage done", () => {
    const s = startingStanding();
    for (let i = 0; i < 50; i++) recordKill(s, "combine");
    expect(s.combine).toBe(REPUTATION.min);
    expect(s.drifters).toBe(REPUTATION.max);
    recordFriendlyFire(s, "drifters", 100);
    expect(s.drifters).toBeCloseTo(REPUTATION.max - 100 * REPUTATION.friendlyFire);
    expect(parseStanding({ drifters: 500, combine: "x" })).toEqual({ ...startingStanding(), drifters: REPUTATION.max });
  });
});
