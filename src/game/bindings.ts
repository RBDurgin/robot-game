import { ACTION_IDS, ACTIONS, MAX_KEYS_PER_ACTION, RESERVED_KEYS, type ActionId } from "../data/controls";

/** The keys (and mouse buttons) bound to every action. See `src/data/controls.ts` for codes. */
export type Bindings = Record<ActionId, string[]>;

export function defaultBindings(): Bindings {
  const out = {} as Bindings;
  for (const id of ACTION_IDS) out[id] = [...ACTIONS[id].keys];
  return out;
}

const isCode = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 32 && !RESERVED_KEYS.includes(v);

/**
 * Read bindings from a save. Unknown actions are dropped, missing ones get their defaults (so
 * an action added later is bound), and a key bound twice keeps only its first action.
 */
export function parseBindings(data: unknown): Bindings {
  const out = defaultBindings();
  if (!data || typeof data !== "object") return out;
  const taken = new Set<string>();
  const raw = data as Record<string, unknown>;
  for (const id of ACTION_IDS) {
    const keys = raw[id];
    if (!Array.isArray(keys)) continue;
    out[id] = keys.filter(isCode).slice(0, MAX_KEYS_PER_ACTION);
  }
  // Defaults filled in for missing actions may clash with keys the player moved; theirs win.
  const explicit = ACTION_IDS.filter((id) => Array.isArray(raw[id]));
  for (const id of [...explicit, ...ACTION_IDS.filter((a) => !explicit.includes(a))]) {
    out[id] = out[id].filter((k) => !taken.has(k));
    for (const k of out[id]) taken.add(k);
  }
  return out;
}

/**
 * Bind `code` to `action`, replacing the key in position `slot` (0 or 1). If another action
 * had that key, it takes the key this one gives up (a swap), so nothing is silently unbound
 * unless the slot was empty.
 */
export function rebind(bindings: Bindings, action: ActionId, slot: number, code: string): Bindings {
  if (!isCode(code) || slot < 0 || slot >= MAX_KEYS_PER_ACTION) return bindings;
  const out = { ...bindings } as Bindings;
  for (const id of ACTION_IDS) out[id] = [...bindings[id]];
  const given = out[action][slot];
  if (given === code) return out;
  for (const id of ACTION_IDS) {
    const at = out[id].indexOf(code);
    if (at < 0 || (id === action && at === slot)) continue;
    if (id === action) out[id].splice(at, 1);
    else if (given) out[id][at] = given;
    else out[id].splice(at, 1);
  }
  const mine = out[action];
  if (slot < mine.length) mine[slot] = code;
  else mine.push(code);
  out[action] = [...new Set(mine)];
  return out;
}

/** Remove the key in position `slot` from an action. */
export function unbind(bindings: Bindings, action: ActionId, slot: number): Bindings {
  return { ...bindings, [action]: bindings[action].filter((_, i) => i !== slot) };
}

/** The action a key is bound to, if any. */
export function actionFor(bindings: Bindings, code: string): ActionId | null {
  return ACTION_IDS.find((id) => bindings[id].includes(code)) ?? null;
}

const MOUSE_NAMES = ["Left mouse", "Middle mouse", "Right mouse", "Mouse 4", "Mouse 5"];

/** How a key reads on screen: "W", "Left Shift", "Right mouse". */
export function keyLabel(code: string): string {
  const mouse = /^Mouse(\d)$/.exec(code);
  if (mouse) return MOUSE_NAMES[Number(mouse[1])] ?? `Mouse ${Number(mouse[1]) + 1}`;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  const sided = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (sided) return `${sided[2]} ${sided[1] === "Control" ? "Ctrl" : sided[1]}`;
  const arrows: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
  return arrows[code] ?? code;
}

/** All of an action's keys as one label: "Left Shift / Right Shift", or "Unbound". */
export function bindingLabel(bindings: Bindings, action: ActionId): string {
  const keys = bindings[action];
  return keys.length > 0 ? keys.map(keyLabel).join(" / ") : "Unbound";
}
