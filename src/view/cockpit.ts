import { Camera, Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode } from "@babylonjs/core";
import { BLIP_COLORS, RADAR_RANGE, sectionColor, type HudState } from "./hud/hud";
import type { PartMaterials } from "./parts/proceduralParts";

/** Drawn after the world with the depth buffer cleared, so terrain and mechs never poke through. */
const COCKPIT_GROUP = 2;
/** Instruments redraw this often (seconds); they are canvases, so not every frame. */
const REDRAW = 0.1;

const SECTIONS: [keyof HudState["sections"], string, number, number, number, number][] = [
  // id, label, and the block's place in the silhouette (x, y, w, h on a 100 x 120 grid)
  ["torso", "TORSO", 32, 18, 36, 38],
  ["armL", "L ARM", 10, 22, 18, 34],
  ["armR", "R ARM", 72, 22, 18, 34],
  ["legs", "LEGS", 30, 62, 40, 46],
];

interface Screen {
  texture: DynamicTexture;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

/**
 * The cockpit around the camera in cockpit view: a dashboard with three instrument screens,
 * the canopy frame and side consoles. The screens show the same state the HUD reads.
 */
export class Cockpit {
  private readonly root: TransformNode;
  private readonly screens: { systems: Screen; power: Screen; radar: Screen };
  private age = REDRAW;
  /** Starts true so the constructor's setVisible(false) does hide it. */
  private visible = true;

  constructor(
    private readonly scene: Scene,
    camera: Camera,
    mats: PartMaterials,
  ) {
    this.root = new TransformNode("cockpit", scene);
    this.root.parent = camera;

    const frame = mats.dark;
    const trim = mats.metal;
    const panel = mats.secondary;
    // Dashboard: a slab under the view, its top sloping toward the pilot.
    const dash = this.node("dash", 0, -0.47, 0.98, -0.42);
    this.box("dashTop", dash, [2.6, 0.06, 0.62], [0, 0, 0], panel);
    this.box("dashBody", dash, [2.6, 0.5, 0.5], [0, -0.28, 0.12], frame);
    this.box("dashLip", dash, [2.6, 0.05, 0.05], [0, 0.04, -0.3], trim);
    // The instrument panel rises from the dash, tilted to face the pilot; screens sit in bezels on it.
    const instruments = this.node("instruments", 0, -0.41, 0.95, -1.15);
    for (const x of [-0.66, 0, 0.66]) this.box("bezel", instruments, [0.62, 0.02, 0.36], [x, 0, 0], frame);
    for (let i = 0; i < 9; i++) {
      const lamp = this.box("lamp", dash, [0.035, 0.02, 0.035], [-1.12 + i * 0.03 + (i > 4 ? 2.0 : 0), 0.04, -0.18], mats.accent);
      lamp.material = mats.accent;
    }

    // Canopy: a brow across the top and two struts down to the dash.
    this.box("brow", this.root, [3, 0.08, 0.4], [0, 0.8, 1.1], frame).rotation.x = 0.35;
    for (const side of [-1, 1]) {
      const strut = this.box("strut", this.root, [0.1, 1.7, 0.12], [side * 1.08, 0.12, 1.05], frame);
      strut.rotation.z = side * 0.16;
      strut.rotation.y = -side * 0.2;
      this.box("strutTrim", this.root, [0.03, 1.6, 0.04], [side * 1.02, 0.12, 0.98], trim).rotation.z = side * 0.16;
      // Side console under each strut.
      const console = this.box("console", this.root, [0.5, 0.5, 1.1], [side * 1.25, -0.72, 0.6], panel);
      console.rotation.z = side * 0.35;
    }

    const screen = (name: string, x: number, w: number, h: number): Screen => {
      const texture = new DynamicTexture(`${name}Tex`, { width: w, height: h }, scene, true);
      texture.hasAlpha = false;
      const mat = new StandardMaterial(`${name}Mat`, scene);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = new Color3(0.15, 0.15, 0.15);
      mat.emissiveTexture = texture;
      mat.disableLighting = false;
      const plane = MeshBuilder.CreatePlane(name, { width: 0.56, height: 0.56 * (h / w) }, scene);
      plane.parent = instruments;
      plane.position.set(x, 0.012, 0);
      plane.rotation.x = Math.PI / 2;
      plane.material = mat;
      this.prepare(plane);
      return { texture, ctx: texture.getContext() as CanvasRenderingContext2D, w, h };
    };
    this.screens = { systems: screen("systems", -0.66, 320, 180), power: screen("power", 0, 320, 180), radar: screen("radar", 0.66, 320, 180) };
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.setEnabled(visible);
    if (visible) this.age = REDRAW;
  }

  /** Redraw the instruments from the HUD's state, a few times a second. */
  update(state: HudState, dt: number): void {
    if (!this.visible) return;
    this.age += dt;
    if (this.age < REDRAW) return;
    this.age = 0;
    this.drawSystems(state);
    this.drawPower(state);
    this.drawRadar(state);
  }

  private node(name: string, x: number, y: number, z: number, tilt: number): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = this.root;
    n.position.set(x, y, z);
    n.rotation.x = tilt;
    return n;
  }

  private box(name: string, parent: TransformNode, size: [number, number, number], at: [number, number, number], mat: StandardMaterial): Mesh {
    const m = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    m.parent = parent;
    m.position.set(at[0], at[1], at[2]);
    m.material = mat;
    this.prepare(m);
    return m;
  }

  private prepare(m: Mesh): void {
    m.isPickable = false;
    m.applyFog = false;
    m.renderingGroupId = COCKPIT_GROUP;
    m.alwaysSelectAsActiveMesh = true;
  }

  private clear(s: Screen, title: string): CanvasRenderingContext2D {
    const c = s.ctx;
    c.fillStyle = "#05090c";
    c.fillRect(0, 0, s.w, s.h);
    // Scanlines, faintly.
    c.fillStyle = "rgba(120,200,255,0.04)";
    for (let y = 0; y < s.h; y += 3) c.fillRect(0, y, s.w, 1);
    c.fillStyle = "#6fb8d8";
    c.font = "bold 15px monospace";
    c.textAlign = "left";
    c.textBaseline = "top";
    c.fillText(title, 10, 8);
    return c;
  }

  /** Left screen: the suit's sections, coloured by what is left of each. */
  private drawSystems(state: HudState): void {
    const s = this.screens.systems;
    const c = this.clear(s, "SYSTEMS");
    const ox = 20;
    const oy = 32;
    const k = 1.0;
    for (const [id, label, x, y, w, h] of SECTIONS) {
      const f = state.sections[id];
      c.fillStyle = sectionColor(f);
      c.fillRect(ox + x * k, oy + y * k, w * k, h * k);
      c.strokeStyle = "#05090c";
      c.lineWidth = 2;
      c.strokeRect(ox + x * k, oy + y * k, w * k, h * k);
      c.fillStyle = "#05090c";
      c.font = "bold 11px monospace";
      c.fillText(label, ox + x * k + 2, oy + y * k + 3);
    }
    c.font = "bold 16px monospace";
    let row = 34;
    for (const [id, label] of SECTIONS) {
      const f = state.sections[id];
      c.fillStyle = sectionColor(f);
      c.fillText(`${label.padEnd(6)} ${f <= 0 ? "LOST" : `${Math.ceil(f * 100)}%`}`, 160, row);
      row += 24;
    }
    s.texture.update();
  }

  /** Centre screen: energy and heat, with the heat warnings. */
  private drawPower(state: HudState): void {
    const s = this.screens.power;
    const c = this.clear(s, "POWER");
    const bar = (label: string, value: number, y: number, color: string): void => {
      c.fillStyle = "#1a2630";
      c.fillRect(14, y, s.w - 28, 30);
      c.fillStyle = color;
      c.fillRect(14, y, (s.w - 28) * Math.max(0, Math.min(1, value)), 30);
      c.fillStyle = "#05090c";
      c.font = "bold 18px monospace";
      c.fillText(`${label} ${Math.round(value * 100)}%`, 22, y + 6);
    };
    bar("ENERGY", state.energy, 40, "#39c2ff");
    const hot = state.heat >= state.heatWarnAt;
    bar("HEAT", state.heat, 92, state.overheated ? "#ff4b3a" : hot ? "#ffa630" : "#c98a3a");
    c.font = "bold 16px monospace";
    if (state.overheated) {
      c.fillStyle = Math.floor(performance.now() / 250) % 2 === 0 ? "#ff4b3a" : "#5a2320";
      c.fillText("WEAPONS LOCKED", 14, 140);
    } else if (hot) {
      c.fillStyle = "#ffa630";
      c.fillText("HEAT CRITICAL", 14, 140);
    } else {
      c.fillStyle = "#3f6f85";
      const deg = Math.round(((((state.heading * 180) / Math.PI) % 360) + 360) % 360);
      c.fillText(`HDG ${deg.toString().padStart(3, "0")}`, 14, 140);
    }
    s.texture.update();
  }

  /** Right screen: the radar contacts, forward up. */
  private drawRadar(state: HudState): void {
    const s = this.screens.radar;
    const c = this.clear(s, "RADAR");
    const cx = s.w / 2;
    const cy = s.h / 2 + 10;
    const r = 70;
    c.strokeStyle = "#1f4a5c";
    c.lineWidth = 1;
    for (const k of [1, 0.5]) {
      c.beginPath();
      c.arc(cx, cy, r * k, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - r, cy);
    c.lineTo(cx + r, cy);
    c.moveTo(cx, cy - r);
    c.lineTo(cx, cy + r);
    c.stroke();
    const range = RADAR_RANGE;
    for (const b of state.radar) {
      const d = Math.hypot(b.x, b.z);
      const k = (Math.min(d, range) / range) * r / Math.max(d, 0.001);
      c.fillStyle = BLIP_COLORS[b.kind];
      c.globalAlpha = d > range ? 0.5 : 1;
      c.fillRect(cx + b.x * k - 3, cy - b.z * k - 3, 6, 6);
    }
    c.globalAlpha = 1;
    c.fillStyle = "#ffffff";
    c.fillRect(cx - 2, cy - 2, 4, 4);
    s.texture.update();
  }
}
