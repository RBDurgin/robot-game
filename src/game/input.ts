import { PAD_BUTTON, PAD_FEEL, PAD_HELD, PAD_PRESS, type PadButton } from "../data/gamepad";
import type { ActionId } from "../data/controls";
import { actionFor, defaultBindings, keyLabel, type Bindings } from "./bindings";

const PAD_NAMES: Partial<Record<PadButton, string>> = { y: "Y", x: "X", a: "A", b: "B", up: "D-pad up", down: "D-pad down", left: "D-pad left", right: "D-pad right", back: "View", start: "Menu", lb: "LB", rb: "RB", lt: "LT", rt: "RT" };
import type { Intent } from "../sim/intent";
import { clamp, wrapAngle, type Vec3 } from "../sim/math";

const MAX_LOOK_PITCH = 1.25;

/**
 * Keyboard and mouse state for the player.
 *
 * Keys and mouse buttons are read through the player's `bindings` (defaults and action names in
 * src/data/controls.ts): a mouse button counts as the code "Mouse<n>", like a key.
 *
 * A gamepad works alongside them (layout in src/data/gamepad.ts): `pollGamepad` reads it once
 * a frame, and its buttons either feed the same Intent or run the same key handlers. In menus
 * it moves focus between the menu's controls instead.
 */
export class PlayerInput {
  yaw = 0;
  pitch = 0;
  /** Radians of look per pixel of mouse travel. */
  sensitivity = 0.0022;
  /** When false (paused, in a menu) the player's intent is neutral. */
  enabled = true;

  /** What each action is bound to; set from the saved settings. */
  bindings: Bindings = defaultBindings();
  /** Sprint is pressed once to start and again (or by stopping) to end, rather than held. */
  sprintToggle = false;
  private sprintLatched = false;

  /** Keys down, by code. */
  private readonly keys = new Set<string>();
  /** Mouse buttons down while the mouse is captured, as "Mouse<n>". */
  private readonly buttons = new Set<string>();
  private readonly pressHandlers = new Map<string, () => void>();
  private readonly actionHandlers = new Map<ActionId, () => void>();
  /** Called when the browser releases the mouse (Esc, alt-tab). */
  onPointerReleased: (() => void) | null = null;
  private quietRelease = false;
  private retryTimer = 0;
  /** True while the gamepad is the last thing the player touched. */
  usingGamepad = false;
  private padHeld = new Set<PadButton>();
  private padMove = { x: 0, z: 0 };
  private padSprint = false;
  /** Buttons still down from a menu (A on "Resume"): ignored in play until released. */
  private padBlocked = new Set<PadButton>();
  /** Menu navigation: the direction held and time until it repeats. */
  private menuDir = "";
  private menuRepeat = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      // Also for auto-repeat: a held Space must not scroll or re-press a focused button.
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
      if (e.repeat) return;
      this.usingGamepad = false;
      this.keys.add(e.code);
      this.press(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.buttons.clear();
    });

    canvas.addEventListener("mousedown", (e) => {
      if (!this.pointerLocked) {
        if (this.enabled) this.lockPointer();
        return;
      }
      // Middle mouse fires shoulder weapons; stop the browser's scroll mode.
      if (e.button === 1) e.preventDefault();
      const code = `Mouse${e.button}`;
      this.buttons.add(code);
      this.press(code);
    });
    window.addEventListener("mouseup", (e) => this.buttons.delete(`Mouse${e.button}`));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      if (e.movementX !== 0 || e.movementY !== 0) this.usingGamepad = false;
      this.yaw = wrapAngle(this.yaw + e.movementX * this.sensitivity);
      this.pitch = clamp(this.pitch - e.movementY * this.sensitivity, -MAX_LOOK_PITCH, MAX_LOOK_PITCH);
    });
    document.addEventListener("pointerlockchange", () => {
      if (!this.pointerLocked) {
        this.buttons.clear();
        const quiet = this.quietRelease;
        this.quietRelease = false;
        if (!quiet) this.onPointerReleased?.();
      }
    });
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Capture the mouse for looking around. Must be called from a click or key press. */
  lockPointer(): void {
    // Headless Chromium stalls a few seconds after taking pointer lock, so automated
    // test runs (which script input directly) skip mouse capture.
    if (navigator.webdriver) return;
    const request = (): Promise<void> => Promise.resolve(this.canvas.requestPointerLock());
    // Chromium refuses a new lock for about a second after Esc released the last one, so
    // resuming quickly from the pause menu can fail. Try once more; if that fails too the
    // HUD asks for a click (see `needsPointer`), which always works.
    request().catch(() => {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => {
        if (this.enabled && !this.pointerLocked) request().catch(() => {});
      }, 1300);
    });
  }

  /** True when the game is in play but the mouse is not captured, so looking around is dead. */
  get needsPointer(): boolean {
    return this.enabled && !this.pointerLocked && !navigator.webdriver && !this.usingGamepad;
  }

  /** Free the mouse. `quiet` skips the released callback (dev panel: free the mouse, keep playing). */
  releasePointer(quiet = false): void {
    if (!this.pointerLocked) return;
    this.quietRelease = quiet;
    document.exitPointerLock();
  }

  /** Register a one-shot handler for a fixed key (by KeyboardEvent.code), whatever the bindings. */
  onPress(code: string, handler: () => void): void {
    this.pressHandlers.set(code, handler);
  }

  /** Register a one-shot handler for an action, run by whichever key or button is bound to it. */
  onAction(action: ActionId, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  /** Run what a key or button press does: a fixed key's handler, or its action's. */
  private press(code: string): void {
    const fixed = this.pressHandlers.get(code);
    if (fixed) return fixed();
    const action = actionFor(this.bindings, code);
    if (!action) return;
    if (action === "sprint" && this.sprintToggle && this.enabled) this.sprintLatched = !this.sprintLatched;
    this.actionHandlers.get(action)?.();
  }

  /** What to press for an action, for prompts: its first key, or its button while a gamepad is in use. */
  keyName(action: ActionId): string {
    if (this.usingGamepad) {
      const press = (Object.entries(PAD_PRESS) as [PadButton, ActionId][]).find(([, a]) => a === action)?.[0];
      const held = (Object.entries(PAD_HELD) as [string, PadButton][]).find(([a]) => a === action)?.[1];
      const name = PAD_NAMES[press ?? held ?? "a"];
      if ((press || held) && name) return name;
    }
    const code = this.bindings[action][0];
    return code ? keyLabel(code) : `(unbound: ${action})`;
  }

  /** True while any key or button bound to the action is down. */
  held(action: ActionId): boolean {
    return this.bindings[action].some((code) => this.keys.has(code) || this.buttons.has(code));
  }

  private axis(negative: ActionId, positive: ActionId): number {
    return (this.held(positive) ? 1 : 0) - (this.held(negative) ? 1 : 0);
  }

  buildIntent(aimPoint: Vec3 | null): Intent {
    const on = this.enabled;
    const pad = (action: keyof typeof PAD_HELD): boolean => on && this.padHeld.has(PAD_HELD[action]);
    const key = (action: ActionId): boolean => on && this.held(action);
    const moveX = this.axis("left", "right");
    const moveZ = this.axis("back", "forward");
    // A toggled sprint ends when the player stops, as it does on the gamepad.
    if (!on || (moveX === 0 && moveZ === 0)) this.sprintLatched = false;
    return {
      moveX: on ? clamp(moveX + this.padMove.x, -1, 1) : 0,
      moveZ: on ? clamp(moveZ + this.padMove.z, -1, 1) : 0,
      aimYaw: this.yaw,
      aimPitch: this.pitch,
      aimPoint,
      sprint: on && ((this.sprintToggle ? this.sprintLatched : this.held("sprint")) || this.padSprint),
      boost: key("boost") || pad("boost"),
      jump: key("jump") || pad("jump"),
      firePrimary: key("firePrimary") || pad("firePrimary"),
      fireSecondary: key("fireSecondary") || pad("fireSecondary"),
      fireTertiary: key("fireTertiary") || pad("fireTertiary"),
      melee: key("melee") || pad("melee"),
    };
  }

  /** Read the first connected gamepad. Call once per rendered frame, menus included. */
  pollGamepad(dt: number, pads: readonly (Gamepad | null)[] = navigator.getGamepads?.() ?? []): void {
    const pad = pads.find((p): p is Gamepad => !!p && p.connected && p.mapping === "standard");
    if (!pad) {
      this.padHeld.clear();
      this.padMove = { x: 0, z: 0 };
      this.padSprint = false;
      return;
    }
    const held = new Set<PadButton>();
    for (const [name, index] of Object.entries(PAD_BUTTON) as [PadButton, number][]) {
      const b = pad.buttons[index];
      if (!b) continue;
      if (name === "lt" || name === "rt" ? b.value > PAD_FEEL.triggerThreshold : b.pressed) held.add(name);
    }
    const dz = (v = 0): number => (Math.abs(v) < PAD_FEEL.deadzone ? 0 : (Math.sign(v) * (Math.abs(v) - PAD_FEEL.deadzone)) / (1 - PAD_FEEL.deadzone));
    const [lx, ly, rx, ry] = [dz(pad.axes[0]), dz(pad.axes[1]), dz(pad.axes[2]), dz(pad.axes[3])];
    if (held.size > 0 || lx || ly || rx || ry) this.usingGamepad = true;
    const before = this.padHeld;
    const pressed = (b: PadButton): boolean => held.has(b) && !before.has(b);

    if (this.enabled) {
      for (const b of this.padBlocked) if (!held.has(b)) this.padBlocked.delete(b);
      for (const b of this.padBlocked) held.delete(b);
      this.padHeld = held;
      this.padMove = { x: lx, z: -ly };
      const curve = (v: number): number => Math.sign(v) * Math.abs(v) ** PAD_FEEL.lookCurve;
      this.yaw = wrapAngle(this.yaw + curve(rx) * PAD_FEEL.lookYawSpeed * dt);
      this.pitch = clamp(this.pitch - curve(ry) * PAD_FEEL.lookPitchSpeed * dt, -MAX_LOOK_PITCH, MAX_LOOK_PITCH);
      // Click the stick to sprint; letting go of it ends the sprint.
      if (pressed("l3")) this.padSprint = !this.padSprint;
      if (lx === 0 && ly === 0) this.padSprint = false;
      for (const [button, action] of Object.entries(PAD_PRESS) as [PadButton, ActionId][]) {
        if (pressed(button)) this.actionHandlers.get(action)?.();
      }
      return;
    }
    this.padHeld = held;
    this.padBlocked = new Set(held);
    this.padMove = { x: 0, z: 0 };
    this.padSprint = false;
    const dir = held.has("up") || ly < -0.5 ? "up" : held.has("down") || ly > 0.5 ? "down" : held.has("left") || lx < -0.5 ? "left" : held.has("right") || lx > 0.5 ? "right" : "";
    this.menuInput(dir, dt, pressed);
  }

  /** Gamepad in a menu: move between its controls, change values, choose and go back. */
  private menuInput(dir: string, dt: number, pressed: (b: PadButton) => boolean): void {
    const root = document.getElementById("overlay");
    if (!root || root.hidden) return;
    const controls = [...root.querySelectorAll<HTMLElement>("button, select, input, [tabindex]")].filter(
      (e) => !(e as HTMLButtonElement).disabled && !e.hidden && e.offsetParent !== null && e.tabIndex >= 0,
    );
    const focused = document.activeElement instanceof HTMLElement && controls.includes(document.activeElement) ? document.activeElement : null;

    let step = false;
    if (dir !== this.menuDir) {
      this.menuDir = dir;
      this.menuRepeat = PAD_FEEL.menuRepeatDelay;
      step = dir !== "";
    } else if (dir) {
      this.menuRepeat -= dt;
      if (this.menuRepeat <= 0) {
        this.menuRepeat = PAD_FEEL.menuRepeatInterval;
        step = true;
      }
    }
    if (step && controls.length > 0) {
      const sideways = dir === "left" || dir === "right";
      const delta = dir === "up" || dir === "left" ? -1 : 1;
      if (sideways && focused instanceof HTMLInputElement && focused.type === "range") {
        if (delta > 0) focused.stepUp();
        else focused.stepDown();
        focused.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (sideways && focused instanceof HTMLSelectElement) {
        const next = focused.selectedIndex + delta;
        if (next >= 0 && next < focused.options.length && !focused.options[next]!.disabled) {
          focused.selectedIndex = next;
          focused.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else {
        const at = focused ? controls.indexOf(focused) : delta > 0 ? -1 : 0;
        const target = controls[(at + delta + controls.length) % controls.length]!;
        target.focus();
        target.scrollIntoView({ block: "nearest" });
      }
    }
    if (pressed("a") && focused) focused.click();
    const backButton = root.querySelector<HTMLButtonElement>("button[data-back]");
    if (pressed("b") && backButton) backButton.click();
    // Start leaves a menu the same way (resume, close), or takes the main choice if there is no way back.
    if (pressed("start")) (backButton ?? root.querySelector<HTMLButtonElement>("button.primary:not([disabled])"))?.click();
  }
}
