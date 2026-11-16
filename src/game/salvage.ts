import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { LootDrop } from "../sim/loot";

const PICKUP_RADIUS = 7;

interface Crate {
  mesh: Mesh;
  drop: LootDrop;
  /** Id of the site the crate belongs to, for crates that were lying there to be found. */
  site: string | null;
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

  spawn(at: Vector3, drop: LootDrop, site: string | null = null): void {
    const mesh = MeshBuilder.CreateBox("salvageCrate", { size: 1.6 }, this.scene);
    mesh.position.copyFrom(at);
    mesh.material = this.material;
    mesh.isPickable = false;
    this.crates.push({ mesh, drop, site });
  }

  /** Crates still lying at a site, or (for null) crates dropped by destroyed mechs. */
  countAt(site: string | null): number {
    return this.crates.reduce((n, c) => n + (c.site === site ? 1 : 0), 0);
  }

  positionsAt(site: string | null): Vector3[] {
    return this.crates.filter((c) => c.site === site).map((c) => c.mesh.position);
  }

  /** Take away a site's uncollected crates (the site has streamed out). */
  removeAt(site: string): void {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      if (this.crates[i]!.site !== site) continue;
      this.crates[i]!.mesh.dispose();
      this.crates.splice(i, 1);
    }
  }

  /** Remove and return every crate within reach of `feet`. */
  collectNear(feet: Vector3): { drop: LootDrop; site: string | null }[] {
    const collected: { drop: LootDrop; site: string | null }[] = [];
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const crate = this.crates[i]!;
      const p = crate.mesh.position;
      if (Math.hypot(p.x - feet.x, p.z - feet.z) < PICKUP_RADIUS && Math.abs(p.y - feet.y) < 8) {
        collected.push({ drop: crate.drop, site: crate.site });
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
