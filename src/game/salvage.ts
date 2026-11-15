import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { LootDrop } from "../sim/loot";

const PICKUP_RADIUS = 7;

interface Crate {
  mesh: Mesh;
  drop: LootDrop;
}

/** Salvage crates left by destroyed mechs. Walk over one to collect it. */
export class SalvageField {
  private readonly crates: Crate[] = [];
  private readonly material: StandardMaterial;
  private spin = 0;

  constructor(private readonly scene: Scene) {
    this.material = new StandardMaterial("salvage", scene);
    this.material.diffuseColor = new Color3(0.2, 0.9, 0.6);
    this.material.emissiveColor = new Color3(0.1, 0.55, 0.35);
  }

  get positions(): Vector3[] {
    return this.crates.map((c) => c.mesh.position);
  }

  get count(): number {
    return this.crates.length;
  }

  /** Compile the crate shader now rather than in the frame of the first kill. */
  async prewarm(): Promise<void> {
    const mesh = MeshBuilder.CreateBox("salvageCrate", { size: 1.6 }, this.scene);
    mesh.material = this.material;
    await this.material.forceCompilationAsync(mesh);
    mesh.dispose();
  }

  spawn(at: Vector3, drop: LootDrop): void {
    const mesh = MeshBuilder.CreateBox("salvageCrate", { size: 1.6 }, this.scene);
    mesh.position.copyFrom(at);
    mesh.material = this.material;
    mesh.isPickable = false;
    this.crates.push({ mesh, drop });
  }

  /** Remove and return every crate within reach of `feet`. */
  collectNear(feet: Vector3): LootDrop[] {
    const collected: LootDrop[] = [];
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const crate = this.crates[i]!;
      const p = crate.mesh.position;
      if (Math.hypot(p.x - feet.x, p.z - feet.z) < PICKUP_RADIUS && Math.abs(p.y - feet.y) < 8) {
        collected.push(crate.drop);
        crate.mesh.dispose();
        this.crates.splice(i, 1);
      }
    }
    return collected;
  }

  update(dt: number): void {
    this.spin += dt;
    for (const crate of this.crates) {
      crate.mesh.rotation.y = this.spin * 1.5;
      crate.mesh.rotation.x = 0.5;
    }
  }
}
