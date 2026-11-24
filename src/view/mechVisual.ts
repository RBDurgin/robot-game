import { Scene, TransformNode, Vector3 } from "../babylon";
import type { ColorScheme } from "../data/factions";
import type { FrameDef, FrameId, HardpointId } from "../data/frames";
import { MODELS, WEAPON_MODELS, type ModelEntry, type PartSlot } from "../data/models";
import { MechLamps } from "./lamps";
import { GltfPartVisual, modelsEnabled } from "./parts/GltfPartVisual";
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
  /** Walk cycle phase in radians, from the simulation so footfall sounds match the legs. */
  walkPhase: number;
  legsYaw: number;
  torsoYaw: number;
  torsoPitch: number;
  /** Horizontal speed in m/s. */
  speed: number;
  /** Speed at which the stride is at full length. */
  walkSpeed: number;
  grounded: boolean;
  thrust: number;
  /** True while the frame is dug into its brace stance. */
  braced: boolean;
}

/** Height of the model the parts are built at; frames of other heights are scaled from it. */
const MODEL_HEIGHT = 4.6;

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
  /** Shoulder weapons sit on pivots that pitch with the aim. */
  private readonly shoulderPivots: Partial<Record<HardpointId, TransformNode>> = {};
  private readonly weapons: Partial<Record<HardpointId, PartVisual>> = {};
  private readonly recoil: Record<ArmSide, number> = { armL: 0, armR: 0 };
  private airborne = 0;
  private crouch = 0;
  /** Lamps beside the canopy, lit after dark. */
  private readonly lamps: MechLamps;
  /** Thruster level from the last update, 0..1. */
  thrust = 0;
  /** Imported models still loading. */
  private readonly loading: Promise<void>[] = [];

  constructor(
    private readonly scene: Scene,
    name: string,
    colors: ColorScheme,
    frame: FrameDef,
  ) {
    const look = frame.look;
    this.mats = getPartMaterials(scene, colors);
    this.root = new TransformNode(name, scene);
    this.root.scaling.setAll(frame.height / MODEL_HEIGHT);

    this.markerNode = new TransformNode("marker", scene);
    this.markerNode.parent = this.root;
    this.markerNode.position.y = 6;

    // Each part is procedural unless the model manifest names a file for it.
    const part = (slot: PartSlot, procedural: PartVisual): PartVisual => this.dress(procedural, MODELS[frame.id as FrameId]?.[slot]);

    this.legs = part("legs", new ProceduralLegs(scene, this.mats, look.hipHeight, look.bulk));
    this.legs.root.parent = this.root;

    this.torsoPivot = new TransformNode("torsoPivot", scene);
    this.torsoPivot.parent = this.legs.attachment("hip");

    this.torso = part("torso", new ProceduralTorso(scene, this.mats, look.bulk, frame.hardpoints.some((h) => h.mount === "shoulder")));
    this.torso.root.parent = this.torsoPivot;

    this.head = part("head", new ProceduralHead(scene, this.mats, look.head));
    this.head.root.parent = this.torso.attachment("neck");

    this.backpack = part("backpack", new ProceduralBackpack(scene, this.mats, look.bulk));
    this.backpack.root.parent = this.torso.attachment("back");

    this.arms = {
      armL: part("armL", new ProceduralArm(scene, this.mats, -1, look.bulk)),
      armR: part("armR", new ProceduralArm(scene, this.mats, 1, look.bulk)),
    };
    this.arms.armL.root.parent = this.torso.attachment("shoulder_l");
    this.arms.armR.root.parent = this.torso.attachment("shoulder_r");

    this.lamps = new MechLamps(scene, this.torso.attachment("cockpit") ?? this.torso.root, look.bulk, 0.6 + 0.4 * look.bulk);
  }

  /** Switch the lamps on or off. */
  setLamps(on: boolean): void {
    this.lamps.set(on);
  }

  /** Fit (or remove, with null) the weapon model on one hardpoint. */
  setWeapon(hardpoint: HardpointId, shape: WeaponShape | null): void {
    this.weapons[hardpoint]?.dispose();
    delete this.weapons[hardpoint];
    this.shoulderPivots[hardpoint]?.dispose();
    delete this.shoulderPivots[hardpoint];
    if (!shape) return;
    const weapon = this.dress(new ProceduralWeapon(this.scene, this.mats, shape), WEAPON_MODELS[shape]);
    if (hardpoint === "armL" || hardpoint === "armR") {
      weapon.root.parent = this.arms[hardpoint].attachment("hand");
    } else {
      const pivot = new TransformNode("shoulderPivot", this.scene);
      pivot.parent = this.torso.attachment(hardpoint === "shoulderL" ? "mount_l" : "mount_r") ?? this.torso.root;
      weapon.root.parent = pivot;
      // Carried further back than a hand-held weapon, so it balances on its pedestal.
      weapon.root.position.z = -0.5;
      this.shoulderPivots[hardpoint] = pivot;
    }
    this.weapons[hardpoint] = weapon;
  }

  /** The imported model for a part over its procedural rig, if the manifest has one. */
  private dress(procedural: PartVisual, entry: ModelEntry | undefined): PartVisual {
    if (!entry || !modelsEnabled) return procedural;
    const imported = new GltfPartVisual(this.scene, procedural.root.name, entry, procedural, this.mats);
    this.loading.push(imported.ready);
    return imported;
  }

  /** Show or hide an arm, used when the section is destroyed. */
  setArmVisible(side: ArmSide, visible: boolean): void {
    this.arms[side].root.setEnabled(visible);
  }

  /** Kick the arm that fired. Shoulder mounts are braced against the torso and do not move. */
  kickRecoil(hardpoint: HardpointId): void {
    if (hardpoint === "armL" || hardpoint === "armR") this.recoil[hardpoint] = 1;
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
    this.airborne += ((input.grounded ? 0 : 1) - this.airborne) * Math.min(1, dt * 8);
    this.crouch += ((input.braced ? 1 : 0) - this.crouch) * Math.min(1, dt * 7);
    this.legs.setPose({ walkPhase: input.walkPhase, stride, airborne: this.airborne, crouch: this.crouch });
    for (const pivot of Object.values(this.shoulderPivots)) pivot.rotation.x = -input.torsoPitch;
    this.lamps.pitch(input.torsoPitch);

    for (const side of ["armL", "armR"] as const) {
      this.recoil[side] = Math.max(0, this.recoil[side] - dt * 6);
      this.arms[side].setPose({ pitch: input.torsoPitch, recoil: this.recoil[side] });
    }
    this.backpack.setPose({ thrust: input.thrust });
    this.thrust = input.thrust;
  }

  /** World positions of the thruster nozzles, for exhaust effects. */
  jetPoints(): Vector3[] {
    return (["jet_l", "jet_r"] as const).flatMap((name) => {
      const node = this.backpack.attachment(name);
      return node ? [worldPositionOf(node)] : [];
    });
  }

  /** Slots drawn from an imported model right now (debug and tests). */
  get importedParts(): string[] {
    const parts: Record<string, PartVisual> = { legs: this.legs, torso: this.torso, head: this.head, backpack: this.backpack, ...this.arms };
    for (const [hardpoint, weapon] of Object.entries(this.weapons)) parts[`${hardpoint}:weapon`] = weapon;
    return Object.entries(parts)
      .filter(([, p]) => p instanceof GltfPartVisual && p.loaded)
      .map(([slot]) => slot);
  }

  /** Resolves when every imported part has loaded (or settled on its procedural stand-in). */
  get ready(): Promise<void> {
    return Promise.all(this.loading).then(() => {});
  }

  /** Compile every shader this mech can be drawn with, including the thruster flames. */
  async prewarm(): Promise<void> {
    await this.ready;
    this.backpack.setPose({ thrust: 1 });
    const meshes = this.root.getChildMeshes();
    for (const mesh of meshes) mesh.computeWorldMatrix(true);
    await Promise.all(meshes.map((mesh) => (mesh.material ? mesh.material.forceCompilationAsync(mesh) : null)));
    this.backpack.setPose({ thrust: 0 });
  }

  dispose(): void {
    this.root.dispose(false, false);
  }
}
