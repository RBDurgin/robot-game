export interface WeaponDef {
  id: string;
  name: string;
  /** hitscan: instant ray. projectile: travelling shell with splash damage. */
  kind: "hitscan" | "projectile";
  /** Which procedural model to show. */
  shape: "rifle" | "launcher";
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Heat added per shot. */
  heat: number;
  range: number;
  /** Random cone half-angle in radians. */
  spread: number;
  /** Tonnes; counts against the frame's load capacity. */
  mass: number;
  projectileSpeed?: number;
  splashRadius?: number;
  /** Tracer / shell colour, 0xRRGGBB. */
  color: number;
  description: string;
}

export const WEAPONS = {
  pulseRifle: {
    id: "pulseRifle",
    name: "PR-2 Pulse Rifle",
    kind: "hitscan",
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
  arcLauncher: {
    id: "arcLauncher",
    name: "AL-4 Arc Launcher",
    kind: "projectile",
    shape: "launcher",
    damage: 60,
    cooldown: 1.5,
    heat: 20,
    range: 380,
    spread: 0.004,
    mass: 3.5,
    projectileSpeed: 95,
    splashRadius: 7,
    color: 0xff8a3c,
    description: "Explosive shell with splash damage. Slow to reload; lead your target.",
  },
  swarmPod: {
    id: "swarmPod",
    name: "SP-6 Swarm Pod",
    kind: "projectile",
    shape: "launcher",
    damage: 17,
    cooldown: 0.3,
    heat: 6.5,
    range: 260,
    spread: 0.03,
    mass: 2.5,
    projectileSpeed: 120,
    splashRadius: 3.5,
    color: 0xff5ad1,
    description: "Rapid stream of small rockets. Inaccurate at range.",
  },
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Close-combat strike, built into every frame. */
export const MELEE = { damage: 75, range: 6.5, arc: 1.1, cooldown: 1.1, heat: 8 };
