import type { ActionId } from "./controls";

/**
 * Gamepad layout and feel, for a controller in the browser's "standard" mapping (Xbox and
 * PlayStation pads both report it). Button numbers are the standard ones.
 */
export const PAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export type PadButton = keyof typeof PAD_BUTTON;

/** Held buttons that feed the Intent each step. */
export const PAD_HELD = {
  jump: "a",
  firePrimary: "rt",
  fireSecondary: "lt",
  fireTertiary: "rb",
  boost: "lb",
  melee: "b",
} as const satisfies Record<string, PadButton>;

/**
 * One-shot buttons in play, each running a keyboard action (src/data/controls.ts), so they do
 * exactly what that action's key does. L3 (sprint) is handled separately: it toggles.
 */
export const PAD_PRESS: Partial<Record<PadButton, ActionId>> = {
  y: "view",
  x: "hangar",
  up: "briefing",
  right: "contracts",
  down: "wing",
  left: "log",
  back: "map",
  start: "pause",
};

export const PAD_FEEL = {
  /** Stick travel ignored around the centre. */
  deadzone: 0.15,
  /** Look speed at full right-stick deflection, radians per second. */
  lookYawSpeed: 2.6,
  lookPitchSpeed: 1.7,
  /** Response curve exponent: above 1 gives finer aim near the centre. */
  lookCurve: 1.8,
  /** Triggers count as pressed past this much travel. */
  triggerThreshold: 0.35,
  /** In menus, a held direction repeats after this delay, then at this interval (seconds). */
  menuRepeatDelay: 0.4,
  menuRepeatInterval: 0.12,
};

/** How the controls read on the pause screen's list. */
export const PAD_CONTROLS: [string, string][] = [
  ["Left stick (click: sprint)", "Move"],
  ["Right stick", "Aim"],
  ["A", "Jump, hold for jump jets"],
  ["LB", "Boost dash"],
  ["RT / LT", "Fire right / left arm weapon"],
  ["RB", "Fire shoulder weapons"],
  ["B", "Melee strike"],
  ["Y", "Switch view"],
  ["X", "Hangar"],
  ["D-pad", "Briefing ↑ · Contracts → · Wingmen ↓ · Log ←"],
  ["View / Back", "World map"],
  ["Menu / Start", "Pause"],
  ["In menus", "D-pad or stick to move, A to choose, B to go back"],
];
