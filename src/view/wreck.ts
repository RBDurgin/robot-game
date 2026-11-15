import { Color3, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

/** Boxes that make up a wreck, for a 4.6 m mech: [size xyz, position xyz, rotation xyz]. */
const PIECES: [number[], number[], number[]][] = [
  [[2.0, 1.2, 1.4], [0.1, 0.75, 0.2], [0.5, 0.3, 0.2]], // torso, pitched over
  [[0.6, 1.3, 0.75], [-0.9, 0.4, -0.9], [1.35, 0.4, 0]], // leg
  [[0.6, 1.1, 0.75], [1.0, 0.35, -0.6], [1.5, -0.7, 0.2]], // leg
  [[0.45, 1.4, 0.5], [1.5, 0.3, 1.1], [0.2, 0.9, 1.45]], // arm
  [[1.5, 0.5, 1.0], [-0.5, 0.25, 0.9], [0, 0.6, 0.1]], // pelvis
];

/** Burnt-out hulks left where mechs are destroyed. Visual only: they do not block movement or shots. */
export class WreckField {
  private readonly wrecks: TransformNode[] = [];
  private readonly hull: StandardMaterial;
  private readonly ember: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly max: number,
  ) {
    this.hull = new StandardMaterial("wreckHull", scene);
    this.hull.diffuseColor = new Color3(0.13, 0.12, 0.115);
    this.hull.specularColor = new Color3(0.05, 0.05, 0.05);
    this.ember = new StandardMaterial("wreckEmber", scene);
    this.ember.diffuseColor = new Color3(0.2, 0.08, 0.03);
    this.ember.emissiveColor = new Color3(0.9, 0.32, 0.06);
  }

  get count(): number {
    return this.wrecks.length;
  }

  /** `ground` is the point on the terrain under the mech; `height` is the mech's height. */
  spawn(ground: Vector3, yaw: number, height: number): void {
    const root = new TransformNode("wreck", this.scene);
    root.position.copyFrom(ground);
    root.rotation.y = yaw;
    root.scaling.setAll(height / 4.6);
    PIECES.forEach(([size, pos, rot], i) => {
      const box = MeshBuilder.CreateBox("wreckPiece", { width: size[0], height: size[1], depth: size[2] }, this.scene);
      box.parent = root;
      box.position.set(pos[0]!, pos[1]!, pos[2]!);
      box.rotation.set(rot[0]!, rot[1]!, rot[2]!);
      box.material = this.hull;
      box.isPickable = false;
      if (i === 0) {
        // Something still burning inside the torso.
        const glow = MeshBuilder.CreateBox("wreckEmber", { width: 0.9, height: 0.35, depth: 0.5 }, this.scene);
        glow.parent = box;
        glow.position.set(0, 0.48, 0.3);
        glow.material = this.ember;
        glow.isPickable = false;
      }
    });
    this.wrecks.push(root);
    if (this.wrecks.length > this.max) this.wrecks.shift()!.dispose();
  }
}
