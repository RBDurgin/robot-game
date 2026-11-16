import { clamp, type Vec3 } from "./math";

/**
 * Beam weapons run every step but deal their damage in pulses. Advances the time the trigger
 * has been held and returns how many pulses are due this step.
 */
export function beamPulses(weapon: { beamTime: number }, dt: number, interval: number): number {
  weapon.beamTime += dt;
  const pulses = Math.floor(weapon.beamTime / interval + 1e-9);
  weapon.beamTime -= pulses * interval;
  return pulses;
}

/** A unit direction nudged randomly inside a cone of half-angle `spread` (approximate, for small angles). */
export function spreadDirection(dir: Vec3, spread: number, rng: () => number): Vec3 {
  if (spread <= 0) return { ...dir };
  const x = dir.x + (rng() * 2 - 1) * spread;
  const y = dir.y + (rng() * 2 - 1) * spread;
  const z = dir.z + (rng() * 2 - 1) * spread;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

/** One direction per pellet, each scattered independently around `dir`. */
export function pelletDirections(dir: Vec3, spread: number, pellets: number, rng: () => number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < pellets; i++) out.push(spreadDirection(dir, spread, rng));
  return out;
}

/** Angle in radians between two unit vectors. */
export const angleBetween = (a: Vec3, b: Vec3): number => Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1));

/** Missile lock held by one mech. `T` is whatever identifies a target. */
export interface LockState<T> {
  target: T | null;
  /** Seconds the crosshair has been on the target. */
  time: number;
  /** Seconds the crosshair has been off it. */
  lost: number;
}

export const createLock = <T>(): LockState<T> => ({ target: null, time: 0, lost: 0 });

/**
 * Advance a lock by one step. `candidate` is the target under the crosshair this step, if any.
 * Staying on one target builds the lock; a different target starts again; no target keeps the
 * lock for `grace` seconds, then drops it.
 */
export function stepLock<T>(lock: LockState<T>, candidate: T | null, dt: number, grace: number): void {
  if (candidate !== null && candidate === lock.target) {
    lock.time += dt;
    lock.lost = 0;
  } else if (candidate !== null) {
    lock.target = candidate;
    lock.time = dt;
    lock.lost = 0;
  } else if (lock.target !== null) {
    lock.lost += dt;
    if (lock.lost > grace) clearLock(lock);
  }
}

export function clearLock<T>(lock: LockState<T>): void {
  lock.target = null;
  lock.time = 0;
  lock.lost = 0;
}

/** 0..1 progress toward a lock that needs `lockTime` seconds. */
export const lockProgress = <T>(lock: LockState<T>, lockTime: number): number =>
  lock.target === null ? 0 : clamp(lock.time / Math.max(lockTime, 1e-6), 0, 1);

/**
 * Turn a missile's velocity toward `target` by at most `turnRate * dt` radians, keeping its speed.
 * Rotates within the plane containing the current heading and the direction to the target.
 */
export function steerMissile(vel: Vec3, pos: Vec3, target: Vec3, turnRate: number, dt: number): Vec3 {
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  const tx = target.x - pos.x;
  const ty = target.y - pos.y;
  const tz = target.z - pos.z;
  const tl = Math.hypot(tx, ty, tz);
  if (speed < 1e-6 || tl < 1e-6) return { ...vel };
  const h = { x: vel.x / speed, y: vel.y / speed, z: vel.z / speed };
  const want = { x: tx / tl, y: ty / tl, z: tz / tl };
  const angle = angleBetween(h, want);
  const maxTurn = turnRate * dt;
  if (angle <= maxTurn) return { x: want.x * speed, y: want.y * speed, z: want.z * speed };
  // Component of `want` perpendicular to the heading gives the turn direction.
  const d = h.x * want.x + h.y * want.y + h.z * want.z;
  let px = want.x - h.x * d;
  let py = want.y - h.y * d;
  let pz = want.z - h.z * d;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // Target dead astern: any perpendicular will do, so turn in the horizontal plane.
    const flat = Math.hypot(h.x, h.z);
    px = flat > 1e-6 ? h.z / flat : 1;
    py = 0;
    pz = flat > 1e-6 ? -h.x / flat : 0;
  } else {
    px /= pl;
    py /= pl;
    pz /= pl;
  }
  const c = Math.cos(maxTurn);
  const s = Math.sin(maxTurn);
  return { x: (h.x * c + px * s) * speed, y: (h.y * c + py * s) * speed, z: (h.z * c + pz * s) * speed };
}
