/**
 * The patron: the faction the player agrees to work for at the midpoint of the campaign. Who
 * makes an offer follows the player's standing; taking one moves it.
 */

import type { WarFactionId } from "../data/factions";
import { attitudeOf, awardStanding, type Standing } from "./reputation";

export interface PatronDef {
  faction: WarFactionId;
  /** The person who speaks for the faction. */
  name: string;
  /** Their name on the radio. */
  speaker: string;
  role: string;
  motto: string;
  /** What they say when making the offer. */
  offer: string[];
  /** Makes an offer even to a pilot their faction is hostile to. */
  always?: boolean;
  /** Scrap paid for the patron's missions, as a multiple of the usual. */
  scrapRate: number;
  /** Standing with the faction paid for each of the patron's missions. */
  standingPay: number;
}

export interface PatronTerms {
  /** Standing gained with the patron's faction. */
  gain: number;
  /** Standing change (negative) with each of the others who asked. */
  loss: number;
  /** Standing with the patron's faction is at least this afterwards. */
  floor: number;
}

/**
 * The patrons who make the player an offer: those whose faction is not hostile, and any who
 * always ask. There is always one: failing all else, whoever thinks least badly of the player.
 */
export function patronsOffering(patrons: readonly PatronDef[], standing: Standing): PatronDef[] {
  const willing = patrons.filter((p) => p.always || attitudeOf(standing, p.faction) !== "hostile");
  if (willing.length > 0 || patrons.length === 0) return willing;
  return [patrons.reduce((best, p) => (standing[p.faction] > standing[best.faction] ? p : best))];
}

/** Take one of the offers made: standing rises with that faction and falls with the others who asked. */
export function takePatron(standing: Standing, offering: readonly PatronDef[], chosen: WarFactionId, terms: PatronTerms): void {
  for (const p of offering) {
    if (p.faction !== chosen) awardStanding(standing, p.faction, terms.loss);
    else awardStanding(standing, chosen, Math.max(terms.gain, terms.floor - standing[chosen]));
  }
}
