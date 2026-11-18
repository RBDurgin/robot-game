import { AbstractMesh, AnimationGroup, AssetContainer, LoadAssetContainerAsync, Node, Scene, TransformNode } from "@babylonjs/core";
import { FACTIONS } from "../../data/factions";
import { instantiate, prototypeFor } from "./modelPrototypes";
import { getPartMaterials, type PartMaterials } from "./proceduralParts";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { MODELS, WEAPON_MODELS, type ModelEntry } from "../../data/models";
import type { AttachmentName, PartPose, PartVisual } from "./PartVisual";

registerBuiltInLoaders();

/** `?procedural` in the URL draws every part procedurally, for before-and-after comparisons. */
export const modelsEnabled = typeof location === "undefined" || !new URLSearchParams(location.search).has("procedural");

/** Where model files are served from (Vite serves `public/` at the root). */
const MODEL_BASE = `${import.meta.env.BASE_URL}models/`;

const containers = new WeakMap<Scene, Map<string, Promise<AssetContainer | null>>>();
const warned = new Set<string>();

/**
 * Load a model file once per scene; every part that uses it is instantiated from the same
 * container and shares its geometry. Resolves to null (once warned) if the file is missing or bad.
 */
export function loadModel(scene: Scene, file: string): Promise<AssetContainer | null> {
  let perScene = containers.get(scene);
  if (!perScene) {
    perScene = new Map();
    containers.set(scene, perScene);
  }
  let pending = perScene.get(file);
  if (!pending) {
    pending = LoadAssetContainerAsync(MODEL_BASE + file, scene).then(dropFactionMaterials).catch((err: unknown) => {
      if (!warned.has(file)) {
        warned.add(file);
        console.warn(`Model ${file} did not load; using the procedural part instead.`, err);
      }
      return null;
    });
    perScene.set(file, pending);
  }
  return pending;
}

/** Model materials with these names are replaced by the owning faction's. */
const FACTION_SLOTS = new Set(["primary", "secondary", "accent", "metal", "dark"]);

/**
 * A model's own stand-ins for the faction materials are never drawn: each mesh remembers which
 * slot it uses (in its metadata, which instances share) and the stand-ins are thrown away.
 */
function dropFactionMaterials(container: AssetContainer): AssetContainer {
  for (const mesh of container.meshes) {
    const name = mesh.material?.name;
    if (name && FACTION_SLOTS.has(name)) {
      mesh.metadata = { ...(mesh.metadata as object | null), partMaterial: name };
      mesh.material = null;
    }
  }
  for (const mat of container.materials.filter((m) => FACTION_SLOTS.has(m.name))) {
    container.materials.splice(container.materials.indexOf(mat), 1);
    mat.dispose();
  }
  return container;
}

/**
 * Load every model the manifest names, build its copy in every faction's colours, and compile
 * the materials they are drawn with. All of it happens behind the start screen, so a squad
 * waking up later only copies nodes.
 */
export async function preloadModels(scene: Scene): Promise<void> {
  if (!modelsEnabled) return;
  const entries = [...Object.values(MODELS).flatMap((parts) => Object.values(parts ?? {})), ...Object.values(WEAPON_MODELS)];
  const files = [...new Set(entries.map((e) => e!.file))];
  const containers = await Promise.all(files.map((file) => loadModel(scene, file)));
  const samples = new Map<string, AbstractMesh>();
  for (const faction of Object.values(FACTIONS)) {
    const mats = getPartMaterials(scene, faction.colors);
    files.forEach((file, i) => {
      const container = containers[i];
      if (!container) return;
      for (const mesh of prototypeFor(scene, file, container, mats).drawn) {
        if (mesh.material && !samples.has(mesh.material.name)) samples.set(mesh.material.name, mesh);
      }
    });
  }
  await Promise.all([...samples.values()].map((mesh) => mesh.material!.forceCompilationAsync(mesh)));
}

/** Name prefixes for the model nodes the game looks for. */
const ATTACH = "att.";
const JOINT = "joint.";
const POSE_CLIP = "pose.";

/** Pose channels an authored clip can be driven by (`pose.<channel>`), each mapped to 0..1. */
const CLIP_CHANNELS: Record<string, (pose: PartPose) => number | undefined> = {
  walkPhase: (p) => (p.walkPhase === undefined ? undefined : (((p.walkPhase / (Math.PI * 2)) % 1) + 1) % 1),
  stride: (p) => p.stride,
  airborne: (p) => p.airborne,
  pitch: (p) => (p.pitch === undefined ? undefined : p.pitch / Math.PI + 0.5),
  recoil: (p) => p.recoil,
  thrust: (p) => p.thrust,
  crouch: (p) => p.crouch,
};

/**
 * A part drawn from an imported glTF model, with the procedural part as its rig.
 *
 * The procedural `fallback` is built first and stands in until the model has loaded, or for good
 * if it fails to. Once the model is in:
 * - a model node named `joint.<name>` follows the procedural node of that name (a hip, a knee,
 *   an arm pivot), so the procedural animation moves the model's pieces;
 * - a node named `att.<name>` replaces that attachment point; attachments the model lacks stay
 *   on the procedural rig. Attachment nodes are owned by this part and only reparented, so
 *   whatever hangs from them (a head, an arm, a weapon) moves across without noticing;
 * - a clip named `pose.<channel>` is not played but scrubbed by that pose channel (0 to 1
 *   over the clip), so authored motion follows the same inputs as procedural motion;
 *   other clips are one-shots for `playClip`;
 * - the procedural meshes are hidden, except those named in the entry's `keep`.
 */
export class GltfPartVisual implements PartVisual {
  readonly root: TransformNode;
  /** Resolves once the model is showing, or the fallback is staying. */
  readonly ready: Promise<void>;
  private readonly rig: PartVisual;
  /**
   * The procedural part's own nodes, taken before anything is attached: other parts later hang
   * below it (the whole mech hangs from the legs) and must not be mistaken for its own.
   */
  private readonly rigNodes: Map<string, Node>;
  /** Every one of the procedural part's meshes (names repeat: both legs have a "thigh"). */
  private readonly rigMeshes: AbstractMesh[];
  private installed = false;
  private readonly proxies = new Map<AttachmentName, TransformNode>();
  private modelNodes = new Map<string, Node>();
  private clips: AnimationGroup[] = [];
  private driven: { clip: AnimationGroup; channel: (pose: PartPose) => number | undefined }[] = [];
  private mirror = 1;
  private disposed = false;

  constructor(
    scene: Scene,
    name: string,
    private readonly entry: ModelEntry,
    fallback: PartVisual,
    /** The owning faction's materials: their colours go into the model's vertices. */
    private readonly materials: PartMaterials,
  ) {
    this.root = new TransformNode(name, scene);
    this.rig = fallback;
    this.rigNodes = new Map(fallback.root.getDescendants(false).map((n) => [n.name, n] as const));
    this.rigMeshes = fallback.root.getChildMeshes(false);
    fallback.root.parent = this.root;
    this.ready = loadModel(scene, entry.file).then((container) => {
      if (container && !this.disposed) this.install(container);
    });
  }

  /** True once the imported model has replaced the stand-in. */
  get loaded(): boolean {
    return this.installed;
  }

  attachment(name: AttachmentName): TransformNode | null {
    let proxy = this.proxies.get(name);
    if (proxy) return proxy;
    const source = this.rig.attachment(name);
    if (!source) return null;
    proxy = new TransformNode(name, this.root.getScene());
    proxy.parent = source;
    this.proxies.set(name, proxy);
    if (this.installed) this.moveToModel(name, proxy);
    return proxy;
  }

  setPose(pose: PartPose): void {
    this.rig.setPose(pose);
    for (const { clip, channel } of this.driven) {
      const value = channel(pose);
      if (value === undefined) continue;
      const t = Math.min(1, Math.max(0, value));
      clip.goToFrame(clip.from + (clip.to - clip.from) * t);
    }
  }

  playClip(name: string): void {
    const clip = this.clips.find((c) => c.name === name);
    if (clip) clip.start(false, 1, clip.from, clip.to);
    else this.rig.playClip(name);
  }

  dispose(): void {
    this.disposed = true;
    for (const clip of this.clips) clip.dispose();
    this.root.dispose(false, false);
  }

  private install(container: AssetContainer): void {
    const scene = this.root.getScene();
    const copy = instantiate(prototypeFor(scene, this.entry.file, container, this.materials));
    const model = copy.root;
    model.parent = this.root;
    model.computeWorldMatrix(true);
    this.root.computeWorldMatrix(true);
    // Glb files sit under a root that mirrors X (glTF is right-handed); undo it where needed.
    this.mirror = Math.sign(model.getWorldMatrix().determinant() * this.root.getWorldMatrix().determinant()) || 1;
    for (const node of model.getDescendants(false)) this.modelNodes.set(node.name, node);

    // Joints: hang each from the procedural node of the same name, in a mirror so its own
    // (glTF-space) contents come out the right way round.
    for (const [name, node] of this.modelNodes) {
      // The loader splits a node with several materials into `<name>_primitiveN` children.
      if (!name.startsWith(JOINT) || /_primitive\d+$/.test(name) || !(node instanceof TransformNode)) continue;
      const target = this.rigNodes.get(name.slice(JOINT.length));
      if (!(target instanceof TransformNode)) {
        console.warn(`Model ${this.entry.file}: no procedural joint for ${name}.`);
        continue;
      }
      const mirror = new TransformNode(`${name}-mirror`, scene);
      mirror.parent = target;
      mirror.scaling.x = this.mirror;
      node.parent = mirror;
      node.position.setAll(0);
      node.rotationQuaternion = null;
      node.rotation.setAll(0);
    }

    // Clips: those named after a pose channel are scrubbed by it; the rest wait for playClip.
    this.clips = copy.clips;
    for (const clip of this.clips) {
      clip.stop();
      if (!clip.name.startsWith(POSE_CLIP)) continue;
      const channel = CLIP_CHANNELS[clip.name.slice(POSE_CLIP.length)];
      if (!channel) {
        console.warn(`Model ${this.entry.file}: clip ${clip.name} names no pose channel.`);
        continue;
      }
      clip.start(true, 0, clip.from, clip.to);
      clip.pause();
      this.driven.push({ clip, channel });
    }

    for (const [name, proxy] of this.proxies) this.moveToModel(name, proxy);
    const keep = new Set(this.entry.keep ?? []);
    // The procedural meshes are not needed once the model is in; their nodes stay as the rig.
    for (const mesh of this.rigMeshes) if (!keep.has(mesh.name)) mesh.dispose(true);
    this.installed = true;
  }

  /** Put an attachment on the model's point of that name, if it has one. */
  private moveToModel(name: AttachmentName, proxy: TransformNode): void {
    const target = this.modelNodes.get(ATTACH + name);
    if (!(target instanceof TransformNode)) return;
    proxy.parent = target;
    proxy.scaling.x = this.mirror;
  }
}
