import { Color3, Color4, Mesh, MeshBuilder, PhysicsAggregate, PhysicsShapeType, Scene, StandardMaterial } from "@babylonjs/core";
import { SITE_MATERIALS, siteBlocks, type SiteMaterial } from "../data/siteLayouts";
import { addStaticCollider } from "../game/physics";
import type { ScatterItem } from "../sim/chunks";
import type { Site } from "../sim/terrain";

/** Something streamed in that must be removed again. */
export interface Disposable {
  dispose(): void;
}

/** Shared materials for structures, created once so streaming a site in never makes new ones. */
export class StructureMaterials {
  private readonly bySite = new Map<SiteMaterial, StandardMaterial>();
  /** White material for meshes that carry their colour per vertex. */
  readonly vertexColored: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.vertexColored = new StandardMaterial("scatter", scene);
    this.vertexColored.specularColor = new Color3(0.05, 0.05, 0.05);
  }

  site(key: SiteMaterial): StandardMaterial {
    let mat = this.bySite.get(key);
    if (!mat) {
      const [r, g, b] = SITE_MATERIALS[key];
      mat = new StandardMaterial(key, this.scene);
      mat.diffuseColor = new Color3(r, g, b);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      this.bySite.set(key, mat);
    }
    return mat;
  }
}

/** Build the blocks that stand on a site, each with a box collider. */
export function buildSite(scene: Scene, site: Site, materials: StructureMaterials): Disposable {
  const built: { mesh: Mesh; collider: PhysicsAggregate }[] = [];
  siteBlocks(site).forEach((spec, i) => {
    const [w, h, d] = spec.size;
    const mesh = MeshBuilder.CreateBox(`${site.id} ${i}`, { width: w, height: h, depth: d }, scene);
    mesh.position.set(site.x + spec.dx, site.level + (spec.lift ?? 0) + h / 2, site.z + spec.dz);
    mesh.rotation.y = spec.rotY ?? 0;
    mesh.rotation.z = spec.tilt ?? 0;
    mesh.material = materials.site(spec.material);
    mesh.isPickable = false;
    mesh.computeWorldMatrix(true);
    const collider = addStaticCollider(scene, mesh, PhysicsShapeType.BOX);
    mesh.freezeWorldMatrix();
    built.push({ mesh, collider });
  });
  return {
    dispose: () => {
      for (const b of built) {
        b.collider.dispose();
        b.mesh.dispose();
      }
    },
  };
}

/** Build a chunk's rocks, slabs and pillars as one mesh with one collider. */
export function buildScatter(scene: Scene, name: string, items: ScatterItem[], materials: StructureMaterials): Disposable | null {
  if (items.length === 0) return null;
  const boxes = items.map((item) => {
    const [w, h, d] = item.size;
    const [r, g, b] = item.color;
    const color = new Color4(r, g, b, 1);
    const box = MeshBuilder.CreateBox("s", { width: w, height: h, depth: d, faceColors: [color, color, color, color, color, color] }, scene);
    box.position.set(item.x, item.y, item.z);
    box.rotation.y = item.rotY;
    box.rotation.z = item.tilt;
    return box;
  });
  const mesh = Mesh.MergeMeshes(boxes, true, true);
  if (!mesh) return null;
  mesh.name = name;
  mesh.material = materials.vertexColored;
  mesh.isPickable = false;
  const collider = addStaticCollider(scene, mesh, PhysicsShapeType.MESH);
  mesh.freezeWorldMatrix();
  return {
    dispose: () => {
      collider.dispose();
      mesh.dispose();
    },
  };
}
