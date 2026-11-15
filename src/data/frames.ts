export type SectionId = "torso" | "armL" | "armR" | "legs";
export const SECTION_IDS: readonly SectionId[] = ["torso", "armL", "armR", "legs"];

export interface SectionDef {
  armor: number;
  structure: number;
}

/**
 * A frame is the chassis a mech is built on. Handling differences between light, medium
 * and heavy frames are entirely data: adding a frame means adding a row here and tuning it.
 */
export interface FrameDef {
  id: string;
  name: string;
  weightClass: "light" | "medium" | "heavy";
  /** Collision capsule, metres. */
  height: number;
  radius: number;
  /** Chassis mass in tonnes, before parts. */
  mass: number;
  /** Maximum total mass of fitted parts and weapons, tonnes. */
  loadCapacity: number;

  walkSpeed: number;
  sprintSpeed: number;
  /** Ground and air acceleration, m/s^2. */
  accel: number;
  airAccel: number;
  /** Turn rates in rad/s. */
  legTurnRate: number;
  torsoTurnRate: number;
  maxPitch: number;

  boostSpeed: number;
  boostDuration: number;
  boostCost: number;
  boostCooldown: number;

  jumpSpeed: number;
  jumpCost: number;
  jetAccel: number;
  jetMaxRise: number;
  /** Energy per second while jets fire. */
  jetCost: number;

  energyMax: number;
  energyRegen: number;
  /** Seconds after spending energy before it starts to recharge. */
  energyRegenDelay: number;

  heatCapacity: number;
  heatDissipation: number;

  sections: Record<SectionId, SectionDef>;
}

export const FRAMES = {
  medium: {
    id: "medium",
    name: "Warden",
    weightClass: "medium",
    height: 4.6,
    radius: 1.3,
    mass: 14,
    loadCapacity: 10,

    walkSpeed: 9,
    sprintSpeed: 15,
    accel: 45,
    airAccel: 14,
    legTurnRate: 5,
    torsoTurnRate: 6,
    maxPitch: 1.1,

    boostSpeed: 34,
    boostDuration: 0.3,
    boostCost: 22,
    boostCooldown: 0.9,

    jumpSpeed: 9,
    jumpCost: 6,
    jetAccel: 26,
    jetMaxRise: 10,
    jetCost: 24,

    energyMax: 100,
    energyRegen: 28,
    energyRegenDelay: 0.8,

    heatCapacity: 100,
    heatDissipation: 14,

    sections: {
      torso: { armor: 120, structure: 100 },
      armL: { armor: 60, structure: 50 },
      armR: { armor: 60, structure: 50 },
      legs: { armor: 90, structure: 80 },
    },
  },
} satisfies Record<string, FrameDef>;

export type FrameId = keyof typeof FRAMES;
