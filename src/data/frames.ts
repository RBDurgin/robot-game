export type SectionId = "torso" | "armL" | "armR" | "legs";
export const SECTION_IDS: readonly SectionId[] = ["torso", "armL", "armR", "legs"];

export interface SectionDef {
  armor: number;
  structure: number;
}

/** Which fire control a hardpoint answers to. */
export type Trigger = "primary" | "secondary" | "tertiary";

export type HardpointId = "armR" | "armL" | "shoulderR" | "shoulderL";
/** Every hardpoint a frame could have, in the order they are listed, fired and looted. */
export const HARDPOINT_IDS: readonly HardpointId[] = ["armR", "armL", "shoulderR", "shoulderL"];

/** A place on a frame where one weapon can be fitted. */
export interface HardpointDef {
  id: HardpointId;
  name: string;
  trigger: Trigger;
  /** Arms hold any weapon; shoulder mounts only take weapons built for them. */
  mount: "arm" | "shoulder";
  /** The weapon is lost when this section is destroyed. */
  section: SectionId;
  /**
   * Where shots leave, in mech-local metres on a medium frame (feet at origin, +Z forward).
   * Scaled with the frame's height, and sideways with its bulk.
   */
  muzzle: [number, number, number];
}

const ARM_R: HardpointDef = { id: "armR", name: "Right arm", trigger: "primary", mount: "arm", section: "armR", muzzle: [1.5, 3.05, 2.6] };
const ARM_L: HardpointDef = { id: "armL", name: "Left arm", trigger: "secondary", mount: "arm", section: "armL", muzzle: [-1.5, 3.05, 2.6] };
const SHOULDER_R: HardpointDef = { id: "shoulderR", name: "Right shoulder", trigger: "tertiary", mount: "shoulder", section: "torso", muzzle: [0.75, 5.0, 1.0] };
const SHOULDER_L: HardpointDef = { id: "shoulderL", name: "Left shoulder", trigger: "tertiary", mount: "shoulder", section: "torso", muzzle: [-0.75, 5.0, 1.0] };

/** Brace stance: a frame that stands still on the ground digs in. */
export interface BraceDef {
  /** Seconds of standing still before the stance takes hold. */
  delay: number;
  /** Multiplier on damage taken while braced. */
  damageTaken: number;
  /** Multiplier on weapon spread while braced. */
  spreadScale: number;
}

/** Proportions of the procedural model. Hit volumes follow `bulk` too. */
export interface FrameLook {
  /** Width of the body relative to the medium frame. */
  bulk: number;
  /** Hip height in metres on a 4.6 m model: higher is leggier. */
  hipHeight: number;
  head: "visor" | "mast" | "dome";
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
  /** Ground covered per footstep, metres. Drives the walk cycle and footfall sounds. */
  strideLength: number;

  boostSpeed: number;
  boostDuration: number;
  boostCost: number;
  /** Seconds to recharge one dash. */
  boostCooldown: number;
  /** Dashes that can be stored (default 1). */
  boostCharges?: number;
  brace?: BraceDef;

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
  hardpoints: HardpointDef[];
  look: FrameLook;
  /** One line for the hangar: what this frame is for. */
  role: string;
}

export const FRAMES = {
  light: {
    id: "light",
    name: "Kite",
    weightClass: "light",
    height: 3.9,
    radius: 1.1,
    mass: 9,
    loadCapacity: 7,

    walkSpeed: 12.5,
    sprintSpeed: 21,
    accel: 65,
    airAccel: 22,
    legTurnRate: 7,
    torsoTurnRate: 8,
    maxPitch: 1.1,
    strideLength: 2.5,

    boostSpeed: 40,
    boostDuration: 0.28,
    boostCost: 18,
    boostCooldown: 1.1,
    boostCharges: 2,

    jumpSpeed: 10.5,
    jumpCost: 5,
    jetAccel: 32,
    jetMaxRise: 12,
    jetCost: 20,

    energyMax: 100,
    energyRegen: 32,
    energyRegenDelay: 0.7,

    heatCapacity: 80,
    heatDissipation: 14,

    sections: {
      torso: { armor: 70, structure: 70 },
      armL: { armor: 35, structure: 35 },
      armR: { armor: 35, structure: 35 },
      legs: { armor: 55, structure: 55 },
    },
    hardpoints: [ARM_R, ARM_L],
    look: { bulk: 0.8, hipHeight: 2.45, head: "mast" },
    role: "Scout. Fast and fragile, with two dash charges. Carries little.",
  },
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
    strideLength: 2.75,

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
    hardpoints: [ARM_R, ARM_L],
    look: { bulk: 1, hipHeight: 2.2, head: "visor" },
    role: "Line. The all-rounder: no weaknesses, no tricks.",
  },
  heavy: {
    id: "heavy",
    name: "Bastion",
    weightClass: "heavy",
    height: 5.4,
    radius: 1.6,
    mass: 24,
    loadCapacity: 18,

    walkSpeed: 6,
    sprintSpeed: 9.5,
    accel: 26,
    airAccel: 8,
    legTurnRate: 3,
    torsoTurnRate: 3.8,
    maxPitch: 1.0,
    strideLength: 3.1,

    boostSpeed: 24,
    boostDuration: 0.35,
    boostCost: 30,
    boostCooldown: 1.6,
    brace: { delay: 0.6, damageTaken: 0.6, spreadScale: 0.4 },

    jumpSpeed: 7,
    jumpCost: 9,
    jetAccel: 21,
    jetMaxRise: 6,
    jetCost: 34,

    energyMax: 100,
    energyRegen: 24,
    energyRegenDelay: 1,

    heatCapacity: 150,
    heatDissipation: 17,

    sections: {
      torso: { armor: 200, structure: 150 },
      armL: { armor: 100, structure: 75 },
      armR: { armor: 100, structure: 75 },
      legs: { armor: 150, structure: 120 },
    },
    hardpoints: [ARM_R, ARM_L, SHOULDER_R, SHOULDER_L],
    look: { bulk: 1.3, hipHeight: 2.0, head: "dome" },
    role: "Siege. Slow and thick-skinned, with shoulder mounts. Braces when it stands still.",
  },
} satisfies Record<string, FrameDef>;

export type FrameId = keyof typeof FRAMES;
export const FRAME_IDS = Object.keys(FRAMES) as FrameId[];
export const isFrameId = (id: unknown): id is FrameId => typeof id === "string" && id in FRAMES;
