import { BIOME_IDS, BIOMES, type RGB, type ScatterKind } from "../data/biomes";
import type { StreamConfig } from "../data/streaming";
import type { WorldDef } from "../data/world";
import { makeRng } from "./math";
import { biomeWeights, heightAt, rimFactor, type WorldModel } from "./terrain";

/** What is loaded for one chunk. */
export interface ChunkState {
  /** Index into `lodDivisors`: 0 is full detail. */
  lod: number;
  collider: boolean;
  detail: boolean;
}

export const chunksPerSide = (def: WorldDef): number => Math.round(def.size / def.chunkSize);

/** Chunk column or row holding a world coordinate, clamped to the world. */
export function chunkIndex(def: WorldDef, v: number): number {
  const i = Math.floor((v + def.size / 2) / def.chunkSize);
  return Math.min(chunksPerSide(def) - 1, Math.max(0, i));
}

/** World coordinate of a chunk column or row's low edge. */
export const chunkOrigin = (def: WorldDef, i: number): number => i * def.chunkSize - def.size / 2;

export const chunkKey = (cx: number, cz: number): number => cz * 4096 + cx;
export const chunkFromKey = (key: number): [number, number] => [key % 4096, Math.floor(key / 4096)];

/** Distance in chunks from a position to a chunk's centre, along the longer axis. */
export function chunkDistance(def: WorldDef, cx: number, cz: number, x: number, z: number): number {
  const half = def.chunkSize / 2;
  return Math.max(Math.abs(x - (chunkOrigin(def, cx) + half)), Math.abs(z - (chunkOrigin(def, cz) + half))) / def.chunkSize;
}

/** Keep `on` unless the distance has passed the far threshold; turn it on inside the near one. */
const latch = (on: boolean, distance: number, [near, far]: readonly number[]): boolean => (on ? distance <= far! : distance < near!);

/** What one chunk should have loaded at a distance, given what it has now. Null: unload it. */
export function planChunk(distance: number, current: ChunkState | null, cfg: StreamConfig): ChunkState | null {
  if (!latch(current !== null, distance, cfg.view)) return null;
  let lod = cfg.lodDistance.findIndex((d) => distance < d);
  if (lod < 0) lod = cfg.lodDistance.length;
  if (current && current.lod !== lod) {
    // Only change detail once clearly past the threshold between the two steps.
    const threshold = cfg.lodDistance[Math.min(lod, current.lod)]!;
    if (Math.abs(distance - threshold) < cfg.lodMargin) lod = current.lod;
  }
  return {
    lod,
    collider: latch(current?.collider ?? false, distance, cfg.collider),
    detail: latch(current?.detail ?? false, distance, cfg.detail),
  };
}

/** The chunks that should be loaded around a position, keyed by `chunkKey`. */
export function planChunks(def: WorldDef, x: number, z: number, current: ReadonlyMap<number, ChunkState>, cfg: StreamConfig): Map<number, ChunkState> {
  const reach = Math.ceil(cfg.view[1]!) + 1;
  const px = chunkIndex(def, x);
  const pz = chunkIndex(def, z);
  const last = chunksPerSide(def) - 1;
  const plan = new Map<number, ChunkState>();
  for (let cz = Math.max(0, pz - reach); cz <= Math.min(last, pz + reach); cz++) {
    for (let cx = Math.max(0, px - reach); cx <= Math.min(last, px + reach); cx++) {
      const key = chunkKey(cx, cz);
      const state = planChunk(chunkDistance(def, cx, cz, x, z), current.get(key) ?? null, cfg);
      if (state) plan.set(key, state);
    }
  }
  return plan;
}

/** A rock, slab or pillar: a box sunk a little into the ground. */
export interface ScatterItem {
  kind: ScatterKind;
  x: number;
  /** Height of the box's centre. */
  y: number;
  z: number;
  size: [number, number, number];
  rotY: number;
  tilt: number;
  color: RGB;
}

function hashChunk(seed: number, cx: number, cz: number): number {
  let h = Math.imul(cx + 1, 73856093) ^ Math.imul(cz + 1, 19349663) ^ Math.imul(seed, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * The scatter objects standing in one chunk. Depends only on the world and the chunk, so a
 * chunk looks the same every time it loads.
 */
export function chunkScatter(model: WorldModel, cx: number, cz: number): ScatterItem[] {
  const def = model.def;
  const rng = makeRng(hashChunk(def.seed, cx, cz));
  const x0 = chunkOrigin(def, cx);
  const z0 = chunkOrigin(def, cz);
  const areaKm2 = (def.chunkSize / 1000) ** 2;
  const weights = new Float32Array(BIOME_IDS.length);
  const items: ScatterItem[] = [];
  BIOME_IDS.forEach((id, b) => {
    for (const scatter of BIOMES[id].scatter) {
      const expected = scatter.density * areaKm2;
      const candidates = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
      for (let i = 0; i < candidates; i++) {
        // Every candidate draws the same number of values, so one rejection does not move the rest.
        const x = x0 + rng() * def.chunkSize;
        const z = z0 + rng() * def.chunkSize;
        const roll = rng();
        const h = scatter.size[0] + rng() * (scatter.size[1] - scatter.size[0]);
        const a = 0.8 + rng() * 0.8;
        const c = 0.8 + rng() * 0.8;
        const rotY = rng() * Math.PI;
        const lean = rng() - 0.5;
        if (roll >= biomeWeights(def, x, z, weights)[b]!) continue;
        if (rimFactor(def, x, z) > 0.5) continue;
        if (model.sites.some((s) => Math.hypot(x - s.x, z - s.z) < s.radius + 8)) continue;
        const size: [number, number, number] =
          scatter.kind === "slab" ? [h * (0.9 + a), h, 1.2 + c] : scatter.kind === "pillar" ? [2 + a * 1.5, h, 2 + c * 1.5] : [h * a, h, h * c];
        const tilt = lean * (scatter.kind === "rock" ? 0.5 : 0.16);
        // Sunk into the ground so a tilted box never shows a gap under one edge.
        const sink = scatter.kind === "rock" ? h * 0.3 : 1.5;
        items.push({ kind: scatter.kind, x, y: heightAt(model, x, z) - sink + h / 2, z, size, rotY, tilt, color: scatter.color });
      }
    }
  });
  return items;
}
