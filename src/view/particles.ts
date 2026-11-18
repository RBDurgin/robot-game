import { Color4, ParticleSystem, RawTexture, Scene, Texture, Vector3 } from "@babylonjs/core";

/** A burst waiting to be emitted: where, how many, and how hard it is thrown. */
interface Burst {
  x: number;
  y: number;
  z: number;
  count: number;
  speed: number;
  /** Bias of the throw: mostly up for explosions, any way for sparks. */
  up: number;
}

interface Kind {
  system: ParticleSystem;
  queue: Burst[];
}

/** A soft round dot, white with alpha, generated so no image files are needed. */
function dotTexture(scene: Scene, hard: number): Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const a = Math.max(0, 1 - d) ** hard;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(a * 255);
  }
  const t = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.BILINEAR_SAMPLINGMODE);
  t.hasAlpha = true;
  return t;
}

const spec = {
  /** Hot fragments thrown from hits and explosions: short, bright, falling, drawn as streaks. */
  spark: { capacity: 600, life: [0.15, 0.45], size: [0.06, 0.14], blend: ParticleSystem.BLENDMODE_ADD, gravity: -16, drag: 0.02, hard: 1.5 },
  /** Fireball of an explosion. */
  fire: { capacity: 300, life: [0.25, 0.55], size: [1.2, 2.6], blend: ParticleSystem.BLENDMODE_ADD, gravity: 3, drag: 0.08, hard: 1.2 },
  /** Smoke after an explosion, and dust where a mech lands. */
  smoke: { capacity: 400, life: [1.4, 3.0], size: [1.6, 3.4], blend: ParticleSystem.BLENDMODE_STANDARD, gravity: 1.2, drag: 0.06, hard: 0.9 },
  /** Thruster exhaust: short-lived hot puffs that cool to haze. */
  exhaust: { capacity: 500, life: [0.18, 0.4], size: [0.35, 0.8], blend: ParticleSystem.BLENDMODE_ADD, gravity: 0, drag: 0.1, hard: 1.4 },
} as const;

type KindName = keyof typeof spec;

/**
 * Pooled particle effects. Each kind is one shared system; bursts are queued with a position and
 * emitted from there, so any number of impacts in a frame cost one draw per kind.
 */
export class Particles {
  /** Multiplier on every burst's count (the graphics quality setting); 0 turns particles off. */
  scale = 1;
  private readonly kinds: Record<KindName, Kind>;

  constructor(scene: Scene) {
    const soft = dotTexture(scene, 1.6);
    const hard = dotTexture(scene, 3);
    const make = (name: KindName): Kind => {
      const s = spec[name];
      const system = new ParticleSystem(name, s.capacity, scene);
      system.particleTexture = name === "spark" || name === "exhaust" ? hard : soft;
      system.blendMode = s.blend;
      system.minLifeTime = s.life[0];
      system.maxLifeTime = s.life[1];
      system.minSize = s.size[0];
      system.maxSize = s.size[1];
      system.gravity = new Vector3(0, s.gravity, 0);
      system.emitRate = 0;
      system.manualEmitCount = 0;
      system.minEmitPower = 1;
      system.maxEmitPower = 1;
      system.updateSpeed = 1 / 60;
      system.isLocal = false;
      system.emitter = Vector3.Zero();
      const queue: Burst[] = [];
      // Each particle takes its start and its throw from the burst at the head of the queue.
      let current: Burst | null = null;
      system.startPositionFunction = (_m, position) => {
        while (queue.length > 0 && queue[0]!.count <= 0) queue.shift();
        current = queue[0] ?? null;
        if (!current) return;
        current.count--;
        const r = name === "smoke" ? 0.8 : name === "fire" ? 0.5 : 0.05;
        position.set(current.x + (Math.random() - 0.5) * r, current.y + (Math.random() - 0.5) * r, current.z + (Math.random() - 0.5) * r);
      };
      system.startDirectionFunction = (_m, direction) => {
        const b = current;
        if (!b) return direction.set(0, 0, 0);
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const speed = b.speed * (0.4 + Math.random() * 0.6);
        direction.set(Math.cos(a) * s * speed, (u + b.up) * speed, Math.sin(a) * s * speed);
      };
      if (name === "spark") {
        system.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
        system.color1 = new Color4(1, 0.9, 0.6, 1);
        system.color2 = new Color4(1, 0.6, 0.25, 1);
        system.colorDead = new Color4(0.8, 0.2, 0, 0);
      } else if (name === "fire") {
        system.addColorGradient(0, new Color4(1, 0.9, 0.6, 1));
        system.addColorGradient(0.4, new Color4(1, 0.45, 0.12, 0.8));
        system.addColorGradient(1, new Color4(0.3, 0.08, 0.02, 0));
        system.addSizeGradient(0, 0.6);
        system.addSizeGradient(1, 1.6);
        system.minAngularSpeed = -1.5;
        system.maxAngularSpeed = 1.5;
      } else if (name === "smoke") {
        system.addColorGradient(0, new Color4(0.32, 0.3, 0.28, 0));
        system.addColorGradient(0.1, new Color4(0.3, 0.28, 0.26, 0.55));
        system.addColorGradient(1, new Color4(0.42, 0.4, 0.38, 0));
        system.addSizeGradient(0, 0.5);
        system.addSizeGradient(1, 2.2);
        system.minAngularSpeed = -0.6;
        system.maxAngularSpeed = 0.6;
      } else {
        system.addColorGradient(0, new Color4(1, 0.85, 0.55, 0.9));
        system.addColorGradient(0.5, new Color4(1, 0.45, 0.15, 0.4));
        system.addColorGradient(1, new Color4(0.5, 0.5, 0.55, 0));
        system.addSizeGradient(0, 0.7);
        system.addSizeGradient(1, 1.6);
      }
      system.addDragGradient(0, s.drag);
      system.start();
      return { system, queue };
    };
    this.kinds = { spark: make("spark"), fire: make("fire"), smoke: make("smoke"), exhaust: make("exhaust") };
  }

  /** Particles alive right now, all kinds together (a profiling counter). */
  get activeCount(): number {
    let n = 0;
    for (const k of Object.values(this.kinds)) n += k.system.getActiveCount();
    return n;
  }

  private emit(kind: KindName, at: Vector3, count: number, speed: number, up = 0): void {
    const n = Math.round(count * this.scale);
    if (n <= 0) return;
    const k = this.kinds[kind];
    k.queue.push({ x: at.x, y: at.y, z: at.z, count: n, speed, up });
    k.system.manualEmitCount = Math.max(0, k.system.manualEmitCount) + n;
  }

  /** Fragments where a shot lands; more and faster off armour than off the ground. */
  impact(at: Vector3, onMech: boolean, size = 1): void {
    this.emit("spark", at, (onMech ? 10 : 5) * size, onMech ? 9 : 6, 0.4);
    if (!onMech) this.emit("smoke", at, 1 * size, 0.6, 0.6);
  }

  explosion(at: Vector3, radius: number): void {
    const k = Math.min(2, radius / 4);
    this.emit("fire", at, 16 * k, radius * 1.4, 0.3);
    this.emit("spark", at, 30 * k, 16, 0.6);
    this.emit("smoke", at, 12 * k, radius * 0.5, 0.8);
  }

  /** Dust thrown up where a heavy mech lands. */
  dust(at: Vector3, radius: number): void {
    this.emit("smoke", at, 3 + radius * 2, radius * 0.9, 0.1);
  }

  /** One frame's worth of exhaust from a thruster nozzle, `thrust` 0..1. */
  exhaust(at: Vector3, thrust: number): void {
    this.emit("exhaust", at, 1 + thrust * 1.5, 3, -1.4);
  }

  dispose(): void {
    for (const k of Object.values(this.kinds)) k.system.dispose();
  }
}
