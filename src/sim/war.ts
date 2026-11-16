import { garrisonCapacity } from "../data/encounters";
import { areHostile, isWarFactionId, WAR_FACTION_IDS, type WarFactionId } from "../data/factions";
import { WAR } from "../data/war";
import type { SiteKind } from "../data/world";
import { makeRng } from "./math";
import { regionAt, type WorldModel } from "./terrain";

/**
 * The faction war. Sites with a garrison are held by a faction, by the player or by nobody, and
 * hold a number of pilots. Every few seconds of play the war takes one tick: sites recover,
 * factions send raids at their neighbours, and raids that arrive are fought out. Everything here
 * is a pure function of the state and the tick number, so a war replays exactly from a save.
 *
 * Where the player is watching ("observed" sites), the game plays the fight out with real mechs
 * and reports the result back through `captureByRaid`, `endRaid` and `setTroops`.
 */

/** Who holds a site: a faction, the player, or nobody. */
export type Holder = WarFactionId | "player" | null;

export interface WarSiteState {
  owner: Holder;
  /** Pilots defending the site. Always 0 for sites the player or nobody holds. */
  troops: number;
}

export interface Raid {
  id: number;
  faction: WarFactionId;
  from: string;
  to: string;
  troops: number;
  /** War ticks until it arrives. */
  eta: number;
  /** Arrived where the player can see it: the game is playing it out with real mechs. */
  staged: boolean;
}

export interface WarState {
  tick: number;
  sites: Record<string, WarSiteState>;
  raids: Raid[];
  nextRaid: number;
}

/** The fixed facts about a site the war is fought over. */
export interface WarSite {
  id: string;
  name: string;
  kind: SiteKind;
  x: number;
  z: number;
  regionId: string;
  /** Pilots at full strength. */
  capacity: number;
  /** The faction whose home this is, or null. Homes are never attacked. */
  home: WarFactionId | null;
  /** The player's own base: outside the war altogether. */
  playerHome: boolean;
  /** Who holds it in a new game. */
  startOwner: WarFactionId;
  /** Ids of the sites raids can go to and come from. */
  links: string[];
}

export interface WarMap {
  seed: number;
  sites: WarSite[];
  byId: Map<string, WarSite>;
}

/** What the war needs to know about the world outside itself. */
export interface WarContext {
  /** The player is near enough to see this site: do not change its garrison behind their back. */
  observed(siteId: string): boolean;
  /** The site is set aside (the opening mission's outpost): nobody raids it or from it. */
  frozen(siteId: string): boolean;
  /** Whether a faction would attack the player's bases. */
  hostileToPlayer(faction: WarFactionId): boolean;
}

export const QUIET: WarContext = { observed: () => false, frozen: () => false, hostileToPlayer: () => false };

export type WarEvent =
  | { type: "reinforced"; site: string }
  | { type: "launched"; raid: Raid }
  /** A raid has reached a site the player is watching: the game must play it out. */
  | { type: "staged"; raid: Raid }
  /** A raid found its target already in friendly hands and joined the garrison (or went home). */
  | { type: "joined"; raid: Raid; site: string }
  | { type: "captured"; site: string; by: WarFactionId; from: Holder; raid: Raid }
  | { type: "repelled"; site: string; by: WarFactionId; raid: Raid };

/** The sites the war is fought over and how they connect. */
export function buildWarMap(model: WorldModel): WarMap {
  const sites: WarSite[] = model.sites
    .filter((s) => s.garrison || s.held)
    .map((s) => {
      const region = regionAt(model.def, s.x, s.z);
      const startOwner = s.faction ?? region.faction;
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        x: s.x,
        z: s.z,
        regionId: region.id,
        capacity: s.garrison ? garrisonCapacity(s.garrison) : 0,
        home: s.home ? startOwner : null,
        playerHome: s.held === true,
        startOwner,
        links: [],
      };
    });
  const contested = sites.filter((s) => !s.playerHome);
  const link = (a: WarSite, b: WarSite): void => {
    if (!a.links.includes(b.id)) a.links.push(b.id);
    if (!b.links.includes(a.id)) b.links.push(a.id);
  };
  for (const site of contested) {
    const others = contested
      .filter((o) => o !== site)
      .map((o) => ({ o, d: Math.hypot(o.x - site.x, o.z - site.z) }))
      .sort((p, q) => p.d - q.d || (p.o.id < q.o.id ? -1 : 1));
    others.forEach(({ o, d }, i) => {
      if (d <= WAR.linkRange || i < WAR.minLinks) link(site, o);
    });
  }
  for (const site of sites) site.links.sort();
  return { seed: model.def.seed, sites, byId: new Map(sites.map((s) => [s.id, s])) };
}

/** The war as a new game finds it: every site at full strength in its first owner's hands. */
export function initialWar(map: WarMap): WarState {
  const sites: Record<string, WarSiteState> = {};
  for (const s of map.sites) sites[s.id] = s.playerHome ? { owner: "player", troops: 0 } : { owner: s.startOwner, troops: s.capacity };
  return { tick: 0, sites, raids: [], nextRaid: 1 };
}

/** Read a saved war, or start a new one if the save has none or it does not fit this world. */
export function parseWar(raw: unknown, map: WarMap): WarState {
  const fresh = initialWar(map);
  if (!raw || typeof raw !== "object") return fresh;
  const data = raw as { tick?: unknown; sites?: unknown; raids?: unknown; nextRaid?: unknown };
  if (typeof data.tick !== "number" || !data.sites || typeof data.sites !== "object") return fresh;
  const state: WarState = { tick: Math.max(0, Math.floor(data.tick)), sites: fresh.sites, raids: [], nextRaid: 1 };
  for (const site of map.sites) {
    if (site.playerHome) continue;
    const s = (data.sites as Record<string, { owner?: unknown; troops?: unknown } | undefined>)[site.id];
    if (!s || typeof s.troops !== "number") continue;
    const owner: Holder = isWarFactionId(s.owner) ? s.owner : s.owner === "player" && site.kind === "base" ? "player" : null;
    // Homes never change hands, whatever the save says.
    if (site.home && owner !== site.home) continue;
    state.sites[site.id] = { owner, troops: isWarFactionId(owner) ? Math.min(site.capacity, Math.max(0, Math.floor(s.troops))) : 0 };
  }
  if (Array.isArray(data.raids)) {
    for (const r of data.raids as Partial<Raid>[]) {
      if (!r || !isWarFactionId(r.faction) || typeof r.from !== "string" || typeof r.to !== "string") continue;
      if (!map.byId.has(r.from) || !map.byId.has(r.to) || typeof r.troops !== "number" || typeof r.eta !== "number") continue;
      const id = state.nextRaid++;
      // A raid that was being played out is back on the march: its mechs were not saved.
      state.raids.push({ id, faction: r.faction, from: r.from, to: r.to, troops: Math.max(1, Math.floor(r.troops)), eta: Math.max(1, Math.floor(r.eta)), staged: false });
    }
  }
  return state;
}

/** How many sites each faction holds. */
export function siteCounts(state: WarState): Record<WarFactionId, number> {
  const out = {} as Record<WarFactionId, number>;
  for (const id of WAR_FACTION_IDS) out[id] = 0;
  for (const s of Object.values(state.sites)) if (isWarFactionId(s.owner)) out[s.owner]++;
  return out;
}

/** Pilots a faction has in garrisons and on the march. */
export function factionTroops(state: WarState, faction: WarFactionId): number {
  let n = 0;
  for (const s of Object.values(state.sites)) if (s.owner === faction) n += s.troops;
  for (const r of state.raids) if (r.faction === faction) n += r.troops;
  return n;
}

function removeRaid(state: WarState, raid: Raid): void {
  const i = state.raids.indexOf(raid);
  if (i >= 0) state.raids.splice(i, 1);
}

/**
 * Fight a raid out unseen. Each round one side loses a pilot; defenders have the edge.
 * `attackers` and `defenders` default to the raid's and the site's full numbers.
 */
function fight(state: WarState, map: WarMap, raid: Raid, rng: () => number, attackers = raid.troops): WarEvent {
  const site = state.sites[raid.to]!;
  const from = site.owner;
  let a = attackers;
  let d = isWarFactionId(site.owner) ? site.troops : 0;
  const defenderWins = WAR.defenderEdge / (1 + WAR.defenderEdge);
  while (a > 0 && d > 0) {
    if (rng() < defenderWins) a--;
    else d--;
  }
  removeRaid(state, raid);
  if (a > 0) {
    site.owner = raid.faction;
    site.troops = Math.min(map.byId.get(raid.to)!.capacity, a);
    return { type: "captured", site: raid.to, by: raid.faction, from, raid };
  }
  site.troops = d;
  return { type: "repelled", site: raid.to, by: raid.faction, raid };
}

/** A raid reaches its target: join it, turn back, hand over to the game, or fight. */
function arrive(state: WarState, map: WarMap, raid: Raid, ctx: WarContext, rng: () => number): WarEvent {
  const target = state.sites[raid.to]!;
  const info = map.byId.get(raid.to)!;
  const friendly = target.owner === raid.faction;
  const truce = isWarFactionId(target.owner) && !friendly && !areHostile(target.owner, raid.faction);
  const spared = target.owner === "player" && !ctx.hostileToPlayer(raid.faction);
  if (friendly || truce || spared) {
    // Nothing to fight: strengthen the place if it is ours, otherwise march home.
    const dest = friendly ? target : state.sites[raid.from]!;
    const destInfo = friendly ? info : map.byId.get(raid.from)!;
    if (dest.owner === raid.faction) dest.troops = Math.min(destInfo.capacity, dest.troops + raid.troops);
    removeRaid(state, raid);
    return { type: "joined", raid, site: friendly ? raid.to : raid.from };
  }
  if (ctx.observed(raid.to)) {
    raid.staged = true;
    return { type: "staged", raid };
  }
  return fight(state, map, raid, rng);
}

/** Pick where a faction's next raid goes from and to, or null if it has no good move. */
function planRaid(state: WarState, map: WarMap, faction: WarFactionId, ctx: WarContext, rng: () => number): { from: WarSite; to: WarSite } | null {
  const counts = siteCounts(state);
  const average = Math.max(1, map.sites.length / WAR_FACTION_IDS.length);
  const options: { from: WarSite; to: WarSite; weight: number }[] = [];
  for (const from of map.sites) {
    const src = state.sites[from.id]!;
    if (src.owner !== faction || src.troops < WAR.raidMin + 1 || ctx.observed(from.id) || ctx.frozen(from.id)) continue;
    for (const id of from.links) {
      const to = map.byId.get(id)!;
      const dst = state.sites[id]!;
      if (to.home || to.playerHome || ctx.frozen(id) || state.raids.some((r) => r.to === id)) continue;
      let weight: number;
      if (dst.owner === null) weight = 3;
      else if (dst.owner === "player") {
        if (!ctx.hostileToPlayer(faction)) continue;
        weight = 1.5;
      } else {
        if (!areHostile(dst.owner, faction)) continue;
        // Everyone leans on whoever is ahead, which is what stops one faction running away with it.
        weight = (counts[dst.owner] / average) ** 2;
      }
      const force = Math.min(WAR.raidMax, src.troops - 1);
      weight *= Math.max(0.25, 1 + (force - dst.troops) * 0.3);
      options.push({ from, to, weight });
    }
  }
  const total = options.reduce((n, o) => n + o.weight, 0);
  if (total <= 0) return null;
  let pick = rng() * total;
  for (const o of options) {
    pick -= o.weight;
    if (pick <= 0) return o;
  }
  return options[options.length - 1]!;
}

/** Advance the war by one tick. Returns what happened, in order. */
export function stepWar(state: WarState, map: WarMap, ctx: WarContext = QUIET): WarEvent[] {
  state.tick++;
  const rng = makeRng((map.seed + Math.imul(state.tick, 0x9e3779b1)) | 0);
  const events: WarEvent[] = [];
  const counts = siteCounts(state);
  const average = Math.max(1, map.sites.length / WAR_FACTION_IDS.length);

  // Sites recover; a faction that has lost ground recovers faster.
  for (const info of map.sites) {
    const site = state.sites[info.id]!;
    const roll = rng();
    if (!isWarFactionId(site.owner) || site.troops >= info.capacity || ctx.observed(info.id) || ctx.frozen(info.id)) continue;
    const chance = info.home ? WAR.homeReinforceChance : WAR.reinforceChance * Math.min(2.5, Math.max(0.5, average / Math.max(1, counts[site.owner])));
    if (roll < chance) {
      site.troops++;
      events.push({ type: "reinforced", site: info.id });
    }
  }

  // Raids on the march.
  for (const raid of [...state.raids]) {
    if (raid.staged || --raid.eta > 0) continue;
    events.push(arrive(state, map, raid, ctx, rng));
  }

  // New raids: one at a time per faction.
  for (const faction of WAR_FACTION_IDS) {
    const roll = rng();
    if (roll >= WAR.raidChance || state.raids.some((r) => r.faction === faction)) continue;
    const plan = planRaid(state, map, faction, ctx, rng);
    if (!plan) continue;
    const src = state.sites[plan.from.id]!;
    const troops = Math.min(WAR.raidMax, src.troops - 1);
    src.troops -= troops;
    const march = Math.hypot(plan.to.x - plan.from.x, plan.to.z - plan.from.z) / WAR.marchSpeed;
    const seconds = state.sites[plan.to.id]!.owner === "player" ? Math.max(march, WAR.siegeWarning) : march;
    const raid: Raid = { id: state.nextRaid++, faction, from: plan.from.id, to: plan.to.id, troops, eta: Math.max(1, Math.ceil(seconds / WAR.tickSeconds)), staged: false };
    state.raids.push(raid);
    events.push({ type: "launched", raid });
  }
  return events;
}

// --- Reports from the game, for fights that were played out with real mechs ---

/** Set a site's garrison to the number of its pilots still alive. */
export function setTroops(state: WarState, siteId: string, troops: number): void {
  const site = state.sites[siteId];
  if (site && isWarFactionId(site.owner)) site.troops = Math.max(0, troops);
}

/** A site's last defender is gone. The player takes bases they clear; anything else stands empty. */
export function clearSite(state: WarState, map: WarMap, siteId: string, byPlayer: boolean): Holder {
  const site = state.sites[siteId]!;
  const info = map.byId.get(siteId)!;
  if (info.home) return site.owner;
  site.owner = byPlayer && info.kind === "base" ? "player" : null;
  site.troops = 0;
  return site.owner;
}

/** A staged raid has beaten the defenders: the site is the raiders', with `survivors` pilots. */
export function captureByRaid(state: WarState, map: WarMap, raidId: number, survivors: number): WarEvent | null {
  const raid = state.raids.find((r) => r.id === raidId);
  if (!raid) return null;
  const site = state.sites[raid.to]!;
  const from = site.owner;
  site.owner = raid.faction;
  site.troops = Math.min(map.byId.get(raid.to)!.capacity, Math.max(1, survivors));
  removeRaid(state, raid);
  return { type: "captured", site: raid.to, by: raid.faction, from, raid };
}

/** A staged raid is over without taking the site (its pilots are dead). */
export function endRaid(state: WarState, raidId: number): WarEvent | null {
  const raid = state.raids.find((r) => r.id === raidId);
  if (!raid) return null;
  removeRaid(state, raid);
  return { type: "repelled", site: raid.to, by: raid.faction, raid };
}

/** The player walked away from a staged raid: finish it unseen with the pilots each side has left. */
export function settleRaid(state: WarState, map: WarMap, raidId: number, attackers: number, defenders: number): WarEvent | null {
  const raid = state.raids.find((r) => r.id === raidId);
  if (!raid) return null;
  setTroops(state, raid.to, defenders);
  if (attackers <= 0) return endRaid(state, raidId);
  const rng = makeRng((map.seed ^ Math.imul(state.tick + 1, 0x85ebca6b) ^ raidId) | 0);
  return fight(state, map, raid, rng, attackers);
}

// --- Reading the war ---

export interface RegionControl {
  /** Who holds most of the region's strength, or null if nobody holds anything there. */
  owner: Holder;
  /** More than one holder has a site here, or a raid is on its way in. */
  contested: boolean;
}

/** Who controls each region, for the map: the holder of most of its garrison capacity. */
export function regionControl(state: WarState, map: WarMap): Record<string, RegionControl> {
  const weights = new Map<string, Map<Holder, number>>();
  const raided = new Set(state.raids.map((r) => map.byId.get(r.to)!.regionId));
  for (const info of map.sites) {
    if (info.playerHome) continue;
    const owner = state.sites[info.id]!.owner;
    const region = weights.get(info.regionId) ?? new Map<Holder, number>();
    region.set(owner, (region.get(owner) ?? 0) + info.capacity);
    weights.set(info.regionId, region);
  }
  const out: Record<string, RegionControl> = {};
  for (const [regionId, region] of weights) {
    let owner: Holder = null;
    let best = 0;
    for (const [holder, weight] of region) {
      if (holder !== null && weight > best) {
        best = weight;
        owner = holder;
      }
    }
    const holders = [...region.keys()].filter((h) => h !== null).length;
    out[regionId] = { owner, contested: holders > 1 || raided.has(regionId) };
  }
  return out;
}
