import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";

const HEIGHT = 90;

/**
 * A beacon over a spot on the ground a mission wants the player at: a thin column of light with
 * a ring round its foot showing how close is close enough. There is only ever one.
 */
export class PlaceMarker {
  private readonly beam: Mesh;
  private readonly ring: Mesh;

  constructor(scene: Scene) {
    const material = new StandardMaterial("placeMarker", scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = new Color3(1, 0.78, 0.3);
    material.alpha = 0.35;
    material.disableLighting = true;
    material.backFaceCulling = false;
    this.beam = MeshBuilder.CreateCylinder("placeBeam", { height: HEIGHT, diameter: 1.2, tessellation: 8 }, scene);
    this.ring = MeshBuilder.CreateTorus("placeRing", { diameter: 2, thickness: 0.015, tessellation: 48 }, scene);
    for (const mesh of [this.beam, this.ring]) {
      mesh.material = material;
      mesh.isPickable = false;
      mesh.applyFog = false;
      mesh.setEnabled(false);
    }
  }

  /** Stand the beacon at a spot whose ground is at height `y`; `radius` is the place's reach. */
  show(x: number, y: number, z: number, radius: number): void {
    this.beam.position.set(x, y + HEIGHT / 2, z);
    this.ring.position.set(x, y + 1.5, z);
    this.ring.scaling.set(radius, radius * 0.5, radius);
    this.beam.setEnabled(true);
    this.ring.setEnabled(true);
  }

  hide(): void {
    this.beam.setEnabled(false);
    this.ring.setEnabled(false);
  }
}
