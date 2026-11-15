import type { FrameDef } from "../data/frames";
import type { Intent } from "./intent";
import { angleDiff, approach, approachAngle, clamp, v3, yawFromDir, type Vec3 } from "./math";

export const GRAVITY_ACCEL = 22; // Heavier than real gravity so multi-tonne suits feel planted.
const MAX_FALL_SPEED = 55;

/** Movement and resource state of one mech. Section health lives in damage.ts. */
export interface MechState {
  vel: Vec3;
  legsYaw: number;
  torsoYaw: number;
  torsoPitch: number;
  energy: number;
  energyRegenDelay: number;
  heat: number;
  /** True while weapons are locked out after hitting the heat cap. */
  overheated: boolean;
  boostTime: number;
  boostCooldown: number;
  boostDirX: number;
  boostDirZ: number;
  grounded: boolean;
  jetting: boolean;
  /** Movement multiplier, reduced by leg damage (1 = undamaged). */
  mobility: number;
}

export function createMechState(frame: FrameDef, yaw = 0): MechState {
  return {
    vel: v3(),
    legsYaw: yaw,
    torsoYaw: yaw,
    torsoPitch: 0,
    energy: frame.energyMax,
    energyRegenDelay: 0,
    heat: 0,
    overheated: false,
    boostTime: 0,
    boostCooldown: 0,
    boostDirX: 0,
    boostDirZ: 1,
    grounded: true,
    jetting: false,
    mobility: 1,
  };
}

function spendEnergy(s: MechState, frame: FrameDef, amount: number): void {
  s.energy = Math.max(0, s.energy - amount);
  s.energyRegenDelay = frame.energyRegenDelay;
}

/**
 * Advance one mech by one fixed step. Writes the desired velocity into `s.vel`;
 * the physics layer then moves the body and feeds the resulting velocity back in.
 */
export function stepMech(s: MechState, frame: FrameDef, intent: Intent, grounded: boolean, dt: number): void {
  s.grounded = grounded;

  // Torso tracks the aim direction.
  s.torsoYaw = approachAngle(s.torsoYaw, intent.aimYaw, frame.torsoTurnRate * dt);
  s.torsoPitch = approach(s.torsoPitch, clamp(intent.aimPitch, -frame.maxPitch, frame.maxPitch), frame.torsoTurnRate * dt);

  // Movement input is relative to the aim yaw; convert it to a world-space direction.
  let mx = clamp(intent.moveX, -1, 1);
  let mz = clamp(intent.moveZ, -1, 1);
  const inputLen = Math.hypot(mx, mz);
  if (inputLen > 1) {
    mx /= inputLen;
    mz /= inputLen;
  }
  const sin = Math.sin(intent.aimYaw);
  const cos = Math.cos(intent.aimYaw);
  const wx = mx * cos + mz * sin;
  const wz = -mx * sin + mz * cos;
  const moving = inputLen > 0.05;

  // Legs face the direction of travel, or backpedal if that is closer to where they already
  // point relative to the torso. When idle they swing round once the torso twists too far.
  if (moving) {
    let legTarget = yawFromDir(wx, wz);
    if (Math.abs(angleDiff(s.torsoYaw, legTarget)) > Math.PI * 0.6) legTarget += Math.PI;
    s.legsYaw = approachAngle(s.legsYaw, legTarget, frame.legTurnRate * s.mobility * dt);
  } else if (Math.abs(angleDiff(s.legsYaw, s.torsoYaw)) > Math.PI / 3) {
    s.legsYaw = approachAngle(s.legsYaw, s.torsoYaw, frame.legTurnRate * 0.5 * dt);
  }

  // Boost dash: a short burst at fixed speed in the travel direction.
  s.boostCooldown = Math.max(0, s.boostCooldown - dt);
  if (intent.boost && s.boostTime <= 0 && s.boostCooldown <= 0 && s.energy >= frame.boostCost && s.mobility > 0.3) {
    spendEnergy(s, frame, frame.boostCost);
    s.boostTime = frame.boostDuration;
    s.boostCooldown = frame.boostCooldown;
    if (moving) {
      const l = Math.hypot(wx, wz);
      s.boostDirX = wx / l;
      s.boostDirZ = wz / l;
    } else {
      s.boostDirX = Math.sin(s.torsoYaw);
      s.boostDirZ = Math.cos(s.torsoYaw);
    }
  }

  if (s.boostTime > 0) {
    s.boostTime -= dt;
    s.vel.x = s.boostDirX * frame.boostSpeed;
    s.vel.z = s.boostDirZ * frame.boostSpeed;
  } else {
    const topSpeed = (intent.sprint && mz > 0.3 ? frame.sprintSpeed : frame.walkSpeed) * s.mobility;
    const targetX = wx * topSpeed;
    const targetZ = wz * topSpeed;
    const maxDelta = (grounded ? frame.accel : frame.airAccel) * dt;
    const dx = targetX - s.vel.x;
    const dz = targetZ - s.vel.z;
    const dLen = Math.hypot(dx, dz);
    if (dLen <= maxDelta) {
      s.vel.x = targetX;
      s.vel.z = targetZ;
    } else {
      s.vel.x += (dx / dLen) * maxDelta;
      s.vel.z += (dz / dLen) * maxDelta;
    }
  }

  // Vertical: gravity, jump, then jump jets while the key stays held.
  s.jetting = false;
  const onGround = grounded && s.vel.y <= 0.01;
  if (onGround) {
    s.vel.y = 0;
    if (intent.jump && s.energy >= frame.jumpCost && s.mobility > 0.3) {
      s.vel.y = frame.jumpSpeed;
      spendEnergy(s, frame, frame.jumpCost);
    }
  } else {
    s.vel.y -= GRAVITY_ACCEL * dt;
    if (intent.jump && s.energy > 0) {
      // Jets push upward but never beyond the frame's maximum climb rate.
      s.vel.y = Math.min(s.vel.y + frame.jetAccel * dt, Math.max(s.vel.y, frame.jetMaxRise));
      spendEnergy(s, frame, frame.jetCost * dt);
      s.jetting = true;
    }
    s.vel.y = Math.max(s.vel.y, -MAX_FALL_SPEED);
  }

  // Energy recharges after a short pause.
  if (s.energyRegenDelay > 0) {
    s.energyRegenDelay -= dt;
  } else {
    s.energy = Math.min(frame.energyMax, s.energy + frame.energyRegen * dt);
  }

  // Heat bleeds off constantly; an overheated mech stays locked until it cools to half.
  s.heat = Math.max(0, s.heat - frame.heatDissipation * dt);
  if (s.overheated && s.heat <= frame.heatCapacity * 0.5) s.overheated = false;
}

/** Add weapon heat; returns true if this pushed the mech into overheat. */
export function addHeat(s: MechState, frame: FrameDef, amount: number): boolean {
  s.heat = Math.min(frame.heatCapacity, s.heat + amount);
  if (!s.overheated && s.heat >= frame.heatCapacity) {
    s.overheated = true;
    return true;
  }
  return false;
}
