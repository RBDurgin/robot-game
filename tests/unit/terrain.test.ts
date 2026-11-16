import { describe, expect, it } from "vitest";
import { BIOME_IDS, BIOMES } from "../../src/data/biomes";
import { STREAM } from "../../src/data/streaming";
import { WORLD } from "../../src/data/world";
import { chunkOrigin, chunksPerSide } from "../../src/sim/chunks";
import { biomeAt, biomeWeights, heightAt, regionAt, sampleTerrain, terrainCell } from "../../src/sim/terrain";
import { buildWorldModel, generateSites } from "../../src/sim/worldgen";

const model = buildWorldModel(WORLD);
const half = WORLD.size / 2;

describe("world height function", () => {
  it("is a whole number of chunks across", () => {
    expect(chunksPerSide(WORLD) * WORLD.chunkSize).toBe(WORLD.size);
    expect(chunkOrigin(WORLD, 0)).toBe(-half);
  });

  it("is deterministic", () => {
    const again = buildWorldModel(WORLD);
    for (const [x, z] of [[0, 0], [-1234.5, 987.25], [3100, -2900], [-3900, 3900]] as const) {
      expect(heightAt(again, x, z)).toBe(heightAt(model, x, z));
    }
  });

  it("is continuous everywhere, including across chunk borders and biome borders", () => {
    // Walk long lines in small steps: no step may jump more than a steep slope allows.
    const step = 0.5;
    let worst = 0;
    for (const [x0, z0, dx, dz] of [[-half + 1, 37, 1, 0], [411, -half + 1, 0, 1], [-half + 1, -half + 1, 0.7071, 0.7071], [-half + 1, 2600, 1, 0]] as const) {
      let prev = heightAt(model, x0, z0);
      for (let d = step; d < WORLD.size - 2; d += step) {
        const h = heightAt(model, x0 + dx * d, z0 + dz * d);
        worst = Math.max(worst, Math.abs(h - prev));
        prev = h;
      }
    }
    expect(worst).toBeLessThan(step * 3.5);
  });

  it("gives the same height on a chunk border whichever chunk asks", () => {
    // Both chunks compute their edge vertices from world coordinates.
    const border = chunkOrigin(WORLD, 17);
    const fromLeft = chunkOrigin(WORLD, 16) + WORLD.chunkCells * (WORLD.chunkSize / WORLD.chunkCells);
    expect(fromLeft).toBe(border);
    expect(heightAt(model, fromLeft, 123)).toBe(heightAt(model, border, 123));
  });

  it("walls the world in with mountains", () => {
    for (const [x, z] of [[half - 5, 0], [-half + 5, 1500], [300, half - 5], [-2000, -half + 5]] as const) {
      expect(heightAt(model, x, z)).toBeGreaterThan(heightAt(model, x * 0.8, z * 0.8) + 150);
    }
  });

  it("levels the ground inside every site", () => {
    const cell = terrainCell(WORLD);
    for (const site of model.sites) {
      // The shape is exactly level out to the radius...
      for (const [dx, dz] of [[0, 0], [site.radius * 0.99, 0], [0, -site.radius * 0.99], [-site.radius * 0.7, site.radius * 0.7]] as const) {
        expect(sampleTerrain(model, site.x + dx, site.z + dz, new Float32Array(4)), site.id).toBeCloseTo(site.level, 6);
      }
      // ...and so is the ground, wherever every corner of the grid cell is inside it.
      const inner = site.radius - cell * 1.5;
      for (const [dx, dz] of [[0, 0], [inner, 0], [0, -inner], [-inner * 0.7, inner * 0.7]] as const) {
        expect(heightAt(model, site.x + dx, site.z + dz), site.id).toBeCloseTo(site.level, 6);
      }
    }
  });

  it("the ground is the shape sampled on the terrain grid", () => {
    const cell = terrainCell(WORLD);
    const w = new Float32Array(4);
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      // On a grid point the two agree exactly; between points they stay close.
      const gx = -half + cell * (37 + i * 29);
      const gz = -half + cell * (11 + ((i * 53) % 1100));
      expect(heightAt(model, gx, gz)).toBeCloseTo(sampleTerrain(model, gx, gz, w), 6);
      worst = Math.max(worst, Math.abs(heightAt(model, gx + cell / 2, gz + cell / 2) - sampleTerrain(model, gx + cell / 2, gz + cell / 2, w)));
    }
    expect(worst).toBeLessThan(4);
  });
});

describe("biomes", () => {
  it("there are at least four, each with its own look", () => {
    expect(BIOME_IDS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(BIOME_IDS.map((id) => BIOMES[id].colors.mid.join())).size).toBe(BIOME_IDS.length);
    // Every biome is used by some region.
    expect(new Set(WORLD.regions.map((r) => r.biome)).size).toBe(BIOME_IDS.length);
  });

  it("weights sum to one and a region's centre is purely its own biome", () => {
    for (const r of WORLD.regions) {
      const w = biomeWeights(WORLD, r.x, r.z);
      expect([...w].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      expect(w[BIOME_IDS.indexOf(r.biome)]).toBeCloseTo(1, 5);
      expect(regionAt(WORLD, r.x, r.z).id).toBe(r.id);
      expect(biomeAt(WORLD, r.x, r.z).id).toBe(r.biome);
    }
  });

  it("blend smoothly between regions rather than switching", () => {
    // From the basin at the centre to the salt flats in the north.
    let prev = biomeWeights(WORLD, 0, 0);
    let mixed = 0;
    for (let z = 2; z <= 2700; z += 2) {
      const w = biomeWeights(WORLD, 100, z);
      for (let b = 0; b < w.length; b++) expect(Math.abs(w[b]! - prev[b]!)).toBeLessThan(0.05);
      if (Math.max(...w) < 0.9) mixed++;
      prev = w;
    }
    expect(mixed).toBeGreaterThan(20);
  });

  it("fog always ends inside the streamed terrain", () => {
    const loaded = (STREAM.view[0]! - 0.5) * WORLD.chunkSize;
    for (const id of BIOME_IDS) expect(BIOMES[id].fog.end, id).toBeLessThan(loaded);
  });
});

describe("site placement", () => {
  it("is deterministic for a seed and changes with it", () => {
    expect(generateSites(WORLD)).toEqual(generateSites(WORLD));
    const other = generateSites({ ...WORLD, seed: WORLD.seed + 1 });
    expect(other.map((s) => [s.x, s.z])).not.toEqual(generateSites(WORLD).map((s) => [s.x, s.z]));
  });

  it("places everything the rules ask for, with unique ids and names", () => {
    const wanted = WORLD.placement.reduce((n, r) => n + r.count, 0);
    expect(generateSites(WORLD).length).toBe(wanted);
    expect(new Set(model.sites.map((s) => s.id)).size).toBe(model.sites.length);
    expect(new Set(model.sites.map((s) => s.name)).size).toBe(model.sites.length);
    expect(model.sites.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps generated sites apart, in the right biome and off the rim", () => {
    const generated = model.sites.filter((s) => s.generated);
    for (const site of generated) {
      const rule = WORLD.placement.find((r) => r.names.includes(site.name))!;
      expect(rule.biomes, site.name).toContain(biomeAt(WORLD, site.x, site.z).id);
      expect(Math.max(Math.abs(site.x), Math.abs(site.z))).toBeLessThan(half - WORLD.rim.width);
      for (const other of model.sites) {
        if (other !== site) expect(Math.hypot(other.x - site.x, other.z - site.z), `${site.name} / ${other.name}`).toBeGreaterThanOrEqual(WORLD.siteSpacing);
      }
    }
  });

  it("hand-placed sites sit inside the playable area and name real things", () => {
    const limit = half - WORLD.edgeMargin;
    for (const site of WORLD.sites) expect(Math.max(Math.abs(site.x), Math.abs(site.z)) + site.radius * 2, site.id).toBeLessThan(limit - 200);
    expect(model.siteById.get(WORLD.homeBase)?.held).toBe(true);
    expect(model.siteById.get(WORLD.missionOutpost)?.garrison).toBeDefined();
    // The edge the player is held to is high on the rim, so the drop beyond is hidden.
    expect(WORLD.edgeMargin).toBeLessThan(WORLD.rim.width);
  });

  it("covers every biome with places to find", () => {
    expect(new Set(model.sites.map((s) => biomeAt(WORLD, s.x, s.z).id)).size).toBe(BIOME_IDS.length);
    expect(model.sites.filter((s) => s.kind === "base").length).toBeGreaterThanOrEqual(3);
  });
});
