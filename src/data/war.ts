/**
 * Tuning for the faction war (`src/sim/war.ts`). The war advances in coarse ticks of game time
 * whether or not the player is near; these numbers set how fast the front moves.
 */
export const WAR = {
  /** Seconds of play per war tick. */
  tickSeconds: 5,
  /** Sites nearer than this many metres are neighbours: raids go from one to the other. */
  linkRange: 3000,
  /** Every site is linked to at least this many others, however far away. */
  minLinks: 2,
  /** Chance per tick that a site below strength gains a pilot. */
  reinforceChance: 0.012,
  /** The same for a faction's home, which is where it recovers. */
  homeReinforceChance: 0.05,
  /** Chance per tick that a faction with no raid under way launches one. This is the pace of the war. */
  raidChance: 0.0042,
  /** A raid takes at most this many pilots, and always leaves one behind. */
  raidMax: 4,
  /** A raid needs at least this many pilots. */
  raidMin: 2,
  /** How fast a raid crosses the map, metres per second. */
  marchSpeed: 22,
  /** In a fight nobody is watching, each round a defender is this many times as likely to win as an attacker. */
  defenderEdge: 1.25,
  /** Seconds of warning before a raid reaches a base the player holds. */
  siegeWarning: 210,
  /** A site within this many metres of the player is "observed": its fights are played out by real mechs. */
  observeRange: 700,
  /** How far from its target a raid appears when the player is there to see it, metres. */
  raidSpawnDistance: 380,
  /** A player's base falls only while the player is farther than this from it (or dead). */
  contestRange: 160,
};

/** How the player's standing with a faction moves and what it means. */
export const REPUTATION = {
  min: -100,
  max: 100,
  /** At or below this the faction attacks on sight. */
  hostileAt: -25,
  /** At or above this the faction fights beside the player and opens its bases to them. */
  alliedAt: 40,
  /** Destroying one of a faction's suits. */
  kill: -8,
  /** What each faction at war with the victim thinks of that. */
  killEnemyOf: 3,
  /** Clearing the last defender out of a faction's site. */
  capture: -12,
  captureEnemyOf: 6,
  /** Standing lost per point of damage dealt to a faction that was not hostile. */
  friendlyFire: 0.12,
  /** Damage to one squad that was not hostile before it turns on the player regardless of standing. */
  provokeDamage: 90,
};
