import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { ColorScheme } from "../data/factions";
import type { PartVisual } from "./parts/PartVisual";
import {
  getPartMaterials,
  ProceduralArm,
  ProceduralBackpack,
  ProceduralHead,
  ProceduralLegs,
  ProceduralTorso,
  ProceduralWeapon,
  worldPositionOf,
  type PartMaterials,
  type WeaponShape,
} from "./parts/proceduralParts";

export type ArmSide = "armL" | "armR";

/** Everything the visual needs each frame; produced by the gameplay layer. */
export interface MechAnimInput {
  /** Feet position in world space. */
  position: Vector3;
  legsYaw: number;
  torsoYaw: number;
  torsoPitch: number;
  /** Horizontal speed in m/s. */
  speed: number;
  /** Speed at which the stride is at full length. */
  walkSpeed: number;
  grounded: boolean;
  thrust: number;
}

/**
 * Assembles a mech from PartVisuals and animates it procedurally. It only talks to
 * parts through the PartVisual interface, so any part can later be swapped for a
 * glTF-backed implementation.
 */
export class MechVisual {
  readonly root: TransformNode;
  /** Point above the head that HUD markers attach to. */
  readonly markerNode: TransformNode;
  private readonly mats: PartMaterials;
  private readonly legs: PartVisual;
  private readonly torsoPivot: TransformNode;
  private readonly torso: PartVisual;
  private readonly head: PartVisual;
  private readonly backpack: PartVisual;
  private readonly arms: Record<ArmSide, PartVisual>;
  private readonly weapons: Partial<Record<ArmSide, PartVisual>> = {};
  private readonly recoil: Record<ArmSide, number> = { armL: 0, armR: 0 };
  private walkPhase = 0;
  private airborne = 0;

  constructor(
    private readonly scene: Scene,
    name: string,
    colors: ColorScheme,
  ) {
    this.mats = getPartMaterials(scene, colors);
    this.root = new TransformNode(name, scene);

    this.markerNode = new TransformNode("marker", scene);
    this.markerNode.parent = this.root;
    this.markerNode.position.y = 6;

    this.legs = new ProceduralLegs(scene, this.mats);
    this.legs.root.parent = this.root;

    this.torsoPivot = new TransformNode("torsoPivot", scene);
    this.torsoPivot.parent = this.legs.attachment("hip");

    this.torso = new ProceduralTorso(scene, this.mats);
    this.torso.root.parent = this.torsoPivot;

    this.head = new ProceduralHead(scene, this.mats);
    this.head.root.parent = this.torso.attachment("neck");

    this.backpack = new ProceduralBackpack(scene, this.mats);
    this.backpack.root.parent = this.torso.attachment("back");

    this.arms = {
      armL: new ProceduralArm(scene, this.mats, -1),
      armR: new ProceduralArm(scene, this.mats, 1),
    };
    this.arms.armL.root.parent = this.torso.attachment("shoulder_l");
    this.arms.armR.root.parent = this.torso.attachment("shoulder_r");
  }

  /** Fit (or remove, with null) the weapon model held by one arm. */
  setWeapon(side: ArmSide, shape: WeaponShape | null): void {
    this.weapons[side]?.dispose();
    delete this.weapons[side];
    if (shape) {
      const weapon = new ProceduralWeapon(this.scene, this.mats, shape);
      weapon.root.parent = this.arms[side].attachment("hand");
      this.weapons[side] = weapon;
    }
  }

  /** Show or hide an arm, used when the section is destroyed. */
  setArmVisible(side: ArmSide, visible: boolean): void {
    this.arms[side].root.setEnabled(visible);
  }

  kickRecoil(side: ArmSide): void {
    this.recoil[side] = 1;
  }

  /** World position of a weapon's muzzle, falling back to the hand, then the shoulder. */
  muzzlePosition(side: ArmSide): Vector3 {
    const node = this.weapons[side]?.attachment("muzzle") ?? this.arms[side].attachment("hand") ?? this.arms[side].root;
    return worldPositionOf(node);
  }

  /** Eye point for the cockpit camera. */
  cockpitPosition(): Vector3 {
    return worldPositionOf(this.torso.attachment("cockpit") ?? this.torso.root);
  }

  setVisible(visible: boolean): void {
    this.root.setEnabled(visible);
  }

  update(input: MechAnimInput, dt: number): void {
    this.root.position.copyFrom(input.position);
    this.root.rotation.y = input.legsYaw;
    this.torsoPivot.rotation.y = input.torsoYaw - input.legsYaw;

    const stride = input.grounded ? Math.min(1, input.speed / input.walkSpeed) : 0;
    // One full cycle (two steps) covers about 5.5 m of ground.
    this.walkPhase += ((input.speed * dt) / 5.5) * Math.PI * 2 * (input.grounded ? 1 : 0);
    this.airborne += ((input.grounded ? 0 : 1) - this.airborne) * Math.min(1, dt * 8);
    this.legs.setPose({ walkPhase: this.walkPhase, stride, airborne: this.airborne });

    for (const side of ["armL", "armR"] as const) {
      this.recoil[side] = Math.max(0, this.recoil[side] - dt * 6);
      this.arms[side].setPose({ pitch: input.torsoPitch, recoil: this.recoil[side] });
    }
    this.backpack.setPose({ thrust: input.thrust });
  }

  dispose(): void {
    this.root.dispose(false, false);
  }
}
