import type { FrameId } from "./frames";

/**
 * Things the player earns the use of. A new pilot has the Warden frame and its two arm mounts;
 * everything here is bought with scrap once its condition is met, at any hangar.
 */
export interface UnlockDef {
  name: string;
  description: string;
  /** Scrap to pay. */
  cost: number;
  /** The frame this opens up. */
  frame?: FrameId;
  /** The kind of mount this opens up, on any frame that has it. */
  mount?: "shoulder";
  /** Another unlock that must be owned first. */
  after?: string;
  /** Milestone: how many sites the player must have cleared. */
  cleared?: number;
  /**
   * Reputation: the standing the player must have reached with at least one faction. The Drifters
   * start as allies, so this is set well above the allied mark: it has to be earned.
   */
  standing?: number;
}

export const UNLOCKS = {
  lightFrame: {
    name: "Kite frame",
    description: "The scout frame: fast, fragile, two dash charges.",
    cost: 300,
    frame: "light",
  },
  heavyFrame: {
    name: "Bastion frame",
    description: "The siege frame: slow, thick-skinned, braces when it stands still.",
    cost: 600,
    frame: "heavy",
    cleared: 3,
  },
  shoulderMounts: {
    name: "Shoulder mounts",
    description: "Two more weapon mounts on the Bastion. Only a faction that trusts you will fit them.",
    cost: 350,
    mount: "shoulder",
    after: "heavyFrame",
    standing: 70,
  },
} satisfies Record<string, UnlockDef>;

export type UnlockId = keyof typeof UNLOCKS;
export const UNLOCK_IDS = Object.keys(UNLOCKS) as UnlockId[];
