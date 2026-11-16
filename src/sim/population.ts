import { GARRISONS, type SquadMember } from "../data/encounters";
import type { FactionId } from "../data/factions";
import type { StreamConfig } from "../data/streaming";
import type { Health } from "./damage";
import type { Vec3 } from "./math";
import { heightAt, type WorldModel } from "./terrain";

/**
 * One enemy pilot, whether or not it is in the scene. Far from the player a mech is only this
 * record ("asleep"); near the player the game builds a full mech from it ("active") and writes
 * its position and damage back here when it goes to sleep again.
 */
export interface MechRecord {
  id: number;
  siteId: string;
  /** Unique across the world: pilots in the same squad share alarms. */
  squadId: string;
  faction: FactionId;
  member: SquadMember;
  /** Patrol loop on the ground. */
  patrol: Vec3[];
  /** Where the squad falls back to. */
  home: Vec3;
  /** Patrol point the pilot heads for next. */
  patrolIndex: number;
  x: number;
  z: number;
  yaw: number;
  /** Damage carried over from the last time the mech was active; null if never touched. */
  health: Health | null;
  alive: boolean;
  active: boolean;
}

/** One record per enemy pilot in the world, standing at its starting point. */
export function buildPopulation(model: WorldModel, clearedSites: ReadonlySet<string> = new Set()): MechRecord[] {
  const records: MechRecord[] = [];
  const ground = (x: number, z: number): Vec3 => ({ x, y: heightAt(model, x, z), z });
  for (const site of model.sites) {
    if (!site.garrison || clearedSites.has(site.id)) continue;
    for (const squad of GARRISONS[site.garrison]) {
      const patrol = squad.patrol.map(([dx, dz]) => ground(site.x + dx, site.z + dz));
      const home = ground(site.x, site.z - 20);
      squad.members.forEach((member, i) => {
        const startIndex = Math.floor((i * patrol.length) / squad.members.length);
        const start = patrol[startIndex]!;
        records.push({
          id: records.length,
          siteId: site.id,
          squadId: `${site.id}:${squad.id}`,
          faction: squad.faction,
          member,
          patrol,
          home,
          patrolIndex: startIndex + 1,
          x: start.x,
          z: start.z,
          yaw: (records.length * 2.399963) % (Math.PI * 2),
          health: null,
          alive: true,
          active: false,
        });
      });
    }
  }
  return records;
}

export interface PopulationChanges {
  /** Sleeping records to build mechs for, nearest first. */
  wake: MechRecord[];
  /** Active records whose mechs should be put away. */
  sleep: MechRecord[];
}

/** Which records should change state given where the player is. */
export function populationChanges(records: readonly MechRecord[], x: number, z: number, cfg: StreamConfig): PopulationChanges {
  const wake: { record: MechRecord; d: number }[] = [];
  const sleep: MechRecord[] = [];
  for (const record of records) {
    if (!record.alive) continue;
    const d = Math.hypot(record.x - x, record.z - z);
    if (record.active) {
      if (d > cfg.mechSleep) sleep.push(record);
    } else if (d < cfg.mechWake) {
      wake.push({ record, d });
    }
  }
  wake.sort((a, b) => a.d - b.d);
  return { wake: wake.slice(0, cfg.wakesPerStep).map((w) => w.record), sleep };
}

/** Living pilots guarding a site, awake or asleep. */
export const garrisonLeft = (records: readonly MechRecord[], siteId: string): number =>
  records.reduce((n, r) => n + (r.alive && r.siteId === siteId ? 1 : 0), 0);
