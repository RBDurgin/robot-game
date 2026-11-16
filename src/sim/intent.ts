import type { Vec3 } from "./math";

/**
 * What a pilot wants the mech to do this step. The player's input and the enemy AI both
 * produce an Intent, so every mech runs through exactly the same movement and combat code.
 */
export interface Intent {
  /** Strafe, -1 (left) to 1 (right), relative to the aim direction. */
  moveX: number;
  /** Forward/back, -1 to 1, relative to the aim direction. */
  moveZ: number;
  /** Absolute aim yaw in radians (0 faces +Z). */
  aimYaw: number;
  /** Aim pitch in radians, positive looks up. */
  aimPitch: number;
  /** World-space point the weapons should converge on, if known. */
  aimPoint: Vec3 | null;
  sprint: boolean;
  boost: boolean;
  /** Held: jump from the ground, then fire jump jets while airborne. */
  jump: boolean;
  firePrimary: boolean;
  fireSecondary: boolean;
  /** Shoulder mounts, on frames that have them. */
  fireTertiary: boolean;
  melee: boolean;
}

/** The Intent field that pulls each trigger. */
export const TRIGGER_FIELD = { primary: "firePrimary", secondary: "fireSecondary", tertiary: "fireTertiary" } as const;

export function idleIntent(aimYaw = 0): Intent {
  return {
    moveX: 0,
    moveZ: 0,
    aimYaw,
    aimPitch: 0,
    aimPoint: null,
    sprint: false,
    boost: false,
    jump: false,
    firePrimary: false,
    fireSecondary: false,
    fireTertiary: false,
    melee: false,
  };
}
