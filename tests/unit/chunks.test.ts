import { describe, expect, it } from "vitest";
import { STREAM } from "../../src/data/streaming";
import { WORLD } from "../../src/data/world";
import { chunkDistance, chunkFromKey, chunkIndex, chunkKey, chunkOrigin, chunkScatter, chunksPerSide, planChunk, planChunks, type ChunkState } from "../../src/sim/chunks";
import { biomeAt } from "../../src/sim/terrain";
import { buildWorldModel } from "../../src/sim/worldgen";

const model = buildWorldModel(WORLD);

describe("chunk grid", () => {
  it("maps positions to chunks and back", () => {
    expect(chunkIndex(WORLD, -WORLD.size / 2)).toBe(0);
    expect(chunkIndex(WORLD, 0)).toBe(chunksPerSide(WORLD) / 2);
    expect(chunkIndex(WORLD, WORLD.size / 2 + 50)).toBe(chunksPerSide(WORLD) - 1);
    expect(chunkIndex(WORLD, -1e6)).toBe(0);
    expect(chunkFromKey(chunkKey(7, 29))).toEqual([7, 29]);
    const cx = chunkIndex(WORLD, 300);
    expect(chunkOrigin(WORLD, cx)).toBeLessThanOrEqual(300);
    expect(chunkOrigin(WORLD, cx) + WORLD.chunkSize).toBeGreaterThan(300);
    expect(chunkDistance(WORLD, cx, cx, chunkOrigin(WORLD, cx) + 128, chunkOrigin(WORLD, cx) + 128)).toBe(0);
  });
});

describe("chunk planning", () => {
  it("loads in rings: detail and colliders near, coarse terrain far, nothing beyond", () => {
    expect(planChunk(0.3, null, STREAM)).toEqual({ lod: 0, collider: true, detail: true });
    expect(planChunk(2.2, null, STREAM)).toEqual({ lod: 1, collider: true, detail: true });
    expect(planChunk(3.2, null, STREAM)).toEqual({ lod: 2, collider: false, detail: true });
    expect(planChunk(4.2, null, STREAM)).toEqual({ lod: 2, collider: false, detail: false });
    expect(planChunk(4.8, null, STREAM)).toBeNull();
  });

  it("holds on to what is loaded until clearly out of range", () => {
    const loaded: ChunkState = { lod: 2, collider: false, detail: false };
    expect(planChunk(4.8, loaded, STREAM)).not.toBeNull();
    expect(planChunk(5.1, loaded, STREAM)).toBeNull();
    expect(planChunk(3.0, { lod: 1, collider: true, detail: true }, STREAM)?.collider).toBe(true);
    expect(planChunk(3.2, { lod: 1, collider: true, detail: true }, STREAM)?.collider).toBe(false);
    // Detail step does not flicker at a threshold.
    expect(planChunk(1.65, { lod: 0, collider: true, detail: true }, STREAM)?.lod).toBe(0);
    expect(planChunk(1.55, { lod: 1, collider: true, detail: true }, STREAM)?.lod).toBe(1);
    expect(planChunk(1.9, { lod: 0, collider: true, detail: true }, STREAM)?.lod).toBe(1);
  });

  it("pacing across a chunk border changes nothing after the first crossing", () => {
    const border = chunkOrigin(WORLD, 16);
    let plan = planChunks(WORLD, border - 3, 40, new Map(), STREAM);
    plan = planChunks(WORLD, border + 3, 40, plan, STREAM);
    const settled = JSON.stringify([...plan]);
    for (let i = 0; i < 6; i++) {
      plan = planChunks(WORLD, border + (i % 2 ? 3 : -3), 40, plan, STREAM);
      expect(JSON.stringify([...plan])).toBe(settled);
    }
  });

  it("always has colliders under every mech that can be awake, and terrain out past the fog", () => {
    for (const [x, z] of [[0, 0], [127.9, -128.1], [-3000, 2990], [3860, -3860], [511, 767]] as const) {
      // Worst case: a fresh plan, with none of the extra chunks hysteresis would keep.
      const plan = planChunks(WORLD, x, z, new Map(), STREAM);
      for (let a = 0; a < 360; a += 7) {
        for (const [reach, need] of [[STREAM.mechSleep, "collider"], [960, "view"]] as const) {
          const px = x + Math.cos(a) * reach;
          const pz = z + Math.sin(a) * reach;
          if (Math.max(Math.abs(px), Math.abs(pz)) >= WORLD.size / 2) continue;
          const state = plan.get(chunkKey(chunkIndex(WORLD, px), chunkIndex(WORLD, pz)));
          expect(state, `${need} at ${reach} m from ${x},${z}`).toBeDefined();
          if (need === "collider") expect(state!.collider).toBe(true);
        }
      }
      // The chunks around the player are at full detail.
      expect(plan.get(chunkKey(chunkIndex(WORLD, x), chunkIndex(WORLD, z)))!.lod).toBe(0);
    }
  });

  it("the amount loaded is bounded wherever the player goes", () => {
    let plan = new Map<number, ChunkState>();
    let most = 0;
    for (let i = 0; i < 400; i++) {
      plan = planChunks(WORLD, -3800 + i * 19, 3800 - i * 17, plan, STREAM);
      most = Math.max(most, plan.size);
    }
    expect(most).toBeLessThanOrEqual(11 * 11);
    expect([...plan.values()].filter((s) => s.collider).length).toBeLessThanOrEqual(7 * 7);
  });
});

describe("scatter", () => {
  it("is the same every time a chunk loads, and differs between chunks", () => {
    expect(chunkScatter(model, 12, 20)).toEqual(chunkScatter(model, 12, 20));
    expect(chunkScatter(model, 12, 20)).not.toEqual(chunkScatter(model, 13, 20));
  });

  it("stays inside its chunk and clear of sites", () => {
    for (const site of model.sites.slice(0, 6)) {
      const cx = chunkIndex(WORLD, site.x);
      const cz = chunkIndex(WORLD, site.z);
      for (const item of chunkScatter(model, cx, cz)) {
        expect(chunkIndex(WORLD, item.x)).toBe(cx);
        expect(chunkIndex(WORLD, item.z)).toBe(cz);
        expect(Math.hypot(item.x - site.x, item.z - site.z)).toBeGreaterThanOrEqual(site.radius + 8);
      }
    }
  });

  it("follows the biome: ruins are cluttered, salt flats nearly bare", () => {
    const count = (biome: string): number => {
      let n = 0;
      let chunks = 0;
      for (let cz = 2; cz < 30; cz++) {
        for (let cx = 2; cx < 30; cx++) {
          const mid = WORLD.chunkSize / 2;
          if (biomeAt(WORLD, chunkOrigin(WORLD, cx) + mid, chunkOrigin(WORLD, cz) + mid).id !== biome) continue;
          n += chunkScatter(model, cx, cz).length;
          chunks++;
        }
      }
      return n / chunks;
    };
    expect(count("ruins")).toBeGreaterThan(count("basin") * 1.5);
    expect(count("saltFlats")).toBeLessThan(count("basin") * 0.5);
    expect(count("ruins")).toBeLessThan(20);
  });
});
