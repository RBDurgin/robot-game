/**
 * Contracts: repeatable missions the factions offer, generated from the state of the war. A
 * faction that will deal with the player asks them to raid an enemy site on its border, or to
 * help hold one of its own that an enemy threatens. A contract is a small `ContractSpec`, which
 * is what is saved; the mission it stands for is built from it by `contractDef`.
 */

import { CONTRACTS } from "../data/contracts";
import { areHostile, FACTIONS, isWarFactionId, WAR_FACTION_IDS, type RosterSlot, type WarFactionId } from "../data/factions";
import type { MissionDef } from "./mission";
import { attitudeOf, type Standing } from "./reputation";
import type { WarMap, WarSite, WarState } from "./war";

export type ContractKind = "raid" | "defend";

export interface ContractSpec {
  kind: ContractKind;
  /** Who is paying. */
  giver: WarFactionId;
  /** Who it is against. */
  enemy: WarFactionId;
  site: string;
  siteName: string;
  /** Raid: defenders at the site when posted. Defend: pilots in the first wave. */
  troops: number;
  /** Danger of the region, 1 to 3. */
  danger: number;
  /** Defend: the compass bearing the attackers come from, degrees. */
  bearing: number;
}

export const CONTRACT_PREFIX = "contract:";
export const contractId = (spec: ContractSpec): string => `${CONTRACT_PREFIX}${spec.kind}:${spec.site}`;
export const isContractId = (id: string): boolean => id.startsWith(CONTRACT_PREFIX);

const WAVE: RosterSlot[] = ["line", "scout", "rifle", "heavy", "lancer"];

const pay = (scrap: number, danger: number): number => Math.round((scrap * (CONTRACTS.dangerPay[danger] ?? 1)) / 10) * 10;

/** The mission a contract stands for. */
export function contractDef(spec: ContractSpec): MissionDef {
  const giver = FACTIONS[spec.giver];
  const enemy = FACTIONS[spec.enemy];
  const from = `${giver.name} dispatch`;
  if (spec.kind === "raid") {
    return {
      id: contractId(spec),
      title: `Contract: raid ${spec.siteName}`,
      type: "assault",
      requires: [],
      briefing: {
        from,
        text: [
          `The ${enemy.short} are holding ${spec.siteName} on our border, ${spec.troops} ${spec.troops === 1 ? "suit" : "suits"} strong at last count. We want it emptied.`,
          "Destroy the garrison. What happens to the place afterwards is not your concern, and the salvage is yours.",
        ],
      },
      stages: [
        {
          id: "clear",
          objective: `Clear ${spec.siteName}: {left} defender{s} left`,
          waypoint: { place: spec.site, label: "RAID" },
          goals: [{ when: "siteCleared", site: spec.site }],
        },
      ],
      debrief: { title: "Contract complete", text: `${spec.siteName} is cleared, and the ${giver.short} have paid what they promised.` },
      reward: { scrap: pay(CONTRACTS.raid.scrapPerPilot * spec.troops, spec.danger), standing: { [spec.giver]: CONTRACTS.raid.standing } },
    };
  }
  const wave = (n: number): RosterSlot[] => Array.from({ length: n }, (_, i) => WAVE[i % WAVE.length]!);
  const fail = [{ when: "outsideArea", place: spec.site, radius: CONTRACTS.defend.radius } as const, { when: "playerDestroyed" } as const];
  const attack = (tag: string, n: number, swing: number) =>
    ({ do: "spawn", tag, faction: spec.enemy, members: wave(n), at: spec.site, distance: CONTRACTS.defend.distance, bearing: spec.bearing + swing, stance: "hostile", alert: true }) as const;
  return {
    id: contractId(spec),
    title: `Contract: hold ${spec.siteName}`,
    type: "defend",
    requires: [],
    briefing: {
      from,
      text: [
        `The ${enemy.short} are massing against ${spec.siteName}. We cannot spare the suits to meet them, so we are hiring one.`,
        "Get there and stand with the garrison until the attack is broken. Leave the ground and the contract is void.",
      ],
    },
    stages: [
      { id: "travel", objective: `Go to ${spec.siteName}`, waypoint: { place: spec.site, label: "DEFEND" }, goals: [{ when: "inArea", place: spec.site, radius: 90 }] },
      {
        id: "wave-1",
        objective: `Hold ${spec.siteName}: {left} ${enemy.short} suit{s} closing`,
        waypoint: { place: spec.site, label: "DEFEND" },
        enter: [{ do: "notify", text: `${enemy.short} suits inbound. Hold ${spec.siteName}.`, seconds: 5 }, attack("wave-1", spec.troops, 0)],
        goals: [{ when: "destroyed", tag: "wave-1", count: spec.troops }],
        fail,
      },
      {
        id: "wave-2",
        objective: `Hold ${spec.siteName}: {left} ${enemy.short} suit{s} closing`,
        waypoint: { place: spec.site, label: "DEFEND" },
        enter: [{ do: "notify", text: "A second group is coming in.", seconds: 5 }, attack("wave-2", spec.troops + 1, 35)],
        goals: [{ when: "destroyed", tag: "wave-2", count: spec.troops + 1 }],
        fail,
      },
    ],
    debrief: { title: "Contract complete", text: `The attack on ${spec.siteName} is broken, and the ${giver.short} have paid what they promised.` },
    reward: { scrap: pay(CONTRACTS.defend.scrap + 30 * spec.troops, spec.danger), standing: { [spec.giver]: CONTRACTS.defend.standing } },
  };
}

/** Compass bearing from one point to another, degrees clockwise from north (+Z). */
const bearingTo = (from: { x: number; z: number }, to: { x: number; z: number }): number => Math.round(((Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI + 360) % 360);

/**
 * The contracts on the board: for each faction that will deal with the player, the strongest
 * enemy site on its border to raid, and its own most threatened site to hold. The board turns
 * over as the war goes on. `dangerOf` gives the danger of a region.
 */
export function contractsOnOffer(war: WarState, map: WarMap, standing: Standing, dangerOf: (regionId: string) => number): ContractSpec[] {
  const owner = (site: WarSite) => war.sites[site.id]?.owner ?? null;
  const troops = (site: WarSite) => war.sites[site.id]?.troops ?? 0;
  const neighbours = (site: WarSite): WarSite[] => site.links.flatMap((id) => map.byId.get(id) ?? []);
  const out: { spec: ContractSpec; weight: number }[] = [];
  for (const giver of WAR_FACTION_IDS) {
    if (attitudeOf(standing, giver) === "hostile") continue;
    const enemyOf = (site: WarSite): WarFactionId | null => {
      const o = owner(site);
      return isWarFactionId(o) && areHostile(giver, o) ? o : null;
    };
    const mine = map.sites.filter((s) => owner(s) === giver);
    // Raid: the strongest enemy site next to one of the giver's. Homes are never taken, so never asked for.
    let raid: WarSite | null = null;
    for (const site of mine) {
      for (const n of neighbours(site)) {
        if (!enemyOf(n) || n.home || n.playerHome || troops(n) === 0) continue;
        if (!raid || troops(n) > troops(raid) || (troops(n) === troops(raid) && n.id < raid.id)) raid = n;
      }
    }
    if (raid) out.push({ weight: troops(raid), spec: { kind: "raid", giver, enemy: enemyOf(raid)!, site: raid.id, siteName: raid.name, troops: troops(raid), danger: dangerOf(raid.regionId), bearing: 0 } });
    // Defend: the giver's site with a raid marching on it, or failing that the most enemy pilots next door.
    let defend: { site: WarSite; from: WarSite; threat: number } | null = null;
    for (const site of mine) {
      if (site.home) continue;
      const marching = war.raids.find((r) => r.to === site.id && areHostile(giver, r.faction));
      const source = marching ? map.byId.get(marching.from) : undefined;
      const hostile = neighbours(site).filter((n) => enemyOf(n) && troops(n) > 0);
      const strongest = hostile.reduce<WarSite | null>((best, n) => (!best || troops(n) > troops(best) ? n : best), null);
      const from = source ?? strongest;
      if (!from || !isWarFactionId(owner(from))) continue;
      const threat = (marching ? 100 : 0) + hostile.reduce((n, s) => n + troops(s), 0);
      if (!defend || threat > defend.threat || (threat === defend.threat && site.id < defend.site.id)) defend = { site, from, threat };
    }
    if (defend) {
      const enemy = owner(defend.from) as WarFactionId;
      const size = Math.min(4, Math.max(2, Math.round(troops(defend.from) / 2)));
      out.push({ weight: defend.threat, spec: { kind: "defend", giver, enemy, site: defend.site.id, siteName: defend.site.name, troops: size, danger: dangerOf(defend.site.regionId), bearing: bearingTo(defend.site, defend.from) } });
    }
  }
  // A different part of the list comes to the top each time the board turns over.
  const turn = Math.floor(war.tick / CONTRACTS.refreshTicks);
  const start = out.length > 0 ? turn % out.length : 0;
  return [...out.slice(start), ...out.slice(0, start)].slice(0, CONTRACTS.max).map((c) => c.spec);
}

/** Read a saved contract, or null if it is not one. Whether its site still exists is for the world to say. */
export function parseContract(raw: unknown): ContractSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ContractSpec>;
  const whole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  if ((r.kind !== "raid" && r.kind !== "defend") || !isWarFactionId(r.giver) || !isWarFactionId(r.enemy) || r.giver === r.enemy) return null;
  if (typeof r.site !== "string" || typeof r.siteName !== "string" || !whole(r.troops, 1, 12) || !whole(r.danger, 1, 3) || !whole(r.bearing, 0, 360)) return null;
  return { kind: r.kind, giver: r.giver, enemy: r.enemy, site: r.site, siteName: r.siteName, troops: r.troops, danger: r.danger, bearing: r.bearing };
}
