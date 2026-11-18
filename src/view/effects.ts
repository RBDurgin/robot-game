import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { Particles } from "./particles";

type Kind = "tracer" | "spark" | "blast" | "dust";

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
  private readonly pools: Record<Kind, Mesh[]> = { tracer: [], spark: [], blast: [], dust: [] };
  private readonly shellPool: Mesh[] = [];
  private readonly materials = new Map<number, StandardMaterial>();
  /** Sparks, fire, smoke and exhaust, scaled by the graphics quality setting. */
  readonly particles: Particles;

  constructor(private readonly scene: Scene) {
    this.particles = new Particles(scene);
  }

  /** Effects currently on screen. */
  get activeCount(): number {
    return this.active.length;
  }

  /**
   * Compile the shaders for every kind of effect now, in each state it is drawn in (opaque and
   * fading). Otherwise they compile the first time something fires, which stalls a frame or two
   * at the start of the first fight.
   */
  async prewarm(): Promise<void> {
    const samples: Mesh[] = [];
    for (const kind of ["tracer", "spark", "blast", "dust"] as const) {
      for (const visibility of [1, 0.5]) {
        const mesh = this.acquire(kind);
        mesh.material = this.glow(0xffffff);
        mesh.visibility = visibility;
        // Tracers and dust are stretched when drawn, which is a different shader variant.
        if (kind === "tracer" || kind === "dust") mesh.scaling.set(1, 1, 5);
        mesh.computeWorldMatrix(true);
        samples.push(mesh);
      }
    }
    const shell = this.acquireShell(0xffffff);
    await Promise.all([...samples, shell].map((mesh) => mesh.material!.forceCompilationAsync(mesh)));
    samples.forEach((mesh, i) => {
      mesh.setEnabled(false);
      this.pools[(["tracer", "spark", "blast", "dust"] as const)[i >> 1]!].push(mesh);
    });
    this.releaseShell(shell);
  }

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
        : MeshBuilder.CreateSphere(kind, { diameter: 1, segments: kind === "spark" ? 4 : 10 }, this.scene);
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

  /** One step of a continuous beam: a thick tracer that lasts just long enough to be redrawn. */
  beam(from: Vector3, to: Vector3, hex: number): void {
    const length = Vector3.Distance(from, to);
    if (length < 0.5) return;
    const mesh = this.spawn("tracer", 0.05, 1, hex);
    mesh.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5);
    mesh.scaling.set(2.6, 2.6, length);
    mesh.lookAt(to);
  }

  spark(at: Vector3, size: number, hex: number): void {
    this.spawn("spark", 0.16, size, hex).position.copyFrom(at);
  }

  blast(at: Vector3, radius: number, hex = 0xffa23c): void {
    this.spawn("blast", 0.4, radius * 2, hex).position.copyFrom(at);
    this.particles.explosion(at, radius);
  }

  /** Fragments thrown where a shot lands: off armour, or off the ground. */
  impact(at: Vector3, onMech: boolean, size = 1): void {
    this.particles.impact(at, onMech, size);
  }

  /** Low, spreading puff kicked up where a mech lands. */
  dust(at: Vector3, radius: number): void {
    this.spawn("dust", 0.55, radius * 2, 0x9a8f7c).position.copyFrom(at);
    this.particles.dust(at, radius);
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
      } else if (fx.kind === "dust") {
        const d = fx.size * (0.35 + 0.65 * Math.sqrt(t));
        fx.mesh.scaling.set(d, d * 0.18, d);
        fx.mesh.visibility = 0.5 * (1 - t);
      } else if (fx.kind === "blast") {
        fx.mesh.scaling.setAll(fx.size * (0.3 + 0.7 * Math.sqrt(t)));
        fx.mesh.visibility = 1 - t * t;
      } else {
        fx.mesh.visibility = 1 - t;
      }
    }
  }
}
