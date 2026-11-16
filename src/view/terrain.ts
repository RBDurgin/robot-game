import { Color3, Mesh, Scene, StandardMaterial, VertexData } from "@babylonjs/core";
import type { RGB } from "../data/biomes";
import type { WorldDef } from "../data/world";
import { chunkOrigin } from "../sim/chunks";
import { clamp, smoothstep } from "../sim/math";
import { BIOME_COUNT, biomeList, rimFactor, sampleTerrain, type WorldModel } from "../sim/terrain";

const RIM_ROCK: RGB = [0.45, 0.44, 0.45];
const RIM_SNOW: RGB = [0.88, 0.9, 0.93];

/** Heights and colours of one chunk on a square grid of `n` x `n` samples, row by row along +Z. */
export interface TerrainGrid {
  n: number;
  heights: Float32Array;
  /** Three values per sample. */
  colors: Float32Array;
}

const weights = new Float32Array(BIOME_COUNT);

/** Ground colour for a height and biome mix: each biome's ramp from low to high, blended. */
export function groundColor(def: WorldDef, x: number, z: number, h: number, mix: Float32Array, out: Float32Array, at: number): void {
  let r = 0;
  let g = 0;
  let b = 0;
  const biomes = biomeList();
  for (let i = 0; i < BIOME_COUNT; i++) {
    const w = mix[i]!;
    if (w <= 0) continue;
    const biome = biomes[i]!;
    const t = clamp((h - biome.elevation) / biome.relief, 0, 1);
    const [from, to, k] = t < 0.5 ? [biome.colors.low, biome.colors.mid, t / 0.5] : [biome.colors.mid, biome.colors.high, (t - 0.5) / 0.5];
    r += w * (from[0] + (to[0] - from[0]) * k);
    g += w * (from[1] + (to[1] - from[1]) * k);
    b += w * (from[2] + (to[2] - from[2]) * k);
  }
  const rim = rimFactor(def, x, z);
  if (rim > 0) {
    // The rim mountains are bare rock, snow-capped near the top.
    const rock = Math.min(1, rim * 2.5);
    const snow = smoothstep(0.55, 0.9, rim);
    r += (RIM_ROCK[0] - r) * rock;
    g += (RIM_ROCK[1] - g) * rock;
    b += (RIM_ROCK[2] - b) * rock;
    r += (RIM_SNOW[0] - r) * snow;
    g += (RIM_SNOW[1] - g) * snow;
    b += (RIM_SNOW[2] - b) * snow;
  }
  out[at] = r;
  out[at + 1] = g;
  out[at + 2] = b;
}

/** Sample a chunk's terrain at `cells` + 1 points per side. */
export function sampleChunk(model: WorldModel, cx: number, cz: number, cells: number): TerrainGrid {
  const def = model.def;
  const n = cells + 1;
  const x0 = chunkOrigin(def, cx);
  const z0 = chunkOrigin(def, cz);
  const step = def.chunkSize / cells;
  const heights = new Float32Array(n * n);
  const colors = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      // Multiply rather than accumulate, so neighbouring chunks compute identical edge positions.
      const x = x0 + ix * step;
      const z = z0 + iz * step;
      const i = iz * n + ix;
      const h = sampleTerrain(model, x, z, weights);
      heights[i] = h;
      groundColor(def, x, z, h, weights, colors, i * 3);
    }
  }
  return { n, heights, colors };
}

/** Keep every `divisor`-th sample of a grid. */
export function subsampleGrid(grid: TerrainGrid, divisor: number): TerrainGrid {
  if (divisor === 1) return grid;
  const n = (grid.n - 1) / divisor + 1;
  const heights = new Float32Array(n * n);
  const colors = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const from = iz * divisor * grid.n + ix * divisor;
      const to = iz * n + ix;
      heights[to] = grid.heights[from]!;
      colors.set(grid.colors.subarray(from * 3, from * 3 + 3), to * 3);
    }
  }
  return { n, heights, colors };
}

export function terrainMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial("terrainMat", scene);
  mat.specularColor = Color3.Black();
  // Chunks never move, and there are a lot of them.
  mat.freeze();
  return mat;
}

/** True if Babylon treats a triangle whose right-hand normal faces the viewer as front-facing. */
const RIGHT_HANDED_FRONT = ((): boolean => {
  const normals: number[] = [];
  // In the ground plane, right-hand normal pointing up.
  VertexData.ComputeNormals([0, 0, 0, 0, 0, 1, 1, 0, 0], [0, 1, 2], normals);
  return normals[1]! > 0;
})();

/**
 * Build the mesh for one chunk from its grid. Flat shaded: every triangle has its own vertices.
 * A skirt hangs from the edges to hide the hairline gaps where a neighbour has a different
 * level of detail.
 */
export function buildChunkMesh(scene: Scene, def: WorldDef, cx: number, cz: number, grid: TerrainGrid, material: StandardMaterial): Mesh {
  const n = grid.n;
  const cells = n - 1;
  const step = def.chunkSize / cells;
  const x0 = chunkOrigin(def, cx);
  const z0 = chunkOrigin(def, cz);
  const skirt = step * 1.5;
  const triangles = cells * cells * 2 + cells * 8;
  const positions = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 12);
  let v = 0;

  /** Add a vertex at grid point (ix, iz), dropped by `drop` metres. */
  const vertex = (ix: number, iz: number, drop: number): void => {
    const i = iz * n + ix;
    positions[v * 3] = x0 + ix * step;
    positions[v * 3 + 1] = grid.heights[i]! - drop;
    positions[v * 3 + 2] = z0 + iz * step;
    colors[v * 4] = grid.colors[i * 3]!;
    colors[v * 4 + 1] = grid.colors[i * 3 + 1]!;
    colors[v * 4 + 2] = grid.colors[i * 3 + 2]!;
    colors[v * 4 + 3] = 1;
    v++;
  };
  type P = readonly [number, number, number];
  /** A triangle given so that its right-hand normal faces outward. */
  const tri = (a: P, b: P, c: P): void => {
    vertex(a[0], a[1], a[2]);
    if (RIGHT_HANDED_FRONT) {
      vertex(b[0], b[1], b[2]);
      vertex(c[0], c[1], c[2]);
    } else {
      vertex(c[0], c[1], c[2]);
      vertex(b[0], b[1], b[2]);
    }
  };

  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      // (z, x) order gives a normal pointing up.
      tri([ix, iz, 0], [ix, iz + 1, 0], [ix + 1, iz, 0]);
      tri([ix + 1, iz, 0], [ix, iz + 1, 0], [ix + 1, iz + 1, 0]);
    }
  }
  const surfaceVertices = v;
  for (let i = 0; i < cells; i++) {
    // Each edge: a strip of quads facing away from the chunk.
    const edges: [P, P, P, P][] = [
      [[i, 0, 0], [i + 1, 0, 0], [i + 1, 0, skirt], [i, 0, skirt]],
      [[i + 1, cells, 0], [i, cells, 0], [i, cells, skirt], [i + 1, cells, skirt]],
      [[0, i + 1, 0], [0, i, 0], [0, i, skirt], [0, i + 1, skirt]],
      [[cells, i, 0], [cells, i + 1, 0], [cells, i + 1, skirt], [cells, i, skirt]],
    ];
    for (const [a, b, c, d] of edges) {
      tri(a, b, c);
      tri(a, c, d);
    }
  }

  const indices = new Uint32Array(v);
  for (let i = 0; i < v; i++) indices[i] = i;
  const normals = new Float32Array(v * 3);
  VertexData.ComputeNormals(positions, indices, normals);
  // Light the skirt like the ground it hangs from, so where it does show (and along the shared
  // edge of two chunks, where it can win the depth test by a hair) it cannot be told apart.
  let s = surfaceVertices * 3;
  for (let i = 0; i < cells; i++) {
    for (const cell of [i, (cells - 1) * cells + i, i * cells, i * cells + cells - 1]) {
      for (let k = 0; k < 6; k++, s += 3) normals.set(normals.subarray(cell * 18, cell * 18 + 3), s);
    }
  }

  const mesh = new Mesh(`chunk ${cx},${cz}`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.colors = colors;
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  // Static geometry: skip the per-frame world matrix work.
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
  return mesh;
}
