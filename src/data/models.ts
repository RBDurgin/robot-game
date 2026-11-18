import type { FrameId } from "./frames";

/** The pieces a mech is assembled from; each can be procedural or an imported model. */
export type PartSlot = "legs" | "torso" | "head" | "armL" | "armR" | "backpack";

/** Weapon model shapes; each weapon names one in `src/data/weapons.ts`. */
export type WeaponShape = "rifle" | "launcher" | "emitter" | "scatter";

/**
 * One imported model. `file` is under `public/models/`, and must have a row in
 * `public/models/ATTRIBUTION.md` (a unit test checks both).
 *
 * The procedural part stays underneath as the rig: model nodes named `joint.<name>` follow its
 * joints, `att.<name>` nodes replace its attachment points, and clips named `pose.<channel>`
 * are scrubbed by that pose channel. See `GltfPartVisual`.
 */
export interface ModelEntry {
  file: string;
  /** Procedural meshes (by name) that stay visible over the model, such as thruster flames. */
  keep?: string[];
}

/**
 * Which parts of which frame use an imported model. Anything not listed is built
 * procedurally, and a model that is missing or fails to load falls back to procedural too.
 * Model files are made by `npm run models` (scripts/make-models.mjs) or dropped in by hand.
 */
export const MODELS: Partial<Record<FrameId, Partial<Record<PartSlot, ModelEntry>>>> = {
  light: frameModels("light"),
  medium: frameModels("medium"),
  heavy: frameModels("heavy"),
};

/** Weapon models by shape; shared by every frame. */
export const WEAPON_MODELS: Partial<Record<WeaponShape, ModelEntry>> = {
  rifle: { file: "weapon-rifle.glb" },
  launcher: { file: "weapon-launcher.glb" },
  emitter: { file: "weapon-emitter.glb" },
  scatter: { file: "weapon-scatter.glb" },
};

/** The generated set for one frame: every part, named `<frame>-<slot>.glb`. */
function frameModels(frame: FrameId): Record<PartSlot, ModelEntry> {
  const file = (slot: PartSlot): string => `${frame}-${slot}.glb`;
  return {
    legs: { file: file("legs") },
    torso: { file: file("torso") },
    head: { file: file("head") },
    armL: { file: file("armL") },
    armR: { file: file("armR") },
    // The thruster flames stay procedural: they flicker and scale with thrust.
    backpack: { file: file("backpack"), keep: ["flame"] },
  };
}
