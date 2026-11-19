import type { Mesh, Scene, StandardMaterial } from "../babylon";
import { STREAM } from "../data/streaming";
import { chunkDistance, chunkFromKey, chunkIndex, chunkKey, chunkOrigin, chunkScatter, chunksPerSide, planChunks, type ChunkState } from "../sim/chunks";
import type { Site, WorldModel } from "../sim/terrain";
import { buildScatter, buildSite, StructureMaterials, type Disposable } from "../view/structures";
import { buildChunkMesh, sampleChunk, subsampleGrid, terrainMaterial, type TerrainGrid } from "../view/terrain";
import { perfEnd, perfStart } from "./perf";
import { addHeightfieldCollider } from "./physics";

interface Chunk {
  cx: number;
  cz: number;
  /** The finest grid sampled so far. Kept so a change of detail does not sample again. */
  grid: TerrainGrid | null;
  /** Divisor of the detail step `grid` was sampled at. */
  gridDivisor: number;
  mesh: Mesh | null;
  /** Detail step the mesh was built at, or -1. */
  lod: number;
  collider: Disposable | null;
  detail: Disposable[] | null;
}

/** How far the player moves before the set of wanted chunks is worked out again. */
const REPLAN_DISTANCE = 6;

/**
 * Keeps terrain, colliders, scatter and site structures loaded around the player and removes
 * them behind. What should be loaded is decided by the pure planner in `src/sim/chunks.ts`; this
 * class does the building, a few milliseconds per frame, nearest first.
 */
export class TerrainStreamer {
  private readonly chunks = new Map<number, Chunk>();
  private readonly sitesByChunk = new Map<number, Site[]>();
  private readonly material: StandardMaterial;
  private readonly materials: StructureMaterials;
  private plan = new Map<number, ChunkState>();
  /** Chunk keys with work outstanding, nearest first. */
  private queue: number[] = [];
  private planX = Infinity;
  private planZ = Infinity;
  /** Called when a site's structures appear and when they are removed. */
  onSite: ((site: Site, loaded: boolean) => void) | null = null;
  /** Jobs done by the last `update`, for the profiler. */
  lastJobs = 0;
  /** Longest single job, longest `update` and longest `loadAll` so far, in milliseconds. */
  readonly worst = { jobMs: 0, updateMs: 0, loadAllMs: 0 };

  constructor(
    private readonly scene: Scene,
    private readonly model: WorldModel,
  ) {
    this.material = terrainMaterial(scene);
    this.materials = new StructureMaterials(scene);
    for (const site of model.sites) {
      const key = chunkKey(chunkIndex(model.def, site.x), chunkIndex(model.def, site.z));
      this.sitesByChunk.set(key, [...(this.sitesByChunk.get(key) ?? []), site]);
    }
  }

  get stats(): { chunks: number; colliders: number; detail: number; queued: number } {
    let colliders = 0;
    let detail = 0;
    for (const c of this.chunks.values()) {
      if (c.collider) colliders++;
      if (c.detail) detail++;
    }
    return { chunks: this.chunks.size, colliders, detail, queued: this.queue.length };
  }

  /** True if the ground at a position has its collider, so a mech can stand there. */
  hasGround(x: number, z: number): boolean {
    return !!this.chunks.get(chunkKey(chunkIndex(this.model.def, x), chunkIndex(this.model.def, z)))?.collider;
  }

  private current(): Map<number, ChunkState> {
    const states = new Map<number, ChunkState>();
    for (const [key, c] of this.chunks) {
      // A chunk that is still being built counts as what it is being built toward.
      const target = this.plan.get(key);
      states.set(key, { lod: c.lod >= 0 ? c.lod : (target?.lod ?? 0), collider: !!c.collider || !!target?.collider, detail: !!c.detail || !!target?.detail });
    }
    return states;
  }

  private replan(x: number, z: number): void {
    const def = this.model.def;
    this.plan = planChunks(def, x, z, this.current(), STREAM);
    this.planX = x;
    this.planZ = z;
    const pending: { key: number; d: number }[] = [];
    for (const key of this.chunks.keys()) if (!this.plan.has(key)) pending.push({ key, d: -1 });
    for (const [key, want] of this.plan) {
      const c = this.chunks.get(key);
      if (c && c.lod === want.lod && !!c.collider === want.collider && !!c.detail === want.detail) continue;
      const [cx, cz] = chunkFromKey(key);
      // Ground to stand on matters more than anything in the distance.
      pending.push({ key, d: chunkDistance(def, cx, cz, x, z) - (want.collider && !c?.collider ? 10 : 0) });
    }
    pending.sort((a, b) => a.d - b.d);
    this.queue = pending.map((p) => p.key);
  }

  /** Sample the chunk's terrain at least as finely as `divisor` asks. */
  private gridFor(c: Chunk, divisor: number): TerrainGrid {
    if (!c.grid || c.gridDivisor > divisor) {
      c.grid = sampleChunk(this.model, c.cx, c.cz, this.model.def.chunkCells / divisor);
      c.gridDivisor = divisor;
    }
    return subsampleGrid(c.grid, divisor / c.gridDivisor);
  }

  /** Do one piece of work toward what the plan wants for a chunk. True if more remains. */
  private work(key: number): boolean {
    const def = this.model.def;
    const want = this.plan.get(key);
    let c = this.chunks.get(key);
    if (!want) {
      if (c) this.unload(key, c);
      return false;
    }
    if (!c) {
      const [cx, cz] = chunkFromKey(key);
      c = { cx, cz, grid: null, gridDivisor: Infinity, mesh: null, lod: -1, collider: null, detail: null };
      this.chunks.set(key, c);
    }
    if (want.collider && !c.collider) {
      const grid = this.gridFor(c, 1);
      const half = def.chunkSize / 2;
      c.collider = addHeightfieldCollider(this.scene, chunkOrigin(def, c.cx) + half, chunkOrigin(def, c.cz) + half, def.chunkSize, grid.n, grid.heights);
    } else if (c.lod !== want.lod) {
      const mesh = buildChunkMesh(this.scene, def, c.cx, c.cz, this.gridFor(c, STREAM.lodDivisors[want.lod]!), this.material);
      c.mesh?.dispose();
      c.mesh = mesh;
      c.lod = want.lod;
    } else if (want.detail && !c.detail) {
      c.detail = [];
      const scatter = buildScatter(this.scene, `scatter ${c.cx},${c.cz}`, chunkScatter(this.model, c.cx, c.cz), this.materials);
      if (scatter) c.detail.push(scatter);
      for (const site of this.sitesByChunk.get(key) ?? []) {
        c.detail.push(buildSite(this.scene, site, this.materials));
        this.onSite?.(site, true);
      }
    } else if (!want.collider && c.collider) {
      c.collider.dispose();
      c.collider = null;
    } else if (!want.detail && c.detail) {
      this.dropDetail(key, c);
    }
    return c.lod !== want.lod || !!c.collider !== want.collider || !!c.detail !== want.detail;
  }

  private dropDetail(key: number, c: Chunk): void {
    for (const d of c.detail ?? []) d.dispose();
    if (c.detail) for (const site of this.sitesByChunk.get(key) ?? []) this.onSite?.(site, false);
    c.detail = null;
  }

  private unload(key: number, c: Chunk): void {
    this.dropDetail(key, c);
    c.collider?.dispose();
    c.mesh?.dispose();
    this.chunks.delete(key);
  }

  /**
   * Per-frame streaming: work through the queue until the time budget is spent. At least one
   * job always runs, so the world keeps loading however slow the frame.
   */
  update(x: number, z: number, budgetMs: number = STREAM.frameBudgetMs): void {
    if (Math.abs(x - this.planX) > REPLAN_DISTANCE || Math.abs(z - this.planZ) > REPLAN_DISTANCE) this.replan(x, z);
    this.lastJobs = 0;
    if (this.queue.length === 0) return;
    const t = perfStart();
    const start = performance.now();
    let now = start;
    do {
      const jobStart = now;
      if (!this.work(this.queue[0]!)) this.queue.shift();
      this.lastJobs++;
      now = performance.now();
      this.worst.jobMs = Math.max(this.worst.jobMs, now - jobStart);
    } while (this.queue.length > 0 && now - start < budgetMs);
    this.worst.updateMs = Math.max(this.worst.updateMs, now - start);
    perfEnd("stream", t);
  }

  /** Load everything the plan wants around a position, now. For start-up and teleports. */
  loadAll(x: number, z: number): void {
    const start = performance.now();
    this.replan(x, z);
    while (this.queue.length > 0) if (!this.work(this.queue[0]!)) this.queue.shift();
    this.worst.loadAllMs = Math.max(this.worst.loadAllMs, performance.now() - start);
  }

  /**
   * Make sure there is ground to stand on at a position before physics runs. Normal movement
   * never gets ahead of streaming, so this only does work after a jump across the world, when
   * it loads the whole surroundings at once.
   */
  ensureGround(x: number, z: number): void {
    const def = this.model.def;
    const px = chunkIndex(def, x);
    const pz = chunkIndex(def, z);
    const last = chunksPerSide(def) - 1;
    for (let cz = Math.max(0, pz - 1); cz <= Math.min(last, pz + 1); cz++) {
      for (let cx = Math.max(0, px - 1); cx <= Math.min(last, px + 1); cx++) {
        if (!this.chunks.get(chunkKey(cx, cz))?.collider) {
          this.loadAll(x, z);
          return;
        }
      }
    }
  }
}
