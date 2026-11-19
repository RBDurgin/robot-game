import type { AdvancedDynamicTexture } from "@babylonjs/gui/2D";
import {
  AbstractMesh,
  Camera,
  FreeCamera,
  DefaultRenderingPipeline,
  DirectionalLight,
  GlowLayer,
  ImageProcessingConfiguration,
  Scene,
  ShadowGenerator,
  Vector3,
} from "../babylon";
import { QUALITY, type QualityDef, type QualityLevel } from "../data/quality";
import { setSurfaceDetail } from "./parts/proceduralParts";

/** Layer the HUD draws on, seen only by the overlay camera, so screen effects leave it alone. */
const UI_LAYER = 0x10000000;

/** Seconds between rebuilds of the list of shadow casters near the player. */
const CASTER_REFRESH = 0.25;

/** Mark a mesh as one that casts a sun shadow when near the player (structures, rocks). */
export function castsShadow(mesh: AbstractMesh): void {
  mesh.metadata = { ...(mesh.metadata as object | null), castsShadow: true };
}

/**
 * Lighting and screen effects that depend on the quality setting: sun shadows around the player,
 * post-processing, glow, and the mech surface detail. Each part can be switched off on its own.
 */
export class Graphics {
  private quality: QualityDef = QUALITY.low;
  private shadows: ShadowGenerator | null = null;
  private pipeline: DefaultRenderingPipeline | null = null;
  private glow: GlowLayer | null = null;
  private casterAge = Infinity;

  constructor(
    private readonly scene: Scene,
    private readonly sun: DirectionalLight,
    private readonly camera: Camera,
    hud: AdvancedDynamicTexture,
  ) {
    // The HUD is drawn by a second camera after the main one and its post-processing.
    const overlay = new FreeCamera("hudCamera", Vector3.Zero(), scene);
    overlay.layerMask = UI_LAYER;
    if (hud.layer) hud.layer.layerMask = UI_LAYER;
    scene.activeCameras = [camera, overlay];
    scene.cameraToUseForPointers = camera;
    // Shadows only ever cover the player's surroundings: the light's box is fitted to the casters.
    sun.autoUpdateExtends = true;
    sun.autoCalcShadowZBounds = true;
  }

  get level(): QualityDef {
    return this.quality;
  }

  apply(level: QualityLevel): void {
    const q = QUALITY[level];
    const before = this.quality;
    this.quality = q;
    if (q.surfaceDetail !== before.surfaceDetail) setSurfaceDetail(this.scene, q.surfaceDetail);

    if (q.shadowMap !== before.shadowMap) {
      this.shadows?.dispose();
      this.shadows = null;
      if (q.shadowMap > 0) {
        const gen = new ShadowGenerator(q.shadowMap, this.sun);
        gen.usePercentageCloserFiltering = true;
        gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
        gen.bias = 0.004;
        gen.normalBias = 0.02;
        gen.darkness = 0.35;
        gen.transparencyShadow = false;
        this.shadows = gen;
      }
      this.casterAge = Infinity;
      // Materials compiled without the shadow map must recompile with it, and the other way round.
      // Frozen ones (the terrain) are thawed for one frame to do so.
      const frozen = this.scene.materials.filter((m) => m.isFrozen);
      for (const m of frozen) m.unfreeze();
      this.scene.materials.forEach((m) => m.markDirty(true));
      this.scene.onAfterRenderObservable.addOnce(() => frozen.forEach((m) => m.freeze()));
    }

    if (q.post !== before.post) {
      this.pipeline?.dispose();
      this.pipeline = null;
      if (q.post) {
        const p = new DefaultRenderingPipeline("main", true, this.scene, [this.camera]);
        p.fxaaEnabled = true;
        p.bloomEnabled = true;
        p.bloomThreshold = 0.85;
        p.bloomWeight = 0.25;
        p.bloomKernel = 48;
        p.bloomScale = 0.5;
        p.imageProcessingEnabled = true;
        p.imageProcessing.toneMappingEnabled = true;
        p.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
        p.imageProcessing.exposure = 1.05;
        p.imageProcessing.contrast = 1.15;
        p.imageProcessing.vignetteEnabled = true;
        p.imageProcessing.vignetteWeight = 1.2;
        this.pipeline = p;
      }
    }

    if (q.glow !== before.glow) {
      this.glow?.dispose();
      this.glow = null;
      if (q.glow) {
        this.glow = new GlowLayer("glow", this.scene, { mainTextureRatio: 0.35, blurKernelSize: 24 });
        this.glow.intensity = 0.4;
      }
    }
  }

  /** Per frame: keep the shadow casters to what is near `focus`. */
  update(focus: Vector3, mechs: Iterable<{ visual: { root: { getChildMeshes(direct: boolean): AbstractMesh[] } } }>, dt: number): void {
    const gen = this.shadows;
    if (!gen) return;
    this.casterAge += dt;
    if (this.casterAge < CASTER_REFRESH) return;
    this.casterAge = 0;
    const range = this.quality.shadowRange;
    const list: AbstractMesh[] = [];
    const near = (mesh: AbstractMesh): boolean => {
      const c = mesh.getBoundingInfo().boundingSphere.centerWorld;
      return Math.hypot(c.x - focus.x, c.z - focus.z) < range + mesh.getBoundingInfo().boundingSphere.radiusWorld;
    };
    for (const mech of mechs) {
      for (const mesh of mech.visual.root.getChildMeshes(false)) {
        if (!mesh.isVisible || !mesh.isEnabled() || !near(mesh)) continue;
        mesh.receiveShadows = true;
        list.push(mesh);
      }
    }
    for (const mesh of this.scene.meshes) {
      if ((mesh.metadata as { castsShadow?: boolean } | null)?.castsShadow && near(mesh)) list.push(mesh);
    }
    gen.getShadowMap()!.renderList = list;
    // The sun sits far up its own ray from the player, so the light's box is centred there.
    this.sun.position.copyFrom(focus).subtractInPlace(this.sun.direction.scale(200));
  }
}
