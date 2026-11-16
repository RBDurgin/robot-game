import type { FrameDef, SectionId } from "../data/frames";
import type { Vec3 } from "./math";

interface HitBox {
  section: SectionId;
  min: Vec3;
  max: Vec3;
}

/** Hit volumes for a 4.6 m frame of medium build, in mech-local space (feet at origin, +Z forward, -X is the left arm). */
const REFERENCE_HEIGHT = 4.6;
const REFERENCE_BOXES: HitBox[] = [
  { section: "legs", min: { x: -1.0, y: 0, z: -0.8 }, max: { x: 1.0, y: 2.4, z: 0.8 } },
  { section: "torso", min: { x: -1.05, y: 2.4, z: -1.0 }, max: { x: 1.05, y: 4.7, z: 0.9 } },
  { section: "armL", min: { x: -1.95, y: 2.3, z: -0.6 }, max: { x: -1.05, y: 4.2, z: 1.5 } },
  { section: "armR", min: { x: 1.05, y: 2.3, z: -0.6 }, max: { x: 1.95, y: 4.2, z: 1.5 } },
];

const boxCache = new Map<string, HitBox[]>();

function boxesFor(frame: FrameDef): HitBox[] {
  let boxes = boxCache.get(frame.id);
  if (!boxes) {
    // Volumes scale with the frame's height, and sideways with its bulk as well.
    const k = frame.height / REFERENCE_HEIGHT;
    const w = k * frame.look.bulk;
    boxes = REFERENCE_BOXES.map((b) => ({
      section: b.section,
      min: { x: b.min.x * w, y: b.min.y * k, z: b.min.z * k },
      max: { x: b.max.x * w, y: b.max.y * k, z: b.max.z * k },
    }));
    boxCache.set(frame.id, boxes);
  }
  return boxes;
}

export interface MechHit {
  distance: number;
  section: SectionId;
}

/**
 * Ray test against a mech's section volumes. `dir` must be normalised.
 * Destroyed arms are gone, so shots pass through where they used to be.
 */
export function raycastMech(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  feet: Vec3,
  yaw: number,
  frame: FrameDef,
  isDestroyed: (section: SectionId) => boolean,
): MechHit | null {
  // Into mech-local space: translate to the feet, then rotate by -yaw.
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const px = origin.x - feet.x;
  const pz = origin.z - feet.z;
  const o = [px * cos - pz * sin, origin.y - feet.y, px * sin + pz * cos] as const;
  const d = [dir.x * cos - dir.z * sin, dir.y, dir.x * sin + dir.z * cos] as const;

  let best: MechHit | null = null;
  for (const box of boxesFor(frame)) {
    if ((box.section === "armL" || box.section === "armR") && isDestroyed(box.section)) continue;
    const lo = [box.min.x, box.min.y, box.min.z] as const;
    const hi = [box.max.x, box.max.y, box.max.z] as const;
    let tNear = 0;
    let tFar = maxDist;
    let miss = false;
    for (let axis = 0; axis < 3; axis++) {
      const oa = o[axis]!;
      const da = d[axis]!;
      if (Math.abs(da) < 1e-9) {
        if (oa < lo[axis]! || oa > hi[axis]!) {
          miss = true;
          break;
        }
      } else {
        let t1 = (lo[axis]! - oa) / da;
        let t2 = (hi[axis]! - oa) / da;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tNear = Math.max(tNear, t1);
        tFar = Math.min(tFar, t2);
        if (tNear > tFar) {
          miss = true;
          break;
        }
      }
    }
    if (!miss && (!best || tNear < best.distance)) best = { distance: tNear, section: box.section };
  }
  return best;
}

/** Which section an explosion at `point` mostly affects: low blasts hit legs, the rest hit the torso. */
export function splashSection(point: Vec3, feet: Vec3, frame: FrameDef): SectionId {
  return point.y - feet.y < frame.height * 0.4 ? "legs" : "torso";
}
