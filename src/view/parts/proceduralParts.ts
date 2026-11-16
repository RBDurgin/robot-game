import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { ColorScheme } from "../../data/factions";
import type { FrameLook } from "../../data/frames";
import type { AttachmentName, PartPose, PartVisual } from "./PartVisual";

export interface PartMaterials {
  primary: StandardMaterial;
  secondary: StandardMaterial;
  accent: StandardMaterial;
  metal: StandardMaterial;
  flame: StandardMaterial;
}

function flatMaterial(scene: Scene, name: string, hex: number, emissive = 0): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(`#${hex.toString(16).padStart(6, "0")}`);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.12, 0.12, 0.12);
  if (emissive > 0) mat.emissiveColor = color.scale(emissive);
  return mat;
}

const materialCache = new WeakMap<Scene, Map<string, PartMaterials>>();

/** Materials are shared between every mech that uses the same colour scheme. */
export function getPartMaterials(scene: Scene, colors: ColorScheme): PartMaterials {
  let perScene = materialCache.get(scene);
  if (!perScene) {
    perScene = new Map();
    materialCache.set(scene, perScene);
  }
  const key = `${colors.primary}-${colors.secondary}-${colors.accent}`;
  let mats = perScene.get(key);
  if (!mats) {
    mats = {
      primary: flatMaterial(scene, `primary-${key}`, colors.primary),
      secondary: flatMaterial(scene, `secondary-${key}`, colors.secondary),
      accent: flatMaterial(scene, `accent-${key}`, colors.accent, 0.9),
      metal: flatMaterial(scene, `metal-${key}`, 0x6b7078),
      flame: flatMaterial(scene, `flame-${key}`, 0xffb347, 1),
    };
    mats.flame.disableLighting = true;
    mats.flame.alpha = 0.85;
    perScene.set(key, mats);
  }
  return mats;
}

/** Base class: a root node, named attachment points, and helpers to build from primitives. */
export abstract class ProceduralPartVisual implements PartVisual {
  readonly root: TransformNode;
  protected readonly attachments = new Map<AttachmentName, TransformNode>();

  constructor(
    protected readonly scene: Scene,
    name: string,
    protected readonly mats: PartMaterials,
  ) {
    this.root = new TransformNode(name, scene);
  }

  attachment(name: AttachmentName): TransformNode | null {
    return this.attachments.get(name) ?? null;
  }

  setPose(_pose: PartPose): void {}
  playClip(_name: string): void {}

  dispose(): void {
    this.root.dispose(false, false);
  }

  protected node(name: string, parent: TransformNode, x = 0, y = 0, z = 0): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = parent;
    n.position.set(x, y, z);
    return n;
  }

  protected attach(name: AttachmentName, parent: TransformNode, x = 0, y = 0, z = 0): TransformNode {
    const n = this.node(name, parent, x, y, z);
    this.attachments.set(name, n);
    return n;
  }

  protected box(
    name: string,
    parent: TransformNode,
    size: [number, number, number],
    pos: [number, number, number],
    mat: StandardMaterial,
  ): Mesh {
    const m = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    m.parent = parent;
    m.position.set(pos[0], pos[1], pos[2]);
    m.material = mat;
    m.isPickable = false;
    return m;
  }

  protected cylinder(
    name: string,
    parent: TransformNode,
    opts: { height: number; top: number; bottom: number; sides?: number },
    pos: [number, number, number],
    mat: StandardMaterial,
  ): Mesh {
    const m = MeshBuilder.CreateCylinder(
      name,
      { height: opts.height, diameterTop: opts.top, diameterBottom: opts.bottom, tessellation: opts.sides ?? 8 },
      this.scene,
    );
    m.parent = parent;
    m.position.set(pos[0], pos[1], pos[2]);
    m.material = mat;
    m.isPickable = false;
    return m;
  }
}

/**
 * Two-jointed legs with a pelvis. Origin is on the ground between the feet;
 * the `hip` attachment is where the torso mounts.
 */
export class ProceduralLegs extends ProceduralPartVisual {
  private readonly pelvis: TransformNode;
  private readonly hips: [TransformNode, TransformNode];
  private readonly knees: [TransformNode, TransformNode];
  private readonly hipHeight: number;

  /** `b` is the frame's bulk: 1 for the medium build, thinner below, thicker above. */
  constructor(scene: Scene, mats: PartMaterials, hipHeight = 2.2, b = 1) {
    super(scene, "legs", mats);
    this.hipHeight = hipHeight;
    const seg = hipHeight / 2;

    this.pelvis = this.node("pelvis", this.root, 0, hipHeight, 0);
    this.box("pelvisBlock", this.pelvis, [1.5 * b, 0.55, 1.0 * b], [0, 0.1, 0], mats.secondary);
    this.attach("hip", this.pelvis, 0, 0.4, 0);

    const build = (side: -1 | 1): [TransformNode, TransformNode] => {
      const hip = this.node(`hip${side}`, this.pelvis, side * 0.62 * b, 0, 0);
      this.box("thigh", hip, [0.55 * b, seg, 0.7 * b], [0, -seg / 2, 0], mats.primary);
      this.box("thighPlate", hip, [0.2 * b, seg * 0.7, 0.8 * b], [side * 0.32 * b, -seg * 0.45, 0], mats.secondary);
      const knee = this.node("knee", hip, 0, -seg, 0);
      this.box("kneeCap", knee, [0.6 * b, 0.35, 0.5 * b], [0, 0, 0.3 * b], mats.metal);
      this.box("shin", knee, [0.45 * b, seg - 0.2, 0.55 * b], [0, -(seg - 0.2) / 2, 0], mats.secondary);
      this.box("foot", knee, [0.7 * b, 0.28, 1.2 * b], [0, -seg + 0.14, 0.2 * b], mats.primary);
      return [hip, knee];
    };
    const [hipL, kneeL] = build(-1);
    const [hipR, kneeR] = build(1);
    this.hips = [hipL, hipR];
    this.knees = [kneeL, kneeR];
  }

  override setPose(pose: PartPose): void {
    const phase = pose.walkPhase ?? 0;
    const stride = pose.stride ?? 0;
    const air = pose.airborne ?? 0;
    // Braced: thighs forward and knees folded by the same angle, which keeps the feet planted
    // under the hips while the body sinks.
    const bend = (pose.crouch ?? 0) * 0.45;
    for (let i = 0; i < 2; i++) {
      const p = phase + i * Math.PI;
      const swing = Math.sin(p);
      // Negative X rotation swings the leg forward (+Z). The knee only ever folds backward,
      // and folds most while the leg is travelling forward through the air.
      const hipAngle = -swing * 0.6 * stride - air * 0.35 - bend;
      const kneeAngle = Math.max(0, Math.cos(p)) * 0.9 * stride + air * 0.8 + 0.08 + bend * 2;
      this.hips[i]!.rotation.x = hipAngle;
      this.knees[i]!.rotation.x = kneeAngle;
    }
    // Body drops slightly twice per cycle as each foot plants.
    this.pelvis.position.y = this.hipHeight * Math.cos(bend) - Math.abs(Math.sin(phase)) * 0.12 * stride;
  }
}

/** Torso with cockpit canopy. Origin is at the hip joint. */
export class ProceduralTorso extends ProceduralPartVisual {
  /** `b` is the frame's bulk. `mounts` adds pedestals for shoulder weapons either side of the head. */
  constructor(scene: Scene, mats: PartMaterials, b = 1, mounts = false) {
    super(scene, "torso", mats);
    // Depth grows with bulk too, but less than width, so a heavy frame reads as broad.
    const d = 0.6 + 0.4 * b;
    this.box("waist", this.root, [0.9 * b, 0.4, 0.8 * d], [0, 0.2, 0], mats.metal);
    this.box("chest", this.root, [2.0 * b, 1.25, 1.35 * d], [0, 1.0, 0], mats.primary);
    this.box("chestPlate", this.root, [1.3 * b, 0.7, 0.3], [0, 0.85, 0.675 * d + 0.045], mats.secondary);
    this.box("canopy", this.root, [0.8, 0.4, 0.25], [0, 1.35, 0.675 * d + 0.045], mats.accent);
    this.box("collar", this.root, [2.3 * b, 0.3, 1.0 * d], [0, 1.7, -0.05], mats.secondary);
    this.attach("shoulder_l", this.root, -1.35 * b, 1.4, 0);
    this.attach("shoulder_r", this.root, 1.35 * b, 1.4, 0);
    this.attach("neck", this.root, 0, 1.85, 0.1);
    this.attach("back", this.root, 0, 1.0, -0.7 * d);
    this.attach("cockpit", this.root, 0, 1.45, 0.95 * d);
    if (mounts) {
      for (const side of [-1, 1] as const) {
        this.box("mountPedestal", this.root, [0.45, 0.6, 0.6], [side * 0.75 * b, 2.1, -0.2], mats.metal);
        this.attach(side < 0 ? "mount_l" : "mount_r", this.root, side * 0.75 * b, 2.55, -0.2);
      }
    }
  }
}

/** Sensor head. Origin is at the neck. */
export class ProceduralHead extends ProceduralPartVisual {
  constructor(scene: Scene, mats: PartMaterials, style: FrameLook["head"] = "visor") {
    super(scene, "head", mats);
    if (style === "mast") {
      // Scout: narrow head under a tall sensor mast.
      this.box("skull", this.root, [0.5, 0.42, 0.8], [0, 0.21, 0.05], mats.primary);
      this.box("visor", this.root, [0.4, 0.12, 0.1], [0, 0.24, 0.48], mats.accent);
      this.box("mast", this.root, [0.08, 1.3, 0.08], [0, 1.0, -0.25], mats.metal);
      this.box("mastVane", this.root, [0.5, 0.1, 0.25], [0, 1.45, -0.25], mats.accent);
    } else if (style === "dome") {
      // Siege: a low armored block sunk between the shoulders.
      this.box("skull", this.root, [1.0, 0.36, 0.95], [0, 0.18, 0], mats.primary);
      this.box("visor", this.root, [0.8, 0.1, 0.1], [0, 0.2, 0.5], mats.accent);
      this.box("brow", this.root, [1.1, 0.12, 0.5], [0, 0.4, 0.2], mats.secondary);
    } else {
      this.box("skull", this.root, [0.7, 0.5, 0.75], [0, 0.25, 0], mats.primary);
      this.box("visor", this.root, [0.55, 0.14, 0.1], [0, 0.28, 0.4], mats.accent);
      this.box("antenna", this.root, [0.06, 0.6, 0.06], [0.3, 0.7, -0.2], mats.metal);
    }
  }
}

/** Arm that pitches at the shoulder to follow the aim. Origin is at the shoulder joint. */
export class ProceduralArm extends ProceduralPartVisual {
  private readonly pivot: TransformNode;
  private readonly forearm: TransformNode;

  constructor(scene: Scene, mats: PartMaterials, side: -1 | 1, b = 1) {
    super(scene, side < 0 ? "armL" : "armR", mats);
    // Pauldrons grow faster than the rest: slight on a scout, slabs on a siege frame.
    const p = b * b;
    this.box("pauldron", this.root, [0.75 * p, 0.7 * p, 1.0 * p], [side * 0.1, 0.1, 0], mats.primary);
    this.pivot = this.node("pivot", this.root, side * 0.15, 0, 0);
    this.box("upper", this.pivot, [0.45 * b, 0.95, 0.5 * b], [0, -0.55, 0], mats.secondary);
    this.forearm = this.node("forearm", this.pivot, 0, -1.0, 0.1);
    this.box("lower", this.forearm, [0.5 * b, 0.5 * b, 1.0], [0, 0, 0.4], mats.primary);
    this.attach("hand", this.forearm, 0, 0, 0.95);
  }

  override setPose(pose: PartPose): void {
    if (pose.pitch !== undefined) this.pivot.rotation.x = -pose.pitch;
    if (pose.recoil !== undefined) this.forearm.position.z = 0.1 - pose.recoil * 0.25;
  }
}

/** Thruster pack. Origin is at the upper back. */
export class ProceduralBackpack extends ProceduralPartVisual {
  private readonly flames: Mesh[] = [];

  constructor(scene: Scene, mats: PartMaterials, b = 1) {
    super(scene, "backpack", mats);
    this.box("pack", this.root, [1.5 * b, 1.1, 0.6], [0, 0.1, -0.3], mats.secondary);
    if (b < 0.9) {
      // Light frames carry stabiliser fins for their second dash.
      for (const side of [-1, 1] as const) {
        const fin = this.box("fin", this.root, [0.08, 1.5, 0.55], [side * 0.75, 0.55, -0.55], mats.primary);
        fin.rotation.z = -side * 0.45;
        fin.rotation.x = -0.35;
      }
    }
    for (const side of [-1, 1] as const) {
      const nozzle = this.attach(side < 0 ? "jet_l" : "jet_r", this.root, side * 0.45 * b, -0.45, -0.45);
      nozzle.rotation.x = -0.5;
      this.cylinder("nozzle", nozzle, { height: 0.5, top: 0.35, bottom: 0.5 }, [0, -0.25, 0], mats.metal);
      const flame = this.cylinder("flame", nozzle, { height: 1.6, top: 0.4, bottom: 0.02 }, [0, -1.3, 0], mats.flame);
      flame.setEnabled(false);
      this.flames.push(flame);
    }
  }

  override setPose(pose: PartPose): void {
    const thrust = pose.thrust ?? 0;
    for (const flame of this.flames) {
      flame.setEnabled(thrust > 0.02);
      // Flicker so the plume does not look like a static cone.
      flame.scaling.y = thrust * (0.8 + Math.random() * 0.4);
    }
  }
}

export type WeaponShape = "rifle" | "launcher" | "emitter" | "scatter";

/** Weapon model held in the hand. Origin is at the grip; barrel points along +Z. */
export class ProceduralWeapon extends ProceduralPartVisual {
  constructor(scene: Scene, mats: PartMaterials, shape: WeaponShape) {
    super(scene, `weapon-${shape}`, mats);
    if (shape === "rifle") {
      this.box("body", this.root, [0.35, 0.45, 1.3], [0, 0, 0.35], mats.metal);
      this.box("barrel", this.root, [0.16, 0.16, 1.5], [0, 0.05, 1.6], mats.secondary);
      this.attach("muzzle", this.root, 0, 0.05, 2.4);
    } else if (shape === "emitter") {
      // Beam: a slim body, a long rod and a glowing lens.
      this.box("body", this.root, [0.4, 0.5, 1.1], [0, 0, 0.3], mats.metal);
      this.cylinder("rod", this.root, { height: 1.7, top: 0.14, bottom: 0.22 }, [0, 0.05, 1.6], mats.secondary).rotation.x = Math.PI / 2;
      this.box("lens", this.root, [0.3, 0.3, 0.12], [0, 0.05, 2.45], mats.accent);
      this.attach("muzzle", this.root, 0, 0.05, 2.5);
    } else if (shape === "scatter") {
      // Scatter gun: short, with a wide flared mouth.
      this.box("body", this.root, [0.45, 0.5, 1.1], [0, 0, 0.3], mats.metal);
      this.box("mouth", this.root, [0.7, 0.4, 0.7], [0, 0.05, 1.15], mats.secondary);
      this.attach("muzzle", this.root, 0, 0.05, 1.5);
    } else {
      this.box("body", this.root, [0.6, 0.6, 1.5], [0, 0.05, 0.5], mats.metal);
      this.box("tubes", this.root, [0.5, 0.5, 0.3], [0, 0.05, 1.4], mats.secondary);
      this.attach("muzzle", this.root, 0, 0.05, 1.6);
    }
  }
}

/** World position of a node, forcing its transform chain up to date first. */
export function worldPositionOf(node: TransformNode): Vector3 {
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition().clone();
}
