import { AbstractMesh, AnimationGroup, AssetContainer, Color3, Mesh, Node, Scene, TransformNode, VertexData } from "@babylonjs/core";
import { getPaletteMaterials, type PartMaterials } from "./proceduralParts";

/**
 * A model made ready for one faction's colours: each node's pieces merged into at most three
 * meshes (painted armour, bare metal, glowing accents), with the colours in the vertices.
 * Every mech of that faction copies it, sharing its geometry. A model straight from the file has
 * one mesh per material per node, which doubled the draw calls of a mech.
 */
export interface Prototype {
  root: TransformNode;
  /** Templates for the model's clips, aimed at the prototype's nodes. */
  clips: AnimationGroup[];
  /** The merged meshes: the only ones a mech gets a mesh copy of. */
  drawn: Set<Mesh>;
}

/** Which merged mesh each faction material slot goes into. */
const GROUP: Record<string, "paint" | "bare" | "accent"> = {
  primary: "paint",
  secondary: "paint",
  metal: "bare",
  dark: "bare",
  accent: "accent",
};

const PRIMITIVE = /_primitive\d+$/;

const cache = new WeakMap<Scene, Map<string, Prototype>>();

/** The prototype of `file` in the colours of `mats`, built on first use. */
export function prototypeFor(scene: Scene, file: string, container: AssetContainer, mats: PartMaterials): Prototype {
  let perScene = cache.get(scene);
  if (!perScene) {
    perScene = new Map();
    cache.set(scene, perScene);
  }
  const key = `${file}|${mats.primary.name}`;
  let proto = perScene.get(key);
  if (!proto) {
    proto = build(scene, container, mats);
    perScene.set(key, proto);
  }
  return proto;
}

/**
 * Copy a prototype for one mech. Its merged meshes are copied, sharing the prototype's geometry;
 * every other node, including the loader's empty root and the joint holders, becomes a plain
 * transform node.
 */
export function instantiate(proto: Prototype): { root: TransformNode; clips: AnimationGroup[] } {
  const copies = new Map<Node, Node>();
  const copy = (source: TransformNode, parent: TransformNode | null): TransformNode => {
    let node: TransformNode;
    if (source instanceof Mesh && proto.drawn.has(source)) {
      // A copy sharing the prototype's geometry. Not an instance: hardware instances re-upload a
      // buffer per draw every frame, which cost about 20% more GPU time in a fight (2026-11-18).
      // Built by hand: Mesh.clone copies every property generically and was most of a wake's cost.
      const mesh = new Mesh(source.name, source.getScene());
      source.geometry!.applyToMesh(mesh);
      mesh.material = source.material;
      mesh.sideOrientation = source.sideOrientation;
      mesh.receiveShadows = source.receiveShadows;
      mesh.isPickable = false;
      node = mesh;
    } else {
      node = new TransformNode(source.name, source.getScene());
    }
    node.position.copyFrom(source.position);
    node.rotation.copyFrom(source.rotation);
    node.rotationQuaternion = source.rotationQuaternion?.clone() ?? null;
    node.scaling.copyFrom(source.scaling);
    node.parent = parent;
    copies.set(source, node);
    for (const child of source.getChildren()) if (child instanceof TransformNode) copy(child, node);
    return node;
  };
  const root = copy(proto.root, null);
  const clips = proto.clips.map((clip) => clip.clone(clip.name, (target: Node) => copies.get(target) ?? target));
  return { root, clips };
}

function build(scene: Scene, container: AssetContainer, mats: PartMaterials): Prototype {
  const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const root = entries.rootNodes[0] as TransformNode;
  root.setEnabled(false);
  for (const clip of entries.animationGroups) clip.stop();

  const palette = getPaletteMaterials(scene);
  const colors: Record<string, Color3> = {
    primary: mats.primary.diffuseColor,
    secondary: mats.secondary.diffuseColor,
    metal: mats.metal.diffuseColor,
    dark: mats.dark.diffuseColor,
    accent: Color3.White(),
  };
  const slotOf = (mesh: AbstractMesh): string | undefined => (mesh.metadata as { partMaterial?: string } | null)?.partMaterial;

  const drawn = new Set<Mesh>();
  const owners = [root, ...root.getDescendants(false)].filter((n): n is TransformNode => n instanceof TransformNode && !PRIMITIVE.test(n.name));
  for (const owner of owners) {
    // A node's pieces: its own geometry if it has one primitive, or its `_primitiveN` children.
    const pieces: Mesh[] = [];
    if (owner instanceof Mesh && owner.getTotalVertices() > 0) pieces.push(owner);
    for (const child of owner.getChildren()) if (child instanceof Mesh && PRIMITIVE.test(child.name)) pieces.push(child);
    const groups = new Map<"paint" | "bare" | "accent", Mesh[]>();
    for (const piece of pieces) {
      const slot = slotOf(piece);
      const group = slot ? GROUP[slot] : undefined;
      if (!group) continue; // A material of the model's own: left as it is.
      groups.set(group, [...(groups.get(group) ?? []), piece]);
    }
    for (const [group, members] of groups) {
      const parts = members.map((piece) => {
        const data = VertexData.ExtractFromMesh(piece);
        const c = colors[slotOf(piece)!]!;
        const count = (data.positions?.length ?? 0) / 3;
        data.colors = Array.from({ length: count * 4 }, (_, i) => (i % 4 === 3 ? 1 : i % 4 === 0 ? c.r : i % 4 === 1 ? c.g : c.b));
        const part = new Mesh("piece", scene);
        data.applyToMesh(part);
        return part;
      });
      const merged = parts.length === 1 ? parts[0]! : Mesh.MergeMeshes(parts, true, true)!;
      merged.name = `${owner.name}.${group}`;
      // Keep the winding the loader set up for the file's geometry, or the faces turn inside out.
      merged.sideOrientation = members[0]!.sideOrientation;
      merged.parent = owner;
      merged.material = group === "paint" ? palette.paint : group === "bare" ? palette.bare : mats.accent;
      merged.isPickable = false;
      merged.receiveShadows = true;
      drawn.add(merged);
      for (const piece of members) {
        // The owner is a node other things hang from: keep it, without its own geometry showing.
        if (piece === owner) piece.isVisible = false;
        else piece.dispose();
      }
    }
  }
  // Out of the scene's lists: the scene walks every mesh it lists each frame, enabled or not, and
  // there is a prototype per model per faction. Instances draw from them all the same.
  for (const node of [root, ...root.getDescendants(false)]) {
    if (node instanceof AbstractMesh) scene.removeMesh(node);
    else if (node instanceof TransformNode) scene.removeTransformNode(node);
  }
  for (const clip of entries.animationGroups) scene.removeAnimationGroup(clip);
  return { root, clips: entries.animationGroups, drawn };
}
