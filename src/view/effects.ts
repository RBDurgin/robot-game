import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

type Kind = "tracer" | "spark" | "blast";

interface Active {
  mesh: Mesh;
  kind: Kind;
  age: number;
  life: number;
  size: number;
}

function hexColor(hex: number): Color3 {
  return Color3.FromHexString(`#${hex.toString(16).padStart(6, "0")}`);
}

/** Short-lived combat visuals (tracers, impact sparks, explosions, shells), pooled to avoid churn. */
export class Effects {
  private readonly active: Active[] = [];
  private readonly pools: Record<Kind, Mesh[]> = { tracer: [], spark: [], blast: [] };
  private readonly shellPool: Mesh[] = [];
  private readonly materials = new Map<number, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  private glow(hex: number): StandardMaterial {
    let mat = this.materials.get(hex);
    if (!mat) {
      mat = new StandardMaterial(`glow-${hex}`, this.scene);
      mat.emissiveColor = hexColor(hex);
      mat.disableLighting = true;
      this.materials.set(hex, mat);
    }
    return mat;
  }

  private acquire(kind: Kind): Mesh {
    const pooled = this.pools[kind].pop();
    if (pooled) {
      pooled.setEnabled(true);
      return pooled;
    }
    const mesh =
      kind === "tracer"
        ? MeshBuilder.CreateBox("tracer", { width: 0.12, height: 0.12, depth: 1 }, this.scene)
        : MeshBuilder.CreateSphere(kind, { diameter: 1, segments: kind === "blast" ? 10 : 4 }, this.scene);
    mesh.isPickable = false;
    mesh.applyFog = false;
    return mesh;
  }

  private spawn(kind: Kind, life: number, size: number, hex: number): Mesh {
    const mesh = this.acquire(kind);
    mesh.material = this.glow(hex);
    mesh.visibility = 1;
    this.active.push({ mesh, kind, age: 0, life, size });
    return mesh;
  }

  tracer(from: Vector3, to: Vector3, hex: number): void {
    const length = Vector3.Distance(from, to);
    if (length < 0.5) return;
    const mesh = this.spawn("tracer", 0.07, 1, hex);
    mesh.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5);
    mesh.scaling.set(1, 1, length);
    mesh.lookAt(to);
  }

  spark(at: Vector3, size: number, hex: number): void {
    this.spawn("spark", 0.16, size, hex).position.copyFrom(at);
  }

  blast(at: Vector3, radius: number, hex = 0xffa23c): void {
    this.spawn("blast", 0.4, radius * 2, hex).position.copyFrom(at);
  }

  /** A visible shell for a projectile; return it with releaseShell when the projectile ends. */
  acquireShell(hex: number): Mesh {
    const mesh = this.shellPool.pop() ?? MeshBuilder.CreateBox("shell", { width: 0.35, height: 0.35, depth: 1.1 }, this.scene);
    mesh.isPickable = false;
    mesh.material = this.glow(hex);
    mesh.setEnabled(true);
    return mesh;
  }

  releaseShell(mesh: Mesh): void {
    mesh.setEnabled(false);
    this.shellPool.push(mesh);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i]!;
      fx.age += dt;
      const t = fx.age / fx.life;
      if (t >= 1) {
        fx.mesh.setEnabled(false);
        this.pools[fx.kind].push(fx.mesh);
        this.active.splice(i, 1);
        continue;
      }
      if (fx.kind === "spark") {
        fx.mesh.scaling.setAll(fx.size * (1 - t));
      } else if (fx.kind === "blast") {
        fx.mesh.scaling.setAll(fx.size * (0.3 + 0.7 * Math.sqrt(t)));
        fx.mesh.visibility = 1 - t * t;
      } else {
        fx.mesh.visibility = 1 - t;
      }
    }
  }
}
