import { BIOME_IDS, BIOMES, type BiomeDef } from "../data/biomes";
import type { RegionDef, SiteDef, WorldDef } from "../data/world";
import { fbm2D, lerp, smoothstep } from "./math";

/** A site with what the world derives for it. */
export interface Site extends SiteDef {
  /** Height the ground inside the site is levelled to. */
  level: number;
  /** True for sites placed by rules rather than by hand. */
  generated: boolean;
}

/** A world definition plus everything derived from it once at start-up (see `buildWorldModel`). */
export interface WorldModel {
  def: WorldDef;
  sites: Site[];
  siteById: Map<string, Site>;
}

const BIOME_LIST: BiomeDef[] = BIOME_IDS.map((id) => BIOMES[id]);
export const BIOME_COUNT = BIOME_LIST.length;

/** Sites level the ground out to this many radii, blending back into the terrain. */
const FLAT_FALLOFF = 1.8;

const scratchWeights = new Float32Array(BIOME_COUNT);
const scratchDist: number[] = [];

/** Region borders wander: positions are nudged by slow noise before the nearest region is found. */
function warp(def: WorldDef, x: number, z: number): [number, number] {
  const f = 1 / 900;
  const wx = (fbm2D(x * f + 13, z * f - 7, def.seed + 11, 3) - 0.5) * 2 * def.borderWarp;
  const wz = (fbm2D(x * f - 31, z * f + 19, def.seed + 12, 3) - 0.5) * 2 * def.borderWarp;
  return [x + wx, z + wz];
}

/**
 * How much of each biome is present at a position, in `BIOME_IDS` order, summing to 1.
 * Deep inside a region its biome has weight 1; near a border the neighbours blend in smoothly.
 */
export function biomeWeights(def: WorldDef, x: number, z: number, out: Float32Array = new Float32Array(BIOME_COUNT)): Float32Array {
  const [wx, wz] = warp(def, x, z);
  let nearest = Infinity;
  for (let i = 0; i < def.regions.length; i++) {
    const r = def.regions[i]!;
    const d = Math.hypot(wx - r.x, wz - r.z);
    scratchDist[i] = d;
    if (d < nearest) nearest = d;
  }
  out.fill(0);
  let total = 0;
  for (let i = 0; i < def.regions.length; i++) {
    const t = 1 - (scratchDist[i]! - nearest) / def.biomeBlend;
    if (t <= 0) continue;
    const w = t * t * (3 - 2 * t);
    out[BIOME_IDS.indexOf(def.regions[i]!.biome)]! += w;
    total += w;
  }
  for (let b = 0; b < BIOME_COUNT; b++) out[b]! /= total;
  return out;
}

/** The named region a position belongs to. */
export function regionAt(def: WorldDef, x: number, z: number): RegionDef {
  const [wx, wz] = warp(def, x, z);
  let best = def.regions[0]!;
  let nearest = Infinity;
  for (const r of def.regions) {
    const d = Math.hypot(wx - r.x, wz - r.z);
    if (d < nearest) {
      nearest = d;
      best = r;
    }
  }
  return best;
}

/** The biome with the most weight at a position. */
export function biomeAt(def: WorldDef, x: number, z: number): BiomeDef {
  const w = biomeWeights(def, x, z, scratchWeights);
  let best = 0;
  for (let b = 1; b < BIOME_COUNT; b++) if (w[b]! > w[best]!) best = b;
  return BIOME_LIST[best]!;
}

/** One biome's terrain on its own: rolling ground with a sharper ridged layer on top. */
function biomeHeight(biome: BiomeDef, seed: number, x: number, z: number): number {
  const f = 1 / biome.featureSize;
  const base = fbm2D(x * f, z * f, seed, 5);
  if (biome.ridge <= 0) return biome.elevation + base * biome.relief;
  // Ridges give hills crests to fight over rather than only smooth bumps.
  const ridge = 1 - Math.abs(fbm2D(x * f * 1.7 + 40, z * f * 1.7 - 17, seed + 7, 3) * 2 - 1);
  return biome.elevation + (base * (1 - biome.ridge) + ridge * ridge * biome.ridge) * biome.relief;
}

/** 0 inside the world, rising to 1 at its edge: how far up the rim mountains a position is. */
export function rimFactor(def: WorldDef, x: number, z: number): number {
  const half = def.size / 2;
  return smoothstep(half - def.rim.width, half, Math.max(Math.abs(x), Math.abs(z)));
}

/** Ground height before sites level it: the blended biomes plus the rim mountains. */
export function naturalHeight(def: WorldDef, x: number, z: number, weights: Float32Array = scratchWeights): number {
  biomeWeights(def, x, z, weights);
  let h = 0;
  for (let b = 0; b < BIOME_COUNT; b++) {
    const w = weights[b]!;
    if (w > 0) h += w * biomeHeight(BIOME_LIST[b]!, def.seed, x, z);
  }
  const rim = rimFactor(def, x, z);
  if (rim > 0) {
    // Jagged rather than a smooth ramp, so the wall reads as mountains.
    const crags = fbm2D(x / 140 + 5, z / 140 - 9, def.seed + 23, 4);
    h += rim * def.rim.height * (0.75 + 0.5 * crags);
  }
  return h;
}

/**
 * The terrain's shape at a world position, also filling `weights` with the biome mix there.
 * Pure function of the world model, so neighbouring chunks meet exactly. The ground itself is
 * this function sampled on a grid: use `heightAt` to ask where the ground is.
 */
export function sampleTerrain(model: WorldModel, x: number, z: number, weights: Float32Array): number {
  let h = naturalHeight(model.def, x, z, weights);
  for (const site of model.sites) {
    const reach = site.radius * FLAT_FALLOFF;
    const dx = x - site.x;
    const dz = z - site.z;
    if (Math.abs(dx) >= reach || Math.abs(dz) >= reach) continue;
    const d = Math.hypot(dx, dz);
    if (d < reach) h = lerp(site.level, h, smoothstep(site.radius, reach, d));
  }
  return h;
}

/** Side length in metres of one cell of the grid the ground is built on. */
export const terrainCell = (def: WorldDef): number => def.chunkSize / def.chunkCells;

/**
 * Ground height at a world position: the surface the terrain mesh and colliders are built
 * from, which is `sampleTerrain` at the corners of a grid cell, interpolated between them.
 * On a sharp crest this is a metre or two below the raw function, so spawn placement, AI and
 * anything else that must agree with what a mech stands on asks this, not `sampleTerrain`.
 */
export function heightAt(model: WorldModel, x: number, z: number): number {
  const cell = terrainCell(model.def);
  const half = model.def.size / 2;
  const gx = (x + half) / cell;
  const gz = (z + half) / cell;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const x0 = ix * cell - half;
  const z0 = iz * cell - half;
  const h00 = sampleTerrain(model, x0, z0, scratchWeights);
  const h10 = sampleTerrain(model, x0 + cell, z0, scratchWeights);
  const h01 = sampleTerrain(model, x0, z0 + cell, scratchWeights);
  const h11 = sampleTerrain(model, x0 + cell, z0 + cell, scratchWeights);
  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
}

/** The biomes in the order `biomeWeights` reports them. */
export const biomeList = (): readonly BiomeDef[] => BIOME_LIST;
