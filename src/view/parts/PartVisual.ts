import type { TransformNode } from "@babylonjs/core";

/** Named points where other parts, weapons or effects attach. */
export type AttachmentName =
  | "hip"
  | "shoulder_l"
  | "shoulder_r"
  | "neck"
  | "back"
  | "cockpit"
  | "hand"
  | "muzzle"
  | "jet_l"
  | "jet_r";

/**
 * Named animation channels. Procedural parts read the ones they understand and move
 * their own nodes; a rigged glTF part could map the same channels onto bones.
 */
export interface PartPose {
  /** Walk cycle phase in radians. */
  walkPhase?: number;
  /** 0 (standing) to 1 (full stride). */
  stride?: number;
  /** 0 to 1, legs tucked while airborne. */
  airborne?: number;
  /** Aim pitch in radians, positive up. */
  pitch?: number;
  /** 0 to 1 weapon recoil kick. */
  recoil?: number;
  /** 0 to 1 thruster intensity. */
  thrust?: number;
}

/**
 * The only thing gameplay and animation code know about a mech part's appearance.
 * `ProceduralPartVisual` builds parts from primitives today; a `GltfPartVisual` that
 * loads authored models can implement the same interface later without touching gameplay.
 */
export interface PartVisual {
  readonly root: TransformNode;
  attachment(name: AttachmentName): TransformNode | null;
  setPose(pose: PartPose): void;
  /** Play a named authored clip. Procedural parts have none and ignore this. */
  playClip(name: string): void;
  dispose(): void;
}
