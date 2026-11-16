export interface WeaponDef {
  id: string;
  name: string;
  /**
   * hitscan: instant ray (several at once if `pellets` is set).
   * projectile: travelling shell with splash damage (guided if `turnRate` is set).
   * beam: continuous ray while the trigger is held.
   */
  kind: "hitscan" | "projectile" | "beam";
  /** What the hangar calls this kind of weapon. */
  family: "ballistic" | "explosive" | "beam" | "scatter" | "missile";
  /** Which procedural model to show. */
  shape: "rifle" | "launcher" | "emitter" | "scatter";
  /** Damage per shot, per pellet, or per second for a beam. */
  damage: number;
  /** Seconds between shots. Unused by beams. */
  cooldown: number;
  /** Heat added per shot, or per second for a beam. */
  heat: number;
  range: number;
  /** Random cone half-angle in radians. */
  spread: number;
  /** Tonnes; counts against the frame's load capacity. */
  mass: number;
  /** Rays per shot (scatter weapons). */
  pellets?: number;
  projectileSpeed?: number;
  splashRadius?: number;
  /** Guided missiles: how sharply they turn toward a locked target, rad/s. */
  turnRate?: number;
  /** Guided missiles: seconds the crosshair must stay on a target to lock it. */
  lockTime?: number;
  /** True if the weapon also fits a shoulder mount. */
  shoulder?: boolean;
  /** Tracer / shell colour, 0xRRGGBB. */
  color: number;
  description: string;
}

export const WEAPONS = {
  pulseRifle: {
    id: "pulseRifle",
    name: "PR-2 Pulse Rifle",
    kind: "hitscan",
    family: "ballistic",
    shape: "rifle",
    damage: 8,
    cooldown: 0.11,
    heat: 2.6,
    range: 320,
    spread: 0.008,
    mass: 2,
    color: 0xffe08a,
    description: "Fast, accurate, low damage per shot. Runs hot under sustained fire.",
  },
  slugCannon: {
    id: "slugCannon",
    name: "SC-9 Slug Cannon",
    kind: "hitscan",
    family: "ballistic",
    shape: "rifle",
    damage: 42,
    cooldown: 0.75,
    heat: 11,
    range: 420,
    spread: 0.002,
    mass: 3.5,
    color: 0xb9f3ff,
    description: "Slow, heavy single shots with long reach.",
  },
  scatterGun: {
    id: "scatterGun",
    name: "SG-5 Scatter Gun",
    kind: "hitscan",
    family: "scatter",
    shape: "scatter",
    damage: 8,
    cooldown: 0.85,
    heat: 12,
    range: 110,
    spread: 0.075,
    mass: 2.5,
    pellets: 9,
    color: 0xffc070,
    description: "A cone of pellets. Brutal at arm's length, harmless at range.",
  },
  lanceBeam: {
    id: "lanceBeam",
    name: "LB-3 Lance Beam",
    kind: "beam",
    family: "beam",
    shape: "emitter",
    damage: 62,
    cooldown: 0,
    heat: 30,
    range: 240,
    spread: 0,
    mass: 3,
    color: 0x7dffb0,
    description: "Continuous beam while the trigger is held. Never misses, but cooks the suit.",
  },
  arcLauncher: {
    id: "arcLauncher",
    name: "AL-4 Arc Launcher",
    kind: "projectile",
    family: "explosive",
    shape: "launcher",
    damage: 60,
    cooldown: 1.5,
    heat: 20,
    range: 380,
    spread: 0.004,
    mass: 3.5,
    projectileSpeed: 95,
    splashRadius: 7,
    shoulder: true,
    color: 0xff8a3c,
    description: "Explosive shell with splash damage. Slow to reload; lead your target.",
  },
  swarmPod: {
    id: "swarmPod",
    name: "SP-6 Swarm Pod",
    kind: "projectile",
    family: "explosive",
    shape: "launcher",
    damage: 17,
    cooldown: 0.3,
    heat: 6.5,
    range: 260,
    spread: 0.03,
    mass: 2.5,
    projectileSpeed: 120,
    splashRadius: 3.5,
    shoulder: true,
    color: 0xff5ad1,
    description: "Rapid stream of small rockets. Inaccurate at range.",
  },
  seekerRack: {
    id: "seekerRack",
    name: "SR-8 Seeker Rack",
    kind: "projectile",
    family: "missile",
    shape: "launcher",
    damage: 50,
    cooldown: 2.2,
    heat: 15,
    range: 520,
    spread: 0.01,
    mass: 4,
    projectileSpeed: 70,
    splashRadius: 4,
    turnRate: 1.2,
    lockTime: 1.2,
    shoulder: true,
    color: 0x9ad0ff,
    description: "Guided missile. Hold the crosshair on a target to lock, then it tracks. Flies straight without a lock.",
  },
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Close-combat strike, built into every frame. */
export const MELEE = { damage: 75, range: 6.5, arc: 1.1, cooldown: 1.1, heat: 8 };

/** Rules shared by every weapon of a kind. */
export const WEAPON_RULES = {
  /** Beams deal their damage in pulses this many seconds apart. */
  beamPulse: 0.1,
  /** A lock survives this long with the crosshair off the target. */
  lockGrace: 0.6,
  /** Half-angle of the cone around the crosshair in which a target can be locked, radians. */
  lockCone: 0.1,
};
