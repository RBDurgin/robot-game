import { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { forwardFromYawPitch } from "../../sim/math";
import type { MechEntity } from "../mechEntity";
import { raycastWorld } from "../physics";

export type ViewMode = "third" | "cockpit";

const THIRD = { distance: 11, shoulder: 2.2, lift: 1.2, fov: 0.95 };
const COCKPIT_FOV = 1.15;
const AIM_RANGE = 600;

/**
 * One camera with two modes. Both modes look along the same yaw/pitch and resolve the
 * same world-space aim point, so weapons hit the crosshair target in either view.
 */
export class CameraRig {
  readonly camera: FreeCamera;
  mode: ViewMode = "third";
  /** How far along the view ray the aim trace starts, so it begins beyond the player's own mech. */
  private aimStart = THIRD.distance;
  private shakeAmount = 0;
  /** Camera position before shake, so a kick does not move the aim point. */
  private readonly steady = new Vector3();

  constructor(private readonly scene: Scene) {
    this.camera = new FreeCamera("playerCamera", new Vector3(0, 10, -10), scene);
    this.camera.minZ = 0.3;
    this.camera.maxZ = 2000;
    this.camera.fov = THIRD.fov;
    this.camera.inputs.clear();
    this.steady.copyFrom(this.camera.position);
    scene.activeCamera = this.camera;
  }

  /** Kick the camera; `amount` is roughly metres of jitter at the peak. */
  shake(amount: number): void {
    this.shakeAmount = Math.min(1.2, Math.max(this.shakeAmount, amount));
  }

  toggle(): ViewMode {
    this.mode = this.mode === "third" ? "cockpit" : "third";
    return this.mode;
  }

  /** Place the camera for this frame. Call after the target's visual has been updated. */
  update(target: MechEntity, yaw: number, pitch: number, frameDt: number): void {
    const f = forwardFromYawPitch(yaw, pitch);
    const forward = new Vector3(f.x, f.y, f.z);

    if (this.mode === "cockpit") {
      target.visual.setVisible(false);
      // Eye sits at pilot height on the mech's axis, pushed forward along the view.
      const eye = target.renderPosition.add(new Vector3(0, target.frame.height * 0.82, 0));
      this.camera.position.copyFrom(eye.add(new Vector3(f.x, 0, f.z).scale(0.9)));
      this.camera.fov = COCKPIT_FOV;
      this.aimStart = 0.5;
    } else {
      target.visual.setVisible(target.alive);
      const pivot = target.renderPosition.add(new Vector3(0, target.frame.height * 0.85, 0));
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const desired = pivot
        .subtract(forward.scale(THIRD.distance))
        .addInPlace(right.scale(THIRD.shoulder))
        .addInPlace(new Vector3(0, THIRD.lift, 0));
      // Pull the camera in if terrain or a wall is between it and the mech.
      const hit = raycastWorld(this.scene, pivot, desired);
      if (hit) {
        const safe = Math.max(0, hit.distance - 0.6) / Math.max(0.001, Vector3.Distance(pivot, desired));
        Vector3.LerpToRef(pivot, desired, safe, this.camera.position);
      } else {
        this.camera.position.copyFrom(desired);
      }
      this.camera.fov = THIRD.fov;
      this.aimStart = Vector3.Distance(this.camera.position, pivot) + target.frame.radius + 0.5;
    }
    this.camera.rotation.set(-pitch, yaw, 0);
    this.steady.copyFrom(this.camera.position);
    if (this.shakeAmount > 0.01) {
      const k = this.shakeAmount;
      this.camera.position.addInPlaceFromFloats((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      // Decay by time, not by frame, so the kick lasts as long at 144 Hz as at 60 Hz.
      this.shakeAmount *= Math.pow(0.86, frameDt * 60);
    }
  }

  /** World point under the crosshair against static geometry, or a far point if nothing is hit. */
  aimRay(yaw: number, pitch: number): { origin: Vector3; direction: Vector3; far: Vector3 } {
    const f = forwardFromYawPitch(yaw, pitch);
    const direction = new Vector3(f.x, f.y, f.z);
    const origin = this.steady.add(direction.scale(this.aimStart));
    return { origin, direction, far: origin.add(direction.scale(AIM_RANGE)) };
  }
}
