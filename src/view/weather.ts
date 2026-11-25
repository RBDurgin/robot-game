import { Color4, ParticleSystem, RawTexture, Texture, Vector3, type Scene } from "../babylon";
import type { WeatherSample } from "../sim/weather";

/** Rain and dust around the camera. Tuning for the look; how often storms come is in `src/data/weather.ts`. */
const RAIN = {
  capacity: 3000,
  /** Drops per second at full rain and particle scale 1. */
  rate: 2600,
  /** Drops start within this radius of the camera, this high above it. */
  radius: 34,
  height: [6, 22] as const,
  fall: 26,
  /** Sideways speed as a share of the wind's, for the slant. */
  slant: 0.9,
  life: 1.1,
  color: [0.75, 0.8, 0.88, 0.32] as const,
};

const DUST = {
  capacity: 1400,
  rate: 520,
  radius: 46,
  height: [-3, 14] as const,
  /** Blown along at this multiple of the front's speed. */
  gust: 3,
  life: [2.2, 3.6] as const,
  size: [1.6, 4.5] as const,
  color: [0.78, 0.64, 0.45, 0.2] as const,
};

/** A thin vertical streak, bright in the middle, for a raindrop. */
function streakTexture(scene: Scene): Texture {
  const w = 4;
  const h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const along = Math.sin((Math.PI * (y + 0.5)) / h);
    const across = 1 - Math.abs(x - (w - 1) / 2) / (w / 2);
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(along * across * 255);
  }
  const t = RawTexture.CreateRGBATexture(data, w, h, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  t.hasAlpha = true;
  return t;
}

/** A soft puff, for blown dust. */
function puffTexture(scene: Scene): Texture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(Math.max(0, 1 - d) ** 1.5 * 255);
  }
  const t = RawTexture.CreateRGBATexture(data, size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  t.hasAlpha = true;
  return t;
}

/**
 * Rain streaks and blown dust in a volume that follows the camera. Each is one particle system
 * whose emit rate follows the weather where the player is, so clear skies cost nothing.
 */
export class WeatherEffects {
  /** Multiplier on how many particles (the graphics quality setting). */
  scale = 1;
  private readonly rain: ParticleSystem;
  private readonly dust: ParticleSystem;
  /** Where new particles start around, and the wind they move with. */
  private readonly centre = new Vector3();
  private readonly wind = new Vector3();

  constructor(scene: Scene) {
    const centre = this.centre;
    const wind = this.wind;

    const rain = new ParticleSystem("rain", RAIN.capacity, scene);
    rain.particleTexture = streakTexture(scene);
    rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    rain.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    rain.minLifeTime = rain.maxLifeTime = RAIN.life;
    rain.minSize = 0.05;
    rain.maxSize = 0.07;
    rain.minScaleY = rain.maxScaleY = 22;
    rain.color1 = rain.color2 = new Color4(...RAIN.color);
    rain.colorDead = new Color4(RAIN.color[0], RAIN.color[1], RAIN.color[2], 0);
    rain.minEmitPower = rain.maxEmitPower = 1;
    rain.startPositionFunction = (_m, position) => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * RAIN.radius;
      const up = RAIN.height[0] + Math.random() * (RAIN.height[1] - RAIN.height[0]);
      // Start upwind, so the drops slant into the space around the camera.
      const lead = up / RAIN.fall;
      position.set(centre.x + Math.cos(a) * r - wind.x * lead, centre.y + up, centre.z + Math.sin(a) * r - wind.z * lead);
    };
    rain.startDirectionFunction = (_m, direction) => {
      direction.set(wind.x * RAIN.slant, -RAIN.fall * (0.9 + Math.random() * 0.2), wind.z * RAIN.slant);
    };

    const dust = new ParticleSystem("dust", DUST.capacity, scene);
    dust.particleTexture = puffTexture(scene);
    dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    dust.minLifeTime = DUST.life[0];
    dust.maxLifeTime = DUST.life[1];
    dust.minSize = DUST.size[0];
    dust.maxSize = DUST.size[1];
    dust.addColorGradient(0, new Color4(DUST.color[0], DUST.color[1], DUST.color[2], 0));
    dust.addColorGradient(0.25, new Color4(...DUST.color));
    dust.addColorGradient(1, new Color4(DUST.color[0], DUST.color[1], DUST.color[2], 0));
    dust.minAngularSpeed = -0.8;
    dust.maxAngularSpeed = 0.8;
    dust.minEmitPower = dust.maxEmitPower = 1;
    dust.startPositionFunction = (_m, position) => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * DUST.radius;
      const up = DUST.height[0] + Math.random() * (DUST.height[1] - DUST.height[0]);
      // Upwind by half a lifetime's travel, so the puffs blow past the camera.
      const lead = DUST.life[0] * 0.5 * DUST.gust;
      position.set(centre.x + Math.cos(a) * r - wind.x * lead, centre.y + up, centre.z + Math.sin(a) * r - wind.z * lead);
    };
    dust.startDirectionFunction = (_m, direction) => {
      const k = DUST.gust * (0.7 + Math.random() * 0.6);
      direction.set(wind.x * k + (Math.random() - 0.5) * 2, (Math.random() - 0.4) * 1.2, wind.z * k + (Math.random() - 0.5) * 2);
    };

    for (const s of [rain, dust]) {
      s.emitter = Vector3.Zero();
      s.isLocal = false;
      s.updateSpeed = 1 / 60;
      s.emitRate = 0;
      s.start();
    }
    this.rain = rain;
    this.dust = dust;
  }

  /** Follow the camera and the weather where the player is. Call each frame while in play. */
  update(camera: Vector3, w: WeatherSample): void {
    this.centre.copyFrom(camera);
    this.wind.set(Math.sin(w.heading) * w.wind, 0, Math.cos(w.heading) * w.wind);
    this.rain.emitRate = RAIN.rate * w.rain * this.scale;
    this.dust.emitRate = DUST.rate * w.dust * this.scale;
  }

  /** Stop making new particles (menus); those in the air finish their fall. */
  idle(): void {
    this.rain.emitRate = 0;
    this.dust.emitRate = 0;
  }

  /** Particles alive right now (a profiling counter, and for tests). */
  get activeCount(): { rain: number; dust: number } {
    return { rain: this.rain.getActiveCount(), dust: this.dust.getActiveCount() };
  }
}
