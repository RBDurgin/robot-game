import { GARRISONS, RAID_SQUAD, type SquadDef } from "../data/encounters";
import { FACTIONS, isWarFactionId, type FactionId, type SquadMember, type WarFactionId } from "../data/factions";
import type { StreamConfig } from "../data/streaming";
import type { Health } from "./damage";
import type { Vec3 } from "./math";
import type { SpawnDef } from "./mission";
import { heightAt, type Site, type WorldModel } from "./terrain";
import type { Raid, WarState } from "./war";

/**
 * One AI pilot, whether or not it is in the scene. Far from the player a mech is only this
 * record ("asleep"); near the player the game builds a full mech from it ("active") and writes
 * its position and damage back here when it goes to sleep again.
 */
export interface MechRecord {
  id: number;
  /** The site the pilot guards, or the one it is raiding. */
  siteId: string;
  /** Unique across the world: pilots in the same squad share alarms. */
  squadId: string;
  faction: FactionId;
  member: SquadMember;
  /** Set for raiders: the id of their raid in the war. Garrison pilots have none. */
  raidId?: number;
  /** Set for pilots a mission brought in. They belong to no site: `siteId` names the mission's run. */
  mission?: { tag: string; stance?: "hostile" | "allied"; alert: boolean };
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

/** Hands out record ids. One per world, so ids stay unique as garrisons come and go. */
export interface IdSource {
  next: number;
}

const ground = (model: WorldModel, x: number, z: number): Vec3 => ({ x, y: heightAt(model, x, z), z });

function newRecord(ids: IdSource, base: Pick<MechRecord, "siteId" | "squadId" | "faction" | "member" | "patrol" | "home" | "patrolIndex" | "x" | "z">): MechRecord {
  const id = ids.next++;
  return { ...base, id, yaw: (id * 2.399963) % (Math.PI * 2), health: null, alive: true, active: false };
}

/**
 * Records for a site's garrison: the pilots in places `from` up to `troops` of the site's
 * squads, drawn from the holding faction's roster.
 */
export function garrisonRecords(model: WorldModel, site: Site, faction: WarFactionId, troops: number, ids: IdSource, from = 0): MechRecord[] {
  const records: MechRecord[] = [];
  if (!site.garrison) return records;
  const roster = FACTIONS[faction].roster;
  let place = 0;
  for (const squad of GARRISONS[site.garrison] as SquadDef[]) {
    const patrol = squad.patrol.map(([dx, dz]) => ground(model, site.x + dx, site.z + dz));
    const home = ground(model, site.x, site.z - 20);
    squad.members.forEach((slot, i) => {
      const mine = place++;
      if (mine < from || mine >= troops) return;
      const startIndex = Math.floor((i * patrol.length) / squad.members.length);
      const start = patrol[startIndex]!;
      records.push(newRecord(ids, { siteId: site.id, squadId: `${site.id}:${squad.id}`, faction, member: roster[slot], patrol, home, patrolIndex: startIndex + 1, x: start.x, z: start.z }));
    });
  }
  return records;
}

/** One record per garrison pilot in the world, standing at its starting point. */
export function buildPopulation(model: WorldModel, war: WarState, ids: IdSource): MechRecord[] {
  const records: MechRecord[] = [];
  for (const site of model.sites) {
    const state = war.sites[site.id];
    if (state && isWarFactionId(state.owner)) records.push(...garrisonRecords(model, site, state.owner, state.troops, ids));
  }
  return records;
}

/**
 * Bring a site's sleeping garrison in line with the war after something changed there unseen.
 * Pilots who are awake are left alone (the game owns them); the rest are replaced.
 */
export function syncGarrison(records: MechRecord[], model: WorldModel, site: Site, war: WarState, ids: IdSource): void {
  const state = war.sites[site.id];
  const owner = state && isWarFactionId(state.owner) ? state.owner : null;
  let awake = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]!;
    if (r.siteId !== site.id || r.raidId !== undefined) continue;
    if (r.alive && r.active && r.faction === owner) awake++;
    else if (!r.active) records.splice(i, 1);
  }
  if (owner) records.push(...garrisonRecords(model, site, owner, state!.troops, ids, awake));
}

/**
 * Records for a raid arriving where the player can see it. The raiders appear `distance` metres
 * out, on the side they marched in from, and walk in to the middle of the site.
 */
export function raidRecords(model: WorldModel, raid: Raid, target: Site, from: { x: number; z: number }, distance: number, ids: IdSource): MechRecord[] {
  const dx = from.x - target.x;
  const dz = from.z - target.z;
  const far = Math.hypot(dx, dz) || 1;
  const reach = Math.min(distance, far);
  const ux = dx / far;
  const uz = dz / far;
  const home = ground(model, target.x + ux * reach, target.z + uz * reach);
  // In through the middle and round the compound, so they meet whoever is there.
  const patrol = [ground(model, target.x + ux * 30, target.z + uz * 30), ground(model, target.x - uz * 22, target.z + ux * 22), ground(model, target.x - ux * 22, target.z - uz * 22), ground(model, target.x + uz * 22, target.z - ux * 22)];
  const roster = FACTIONS[raid.faction].roster;
  const records: MechRecord[] = [];
  for (let i = 0; i < raid.troops; i++) {
    // Abreast, a few suits' width apart.
    const side = (i - (raid.troops - 1) / 2) * 14;
    const x = home.x - uz * side;
    const z = home.z + ux * side;
    records.push(newRecord(ids, { siteId: target.id, squadId: `raid:${raid.id}`, faction: raid.faction, member: roster[RAID_SQUAD[i % RAID_SQUAD.length]!], patrol, home, patrolIndex: 0, x, z }));
    records[records.length - 1]!.raidId = raid.id;
  }
  return records;
}

/**
 * Records for a squad a mission brings in. `run` names this playing of the mission and stands
 * in for the site, so no garrison or raid ever counts these pilots as its own.
 */
export function missionRecords(model: WorldModel, spawn: SpawnDef, at: { x: number; z: number }, run: string, ids: IdSource): MechRecord[] {
  const angle = ((spawn.bearing ?? 0) * Math.PI) / 180;
  const ux = Math.sin(angle);
  const uz = Math.cos(angle);
  const distance = spawn.distance ?? 0;
  const home = ground(model, at.x + ux * distance, at.z + uz * distance);
  // In to the place and round it, like a raid.
  const patrol = [ground(model, at.x + ux * 26, at.z + uz * 26), ground(model, at.x - uz * 26, at.z + ux * 26), ground(model, at.x - ux * 26, at.z - uz * 26), ground(model, at.x + uz * 26, at.z - ux * 26)];
  const roster = FACTIONS[spawn.faction].roster;
  return spawn.members.map((slot, i) => {
    // Abreast when walking in; spread round the loop when they start on it.
    const side = (i - (spawn.members.length - 1) / 2) * 14;
    const start = distance > 0 ? { x: home.x - uz * side, z: home.z + ux * side } : patrol[i % patrol.length]!;
    const record = newRecord(ids, { siteId: run, squadId: `${run}:${spawn.tag}`, faction: spawn.faction, member: roster[slot], patrol, home, patrolIndex: distance > 0 ? 0 : (i + 1) % patrol.length, x: start.x, z: start.z });
    record.mission = { tag: spawn.tag, stance: spawn.stance, alert: spawn.alert ?? false };
    return record;
  });
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

/** Living pilots guarding a site (of one faction, if given), awake or asleep. Raiders attacking it do not count. */
export const garrisonLeft = (records: readonly MechRecord[], siteId: string, faction?: FactionId): number =>
  records.reduce((n, r) => n + (r.alive && r.siteId === siteId && r.raidId === undefined && (faction === undefined || r.faction === faction) ? 1 : 0), 0);

/** Living pilots of a raid, awake or asleep. */
export const raidersLeft = (records: readonly MechRecord[], raidId: number): number => records.reduce((n, r) => n + (r.alive && r.raidId === raidId ? 1 : 0), 0);
