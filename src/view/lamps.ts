import { Color3, Engine, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, VertexBuffer } from "../babylon";
import { LIGHTS } from "../data/lights";
import { noShadow } from "./graphics";

interface LampKit {
  lens: StandardMaterial;
  glow: StandardMaterial;
  beam: StandardMaterial;
  /** The beam's cone and a lamp's flare, cloned (sharing their geometry) for every mech. */
  cone: Mesh;
  flare: Mesh;
}

const kits = new WeakMap<Scene, LampKit>();

/** Materials and the beam shape, shared by every mech in the scene. */
function lampKit(scene: Scene): LampKit {
  let kit = kits.get(scene);
  if (kit) return kit;
  const [r, g, b] = LIGHTS.color;
  const lens = new StandardMaterial("lampLens", scene);
  lens.diffuseColor = new Color3(0.12, 0.12, 0.11);
  lens.specularColor = new Color3(0.6, 0.6, 0.6);
  lens.specularPower = 80;
  const glow = new StandardMaterial("lampGlow", scene);
  glow.disableLighting = true;
  glow.emissiveColor = new Color3(r, g, b);
  glow.diffuseColor = Color3.Black();
  // A lamp in the dark is seen from much further than the mech it is on.
  glow.fogEnabled = false;
  // Beams and flares add light (unlit, so only the emissive colour shows); their vertex alpha fades them out.
  const beam = new StandardMaterial("lampBeam", scene);
  beam.disableLighting = true;
  beam.diffuseColor = Color3.Black();
  beam.emissiveColor = new Color3(r, g, b);
  beam.specularColor = Color3.Black();
  beam.backFaceCulling = false;
  beam.disableDepthWrite = true;
  beam.alphaMode = Engine.ALPHA_ADD;
  beam.fogEnabled = false;

  // A cone along +Z with its tip at the origin, bright at the tip and fading to nothing.
  const { length, radius, strength } = LIGHTS.beam;
  const cone = MeshBuilder.CreateCylinder("lampBeam", { height: length, diameterTop: 0, diameterBottom: radius * 2, tessellation: 18, cap: Mesh.NO_CAP }, scene);
  const positions = cone.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const toTip = (positions[i + 1]! + length / 2) / length;
    colors.push(1, 1, 1, strength * toTip);
  }
  cone.setVerticesData(VertexBuffer.ColorKind, colors);
  cone.hasVertexAlpha = true;
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = length / 2;
  cone.bakeCurrentTransformIntoVertices();
  cone.material = beam;
  cone.isPickable = false;
  cone.setEnabled(false);

  // A soft disc that always faces the camera, so a lamp reads from far off in the dark.
  const flare = MeshBuilder.CreateDisc("lampFlare", { radius: LIGHTS.flare.radius, tessellation: 16 }, scene);
  const disc = flare.getVerticesData(VertexBuffer.PositionKind)!;
  const flareColors: number[] = [];
  for (let i = 0; i < disc.length; i += 3) {
    const edge = Math.hypot(disc[i]!, disc[i + 1]!) / LIGHTS.flare.radius;
    flareColors.push(1, 1, 1, LIGHTS.flare.strength * (1 - Math.min(1, edge)));
  }
  flare.setVerticesData(VertexBuffer.ColorKind, flareColors);
  flare.hasVertexAlpha = true;
  flare.material = beam;
  flare.isPickable = false;
  flare.setEnabled(false);
  kit = { lens, glow, beam, cone, flare };
  kits.set(scene, kit);
  return kit;
}

/**
 * A pair of lamps either side of the canopy, with a soft beam ahead. They pitch with the aim.
 * Switched off they are dark lenses; switching them on only shows meshes, so no shader compiles.
 */
export class MechLamps {
  readonly pivot: TransformNode;
  private readonly lit: Mesh[] = [];
  private on = true;

  /** `parent` is the torso's cockpit point; `bulk` and `depth` are the torso's proportions. */
  constructor(scene: Scene, parent: TransformNode, bulk: number, depth: number) {
    const kit = lampKit(scene);
    this.pivot = new TransformNode("lamps", scene);
    this.pivot.parent = parent;
    // The chest's front face, beside the canopy (see ProceduralTorso).
    this.pivot.position.set(0, -0.12, 0.675 * depth + 0.04 - 0.95 * depth);
    for (const side of [-1, 1]) {
      const x = side * Math.min(0.95 * bulk - 0.12, 0.62);
      const lens = MeshBuilder.CreateBox("lampLens", { width: 0.3, height: 0.2, depth: 0.08 }, scene);
      lens.parent = this.pivot;
      lens.position.set(x, 0, 0);
      lens.material = kit.lens;
      lens.isPickable = false;
      const glow = MeshBuilder.CreatePlane("lampGlow", { width: 0.26, height: 0.16 }, scene);
      glow.parent = this.pivot;
      glow.position.set(x, 0, 0.045);
      glow.rotation.y = Math.PI;
      glow.material = kit.glow;
      glow.isPickable = false;
      noShadow(glow);
      const flare = kit.flare.clone("lampFlare", this.pivot);
      flare.hasVertexAlpha = true;
      flare.position.set(x, 0, 0.12);
      flare.billboardMode = Mesh.BILLBOARDMODE_ALL;
      noShadow(flare);
      this.lit.push(glow, flare);
    }
    const beam = kit.cone.clone("lampBeam", this.pivot);
    beam.hasVertexAlpha = true;
    beam.position.set(0, 0, 0.1);
    beam.rotation.x = LIGHTS.beam.dip;
    noShadow(beam);
    this.lit.push(beam);
    this.set(false);
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const m of this.lit) m.setEnabled(on);
  }

  /** Pitch the lamps with the aim (radians, positive up). */
  pitch(p: number): void {
    this.pivot.rotation.x = -p * LIGHTS.headlight.followPitch;
  }
}
