import type { FrameDef } from "../data/frames";

type NumericKey = { [K in keyof FrameDef]: FrameDef[K] extends number ? K : never }[keyof FrameDef];

/** Handling values worth tuning by feel, with slider ranges. */
const TWEAKS: [NumericKey, number, number, number][] = [
  ["walkSpeed", 3, 20, 0.5],
  ["sprintSpeed", 5, 35, 0.5],
  ["accel", 5, 120, 1],
  ["airAccel", 0, 60, 1],
  ["legTurnRate", 1, 12, 0.25],
  ["torsoTurnRate", 1, 14, 0.25],
  ["boostSpeed", 10, 70, 1],
  ["boostDuration", 0.1, 1, 0.05],
  ["boostCost", 0, 60, 1],
  ["boostCooldown", 0, 3, 0.1],
  ["jumpSpeed", 2, 25, 0.5],
  ["jetAccel", 5, 70, 1],
  ["jetMaxRise", 2, 30, 0.5],
  ["jetCost", 0, 80, 1],
  ["energyRegen", 5, 80, 1],
  ["heatDissipation", 2, 50, 1],
];

/**
 * Developer sliders that change the frame's handling while the game runs. Values are not
 * saved: once something feels right, copy the number into src/data/frames.ts.
 */
export function buildTweakPanel(root: HTMLElement, frame: FrameDef): void {
  const note = document.createElement("p");
  note.textContent = `${frame.name} frame handling. Not saved: copy good values into src/data/frames.ts.`;
  root.append(note);
  for (const [key, min, max, step] of TWEAKS) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = key;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(frame[key]);
    const value = document.createElement("span");
    value.textContent = String(frame[key]);
    input.addEventListener("input", () => {
      frame[key] = Number(input.value);
      value.textContent = input.value;
    });
    label.append(name, input, value);
    root.append(label);
  }
}
