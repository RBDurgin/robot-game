/**
 * Feedback tuning: how strongly the game reacts to things that happen to the player.
 * None of this changes the rules, only what is seen, heard and felt.
 */
export const FEEL = {
  /** Touchdowns slower than this (m/s) are silent: walking over bumps, stepping off kerbs. */
  landMinSpeed: 5,
  /** Touchdown speed (m/s) that gives the full thump, dust and camera kick. */
  landFullSpeed: 26,
  /** Camera shake (metres) for a full-strength landing. */
  landShake: 0.55,
  /** Camera shake when hit: base amount plus a share of the damage taken, capped. */
  hitShakeBase: 0.12,
  hitShakePerDamage: 0.016,
  hitShakeMax: 0.6,
  /** Heat fraction at which the HUD and audio start warning before the lockout. */
  heatWarnFraction: 0.8,
  /** Most wrecks kept in the world; the oldest is removed first. */
  maxWrecks: 12,
};
