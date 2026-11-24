/**
 * Keyboard and mouse actions and their default bindings. Codes are `KeyboardEvent.code` values
 * ("KeyW", "ShiftLeft") or a mouse button as "Mouse0" (left), "Mouse1" (middle), "Mouse2" (right),
 * "Mouse3" and "Mouse4" (side buttons). The player's own bindings are saved with the settings;
 * Esc is fixed (the browser uses it to free the mouse) and is not listed.
 */
export const ACTIONS = {
  forward: { label: "Move forward", keys: ["KeyW"] },
  back: { label: "Move back", keys: ["KeyS"] },
  left: { label: "Strafe left", keys: ["KeyA"] },
  right: { label: "Strafe right", keys: ["KeyD"] },
  sprint: { label: "Sprint", keys: ["ShiftLeft", "ShiftRight"] },
  jump: { label: "Jump, hold for jump jets", keys: ["Space"] },
  boost: { label: "Boost dash", keys: ["KeyQ"] },
  firePrimary: { label: "Fire right arm weapon", keys: ["Mouse0"] },
  fireSecondary: { label: "Fire left arm weapon", keys: ["Mouse2"] },
  fireTertiary: { label: "Fire shoulder weapons", keys: ["KeyE", "Mouse1"] },
  melee: { label: "Melee strike", keys: ["KeyF"] },
  view: { label: "Switch third-person / cockpit view", keys: ["KeyV"] },
  lights: { label: "Headlights on / off", keys: ["KeyT"] },
  hangar: { label: "Hangar (at a base you or an ally hold)", keys: ["KeyH"] },
  wing: { label: "Call allied pilots to your wing, or release them", keys: ["KeyG"] },
  briefing: { label: "Mission briefing (at a base)", keys: ["KeyB"] },
  contracts: { label: "Contracts (at a base)", keys: ["KeyC"] },
  log: { label: "Mission log", keys: ["KeyL"] },
  map: { label: "World map and fast travel", keys: ["KeyM"] },
  pause: { label: "Pause", keys: ["KeyP"] },
} as const satisfies Record<string, { label: string; keys: readonly string[] }>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
export const isActionId = (v: string): v is ActionId => v in ACTIONS;

/** Keys that can never be bound: Esc frees the mouse, and backquote is the developer overlay. */
export const RESERVED_KEYS: readonly string[] = ["Escape", "Backquote"];

/** At most this many keys or buttons per action. */
export const MAX_KEYS_PER_ACTION = 2;
