import { areHostile, FACTIONS, PLAYER_FACTION, WAR_FACTION_IDS, type FactionId, type WarFactionId } from "../data/factions";
import { REPUTATION } from "../data/war";

/** The player's standing with each faction, `REPUTATION.min` to `REPUTATION.max`. */
export type Standing = Record<WarFactionId, number>;

/** hostile: attacks the player on sight. neutral: leaves them alone. allied: fights beside them. */
export type Attitude = "hostile" | "neutral" | "allied";

export function startingStanding(): Standing {
  const out = {} as Standing;
  for (const id of WAR_FACTION_IDS) out[id] = FACTIONS[id].startStanding ?? 0;
  return out;
}

/** Read a saved standing, keeping what is valid and defaulting the rest. */
export function parseStanding(raw: unknown): Standing {
  const out = startingStanding();
  if (!raw || typeof raw !== "object") return out;
  for (const id of WAR_FACTION_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === "number" && Number.isFinite(v)) out[id] = clampStanding(v);
  }
  return out;
}

const clampStanding = (v: number): number => Math.min(REPUTATION.max, Math.max(REPUTATION.min, v));

export function attitudeOf(standing: Standing, faction: WarFactionId): Attitude {
  const v = standing[faction];
  return v <= REPUTATION.hostileAt ? "hostile" : v >= REPUTATION.alliedAt ? "allied" : "neutral";
}

/**
 * Whether two mechs' factions attack each other on sight. Between AI factions that is fixed;
 * with the player it follows their standing.
 */
export function hostileFactions(a: FactionId, b: FactionId, standing: Standing): boolean {
  if (a === PLAYER_FACTION) return b !== PLAYER_FACTION && attitudeOf(standing, b) === "hostile";
  if (b === PLAYER_FACTION) return attitudeOf(standing, a) === "hostile";
  return areHostile(a, b);
}

function shift(standing: Standing, faction: WarFactionId, by: number): void {
  standing[faction] = clampStanding(standing[faction] + by);
}

/** Lower standing with `victim` by `loss` (a negative number) and raise it with everyone at war with them. */
function wrong(standing: Standing, victim: WarFactionId, loss: number, gain: number): void {
  shift(standing, victim, loss);
  for (const other of WAR_FACTION_IDS) if (other !== victim && areHostile(other, victim)) shift(standing, other, gain);
}

/** Standing earned or lost outright, as pay for a mission. */
export const awardStanding = (standing: Standing, faction: WarFactionId, by: number): void => shift(standing, faction, by);

/** The player destroyed one of a faction's suits. */
export const recordKill = (standing: Standing, victim: WarFactionId): void => wrong(standing, victim, REPUTATION.kill, REPUTATION.killEnemyOf);

/** The player cleared the last defender out of a faction's site. */
export const recordCapture = (standing: Standing, victim: WarFactionId): void => wrong(standing, victim, REPUTATION.capture, REPUTATION.captureEnemyOf);

/** The player shot a suit of a faction that was not hostile to them. */
export const recordFriendlyFire = (standing: Standing, victim: WarFactionId, damage: number): void => shift(standing, victim, -damage * REPUTATION.friendlyFire);
