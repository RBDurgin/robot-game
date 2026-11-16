import { FRAMES, type FrameDef, type FrameId, type HardpointId } from "../data/frames";
import { WAR_FACTION_IDS } from "../data/factions";
import { UNLOCK_IDS, UNLOCKS, type UnlockDef, type UnlockId } from "../data/unlocks";
import type { Standing } from "./reputation";

/** What the player has done and owns, as far as unlocks care. `SaveData` is one. */
export interface Progress {
  scrap: number;
  unlocks: UnlockId[];
  /** Ids of sites the player has cleared. */
  cleared: string[];
  standing: Standing;
}

const def = (id: UnlockId): UnlockDef => UNLOCKS[id];

export const isUnlockId = (id: unknown): id is UnlockId => typeof id === "string" && id in UNLOCKS;

/** True if the player may deploy on a frame. A frame no unlock names is free to all. */
export function frameUnlocked(unlocks: UnlockId[], frame: FrameId): boolean {
  const needed = UNLOCK_IDS.filter((id) => def(id).frame === frame);
  return needed.every((id) => unlocks.includes(id));
}

/** True if the player may use a kind of mount. Arm mounts are free to all. */
export function mountUnlocked(unlocks: UnlockId[], mount: "arm" | "shoulder"): boolean {
  const needed = UNLOCK_IDS.filter((id) => def(id).mount === mount);
  return needed.every((id) => unlocks.includes(id));
}

/** The conditions of an unlock that the player has not met yet, in words. Scrap is not one. */
export function unlockNeeds(id: UnlockId, progress: Progress): string[] {
  const u = def(id);
  const needs: string[] = [];
  if (u.after && isUnlockId(u.after) && !progress.unlocks.includes(u.after)) needs.push(`Needs the ${def(u.after).name.toLowerCase()}`);
  if (u.cleared && progress.cleared.length < u.cleared) needs.push(`Clear ${u.cleared} sites (${progress.cleared.length} so far)`);
  const best = Math.max(...WAR_FACTION_IDS.map((f) => progress.standing[f]));
  if (u.standing !== undefined && best < u.standing) needs.push(`Reach +${u.standing} standing with a faction (best so far ${best > 0 ? "+" : ""}${Math.round(best)})`);
  return needs;
}

export const canUnlock = (id: UnlockId, progress: Progress): boolean =>
  !progress.unlocks.includes(id) && unlockNeeds(id, progress).length === 0 && progress.scrap >= def(id).cost;

/** Pay for an unlock. Returns false, changing nothing, if it cannot be bought now. */
export function buyUnlock(progress: Progress, id: UnlockId): boolean {
  if (!canUnlock(id, progress)) return false;
  progress.scrap -= def(id).cost;
  progress.unlocks.push(id);
  return true;
}

/** Reasons a build uses something the player has not unlocked; empty means it does not. */
export function lockProblems(frame: FrameDef, slots: Partial<Record<HardpointId, unknown>>, unlocks: UnlockId[]): string[] {
  const problems: string[] = [];
  if (!frameUnlocked(unlocks, frame.id as FrameId)) problems.push(`The ${frame.name} frame is locked`);
  for (const h of frame.hardpoints) {
    if (slots[h.id] !== undefined && !mountUnlocked(unlocks, h.mount)) problems.push(`The ${h.name.toLowerCase()} mount is locked`);
  }
  return problems;
}

/** The unlocks a build depends on: what an old save, from before there were locks, is granted. */
export function unlocksUsed(frame: FrameId, slots: Partial<Record<HardpointId, unknown>>): UnlockId[] {
  const mounts = new Set(FRAMES[frame].hardpoints.filter((h) => slots[h.id] !== undefined).map((h) => h.mount));
  return UNLOCK_IDS.filter((id) => def(id).frame === frame || (def(id).mount !== undefined && mounts.has(def(id).mount!)));
}
