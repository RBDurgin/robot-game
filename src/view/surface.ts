import { RawTexture, Scene, Texture } from "../babylon";

/** Texels per side of the generated surface textures; one tile covers TILE_METRES of a part. */
const SIZE = 512;
export const TILE_METRES = 3;

/** Small deterministic random source, so the textures are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Height and shade for armour plating: panels split recursively, with recessed seams, a few
 * rivets along them and soft grime. Height is 0..1 (seams low), shade is a multiplier near 1.
 */
function plating(): { height: Float32Array; shade: Float32Array } {
  const height = new Float32Array(SIZE * SIZE).fill(1);
  const shade = new Float32Array(SIZE * SIZE).fill(1);
  const rand = rng(7);
  const at = (x: number, y: number): number => ((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE);

  const seam = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      height[at(x, y)] = 0.3;
      shade[at(x, y)] = 0.72;
    }
  };
  const rivets = (x0: number, y0: number, x1: number, y1: number): void => {
    const horizontal = y0 === y1;
    const length = horizontal ? x1 - x0 : y1 - y0;
    for (let k = 10; k < length - 6; k += 22) {
      const cx = horizontal ? x0 + k : x0 + 6;
      const cy = horizontal ? y0 + 6 : y0 + k;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 4) continue;
        height[at(cx + dx, cy + dy)] = 1.35 - (dx * dx + dy * dy) * 0.08;
      }
    }
  };
  // Panels: split the tile into rectangles; each split leaves a seam.
  const split = (x: number, y: number, w: number, h: number, depth: number): void => {
    if (depth > 3 || (w < 150 && h < 150) || (depth > 1 && rand() < 0.3)) {
      // A panel: tint it slightly so neighbouring plates read as separate pieces.
      const tint = 0.95 + rand() * 0.07;
      for (let py = y + 2; py < y + h - 1; py++) for (let px = x + 2; px < x + w - 1; px++) shade[at(px, py)]! *= tint;
      if (rand() < 0.4) rivets(x, y, x + w, y);
      return;
    }
    if (w >= h) {
      const cut = Math.floor(w * (0.3 + rand() * 0.4));
      seam(x + cut, y, x + cut + 1, y + h - 1);
      split(x, y, cut, h, depth + 1);
      split(x + cut + 2, y, w - cut - 2, h, depth + 1);
    } else {
      const cut = Math.floor(h * (0.3 + rand() * 0.4));
      seam(x, y + cut, x + w - 1, y + cut + 1);
      split(x, y, w, cut, depth + 1);
      split(x, y + cut + 2, w, h - cut - 2, depth + 1);
    }
  };
  // The tile's own edges are a seam too, so tiles meet cleanly.
  seam(0, 0, SIZE - 1, 1);
  seam(0, 0, 1, SIZE - 1);
  split(2, 2, SIZE - 2, SIZE - 2, 0);

  // Grime: low-frequency blotches plus fine speckle, darkening a little.
  const blobs = Array.from({ length: 28 }, () => ({ x: rand() * SIZE, y: rand() * SIZE, r: 20 + rand() * 70, k: 0.04 + rand() * 0.08 }));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let dirt = 0;
    for (const b of blobs) {
      const dx = Math.min(Math.abs(x - b.x), SIZE - Math.abs(x - b.x));
      const dy = Math.min(Math.abs(y - b.y), SIZE - Math.abs(y - b.y));
      const d = (dx * dx + dy * dy) / (b.r * b.r);
      if (d < 1) dirt += b.k * (1 - d);
    }
    shade[at(x, y)]! *= 1 - Math.min(0.2, dirt) - rand() * 0.035;
  }
  return { height, shade };
}

const cache = new WeakMap<Scene, { albedo: Texture; normal: Texture }>();

/**
 * Tiling textures for painted armour: a near-white albedo (multiplied by a material's colour)
 * and the matching normal map. Generated once per scene, shared by every mech material.
 */
export function surfaceTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  let made = cache.get(scene);
  if (made) return made;
  const { height, shade } = plating();
  const albedo = new Uint8Array(SIZE * SIZE * 4);
  const normal = new Uint8Array(SIZE * SIZE * 4);
  const h = (x: number, y: number): number => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
  const strength = 1.6;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const v = Math.max(0, Math.min(255, Math.round(shade[y * SIZE + x]! * 245)));
    albedo[i] = albedo[i + 1] = albedo[i + 2] = v;
    albedo[i + 3] = 255;
    // Sobel slope of the height field to a tangent-space normal.
    const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength;
    const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    normal[i] = Math.round((-dx / len) * 127.5 + 127.5);
    normal[i + 1] = Math.round((-dy / len) * 127.5 + 127.5);
    normal[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
    normal[i + 3] = 255;
  }
  const texture = (data: Uint8Array, name: string): Texture => {
    const t = RawTexture.CreateRGBATexture(data, SIZE, SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = name;
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.uScale = t.vScale = 1 / TILE_METRES;
    t.anisotropicFilteringLevel = 4;
    return t;
  };
  made = { albedo: texture(albedo, "plating-albedo"), normal: texture(normal, "plating-normal") };
  cache.set(scene, made);
  return made;
}
