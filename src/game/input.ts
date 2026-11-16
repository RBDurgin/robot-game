import type { Intent } from "../sim/intent";
import { clamp, wrapAngle, type Vec3 } from "../sim/math";

const MAX_LOOK_PITCH = 1.25;

/**
 * Keyboard and mouse state for the player.
 *
 *   WASD move · Shift sprint · Space jump / jump jets · Q boost dash
 *   Left mouse primary · Right mouse secondary · E or middle mouse shoulder weapons
 *   F melee · V switch view
 */
export class PlayerInput {
  yaw = 0;
  pitch = 0;
  /** Radians of look per pixel of mouse travel. */
  sensitivity = 0.0022;
  /** When false (paused, in a menu) the player's intent is neutral. */
  enabled = true;

  private readonly keys = new Set<string>();
  private readonly buttons = new Set<number>();
  private readonly pressHandlers = new Map<string, () => void>();
  /** Called when the browser releases the mouse (Esc, alt-tab). */
  onPointerReleased: (() => void) | null = null;
  private quietRelease = false;
  private retryTimer = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      // Also for auto-repeat: a held Space must not scroll or re-press a focused button.
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressHandlers.get(e.code)?.();
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
      this.buttons.add(e.button);
    });
    window.addEventListener("mouseup", (e) => this.buttons.delete(e.button));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked || !this.enabled) return;
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
    return this.enabled && !this.pointerLocked && !navigator.webdriver;
  }

  /** Free the mouse. `quiet` skips the released callback (dev panel: free the mouse, keep playing). */
  releasePointer(quiet = false): void {
    if (!this.pointerLocked) return;
    this.quietRelease = quiet;
    document.exitPointerLock();
  }

  /** Register a one-shot action for a key (by KeyboardEvent.code). */
  onPress(code: string, handler: () => void): void {
    this.pressHandlers.set(code, handler);
  }

  private axis(negative: string, positive: string): number {
    return (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
  }

  buildIntent(aimPoint: Vec3 | null): Intent {
    const on = this.enabled;
    return {
      moveX: on ? this.axis("KeyA", "KeyD") : 0,
      moveZ: on ? this.axis("KeyS", "KeyW") : 0,
      aimYaw: this.yaw,
      aimPitch: this.pitch,
      aimPoint,
      sprint: on && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")),
      boost: on && this.keys.has("KeyQ"),
      jump: on && this.keys.has("Space"),
      firePrimary: on && this.buttons.has(0),
      fireSecondary: on && this.buttons.has(2),
      fireTertiary: on && (this.buttons.has(1) || this.keys.has("KeyE")),
      melee: on && this.keys.has("KeyF"),
    };
  }
}
