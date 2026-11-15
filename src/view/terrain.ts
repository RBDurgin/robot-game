import {
  Color3,
  Mesh,
  MeshBuilder,
  PhysicsShapeType,
  Scene,
  StandardMaterial,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { FlatArea, ZoneDef } from "../data/zone";
import { addStaticCollider } from "../game/physics";
import { clamp, lerp, makeRng } from "../sim/math";
import { heightAt } from "../sim/terrain";

const SUBDIVISIONS = 150;

const LOW = [0.33, 0.37, 0.25] as const; // scrub
const MID = [0.5, 0.44, 0.33] as const; // dry earth
const HIGH = [0.56, 0.55, 0.54] as const; // rock

function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)];
}

/** Builds the terrain mesh from the zone's height function and gives it a static collider. */
export function buildTerrain(scene: Scene, zone: ZoneDef): Mesh {
  const ground = MeshBuilder.CreateGround(
    "terrain",
    { width: zone.size, height: zone.size, subdivisions: SUBDIVISIONS, updatable: true },
    scene,
  );
  const positions = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = new Float32Array((positions.length / 3) * 4);
  for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
    const h = heightAt(zone, positions[i]!, positions[i + 2]!);
    positions[i + 1] = h;
    const t = clamp(h / zone.relief, 0, 1.4);
    const rgb = t < 0.5 ? mix(LOW, MID, t / 0.5) : mix(MID, HIGH, clamp((t - 0.5) / 0.5, 0, 1));
    colors[c] = rgb[0];
    colors[c + 1] = rgb[1];
    colors[c + 2] = rgb[2];
    colors[c + 3] = 1;
  }
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.setVerticesData(VertexBuffer.ColorKind, colors);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, ground.getIndices(), normals);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.convertToFlatShadedMesh();
  ground.refreshBoundingInfo();

  const mat = new StandardMaterial("terrainMat", scene);
  mat.specularColor = Color3.Black();
  ground.material = mat;
  ground.isPickable = false;

  addStaticCollider(scene, ground, PhysicsShapeType.MESH, 0.9);
  return ground;
}

function solidMaterial(scene: Scene, name: string, r: number, g: number, b: number): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = new Color3(r, g, b);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  return mat;
}

interface BlockSpec {
  x: number;
  z: number;
  /** Height of the block's base above the ground. */
  lift?: number;
  size: [number, number, number];
  rotY?: number;
  tilt?: number;
}

/** Static box with a collider, sitting on the terrain. */
function placeBlock(scene: Scene, zone: ZoneDef, name: string, spec: BlockSpec, mat: StandardMaterial): Mesh {
  const [w, h, d] = spec.size;
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.set(spec.x, heightAt(zone, spec.x, spec.z) + (spec.lift ?? 0) + h / 2, spec.z);
  m.rotation.y = spec.rotY ?? 0;
  m.rotation.z = spec.tilt ?? 0;
  m.material = mat;
  m.isPickable = false;
  addStaticCollider(scene, m, PhysicsShapeType.BOX);
  return m;
}

/** The player's home: a landing pad and an open-fronted hangar. */
function buildBase(scene: Scene, zone: ZoneDef, area: FlatArea): void {
  const wall = solidMaterial(scene, "baseWall", 0.42, 0.45, 0.48);
  const trim = solidMaterial(scene, "baseTrim", 0.79, 0.47, 0.17);
  const { x, z } = area;
  placeBlock(scene, zone, "pad", { x, z, size: [26, 0.4, 26] }, solidMaterial(scene, "pad", 0.25, 0.26, 0.28));
  // Hangar sits behind the pad, open toward +Z (the direction of the outpost).
  const hz = z - 30;
  placeBlock(scene, zone, "hangarBack", { x, z: hz - 9, size: [24, 11, 1.2] }, wall);
  placeBlock(scene, zone, "hangarLeft", { x: x - 12, z: hz, size: [1.2, 11, 18] }, wall);
  placeBlock(scene, zone, "hangarRight", { x: x + 12, z: hz, size: [1.2, 11, 18] }, wall);
  placeBlock(scene, zone, "hangarRoof", { x, z: hz, lift: 11, size: [26, 1, 20] }, trim);
  placeBlock(scene, zone, "beaconMast", { x: x - 20, z: z - 6, size: [1, 16, 1] }, trim);
}

/** The enemy outpost: a walled compound with gaps, two towers and a central bunker. */
function buildOutpost(scene: Scene, zone: ZoneDef, area: FlatArea): void {
  const wall = solidMaterial(scene, "outpostWall", 0.3, 0.29, 0.3);
  const dark = solidMaterial(scene, "outpostDark", 0.48, 0.14, 0.18);
  const { x, z } = area;
  const half = 34;
  const segs: BlockSpec[] = [
    // South wall with a central gate gap.
    { x: x - 22, z: z - half, size: [24, 7, 2] },
    { x: x + 22, z: z - half, size: [24, 7, 2] },
    // North wall.
    { x, z: z + half, size: [68, 7, 2] },
    // West wall with a gap, east wall solid.
    { x: x - half, z: z - 18, size: [2, 7, 30] },
    { x: x - half, z: z + 22, size: [2, 7, 24] },
    { x: x + half, z, size: [2, 7, 68] },
  ];
  segs.forEach((s, i) => placeBlock(scene, zone, `outpostWall${i}`, s, wall));
  placeBlock(scene, zone, "towerA", { x: x - half, z: z - half, size: [6, 16, 6] }, dark);
  placeBlock(scene, zone, "towerB", { x: x + half, z: z + half, size: [6, 16, 6] }, dark);
  placeBlock(scene, zone, "bunker", { x, z: z + 8, size: [18, 6, 14] }, dark);
  placeBlock(scene, zone, "bunkerTop", { x, z: z + 8, lift: 6, size: [8, 3, 6] }, wall);
  placeBlock(scene, zone, "crateA", { x: x - 14, z: z - 12, size: [5, 4, 5], rotY: 0.4 }, wall);
  placeBlock(scene, zone, "crateB", { x: x + 16, z: z - 16, size: [6, 5, 4], rotY: -0.3 }, wall);
}

/** Scattered hull plates and girders from an old battle; mid-field cover. */
function buildWrecks(scene: Scene, zone: ZoneDef, area: FlatArea): void {
  const rust = solidMaterial(scene, "rust", 0.36, 0.24, 0.18);
  const rng = makeRng(zone.seed + 99);
  for (let i = 0; i < 9; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * area.radius * 0.85;
    placeBlock(
      scene,
      zone,
      `wreck${i}`,
      {
        x: area.x + Math.cos(angle) * dist,
        z: area.z + Math.sin(angle) * dist,
        lift: -1,
        size: [4 + rng() * 9, 3 + rng() * 6, 1.5 + rng() * 3],
        rotY: rng() * Math.PI,
        tilt: (rng() - 0.5) * 0.7,
      },
      rust,
    );
  }
}

function buildRocks(scene: Scene, zone: ZoneDef): void {
  const rock = solidMaterial(scene, "rock", 0.44, 0.42, 0.4);
  const rng = makeRng(zone.seed + 5);
  const half = zone.size / 2 - 60;
  const keepClear = [zone.playerBase, zone.enemyOutpost];
  let placed = 0;
  for (let attempt = 0; attempt < zone.rockCount * 4 && placed < zone.rockCount; attempt++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    const s = 2 + rng() * 6;
    const spec: BlockSpec = {
      x,
      z,
      lift: -s * 0.3,
      size: [s * (0.8 + rng() * 0.8), s, s * (0.8 + rng() * 0.8)],
      rotY: rng() * Math.PI,
      tilt: (rng() - 0.5) * 0.5,
    };
    if (keepClear.some((a) => Math.hypot(x - a.x, z - a.z) < a.radius + 8)) continue;
    placeBlock(scene, zone, `rock${placed}`, spec, rock);
    placed++;
  }
}

export function buildStructures(scene: Scene, zone: ZoneDef): void {
  buildBase(scene, zone, zone.playerBase);
  buildOutpost(scene, zone, zone.enemyOutpost);
  buildWrecks(scene, zone, zone.wreckField);
  buildRocks(scene, zone);
}
