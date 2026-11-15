import { AdvancedDynamicTexture, Control, Ellipse, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui";
import type { Scene, TransformNode } from "@babylonjs/core";
import type { SectionId } from "../../data/frames";

export const HUD_FONT = "ui-monospace, Menlo, Consolas, monospace";
const PANEL = "#0d1014";
const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function text(name: string, size: number, color = "#e8eef5"): TextBlock {
  const t = new TextBlock(name, "");
  t.color = color;
  t.fontSize = size;
  t.fontFamily = HUD_FONT;
  return t;
}

class Bar {
  readonly root: Rectangle;
  private readonly fill: Rectangle;
  private readonly label: TextBlock;

  constructor(
    name: string,
    private readonly color: string,
    width = 220,
  ) {
    this.root = new Rectangle(`${name}Bar`);
    this.root.width = `${width}px`;
    this.root.height = "18px";
    this.root.thickness = 1;
    this.root.color = "#8a97a6";
    this.root.background = "rgba(0,0,0,0.45)";
    this.root.paddingBottom = "4px";

    this.fill = new Rectangle(`${name}Fill`);
    this.fill.thickness = 0;
    this.fill.background = color;
    this.fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.root.addControl(this.fill);

    this.label = text(`${name}Label`, 11, "#ffffff");
    this.label.text = name.toUpperCase();
    this.label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.label.paddingLeft = "6px";
    this.root.addControl(this.label);
  }

  set(fraction: number, warn = false, label?: string): void {
    this.fill.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.fill.background = warn ? "#ff4b3a" : this.color;
    if (label !== undefined) this.label.text = label;
  }
}

export type BlipKind = "enemy" | "salvage" | "base" | "outpost";

/** A radar contact, in metres relative to the player: +x is to the right, +z is ahead. */
export interface RadarBlip {
  x: number;
  z: number;
  kind: BlipKind;
}

const RADAR_RANGE = 260;
const RADAR_RADIUS = 62;
const BLIP_COLORS: Record<BlipKind, string> = { enemy: "#ff5a4a", salvage: "#4dffa6", base: "#39c2ff", outpost: "#ffa630" };

export interface HudState {
  energy: number;
  heat: number;
  overheated: boolean;
  cockpit: boolean;
  /** Remaining health of each section, 0..1. */
  sections: Record<SectionId, number>;
  /** Hostile under the crosshair. */
  target: { name: string; health: number } | null;
  objective: string;
  /** Short-lived notice, or null. */
  message: string | null;
  /** Player's view yaw in radians (0 = north, +Z). */
  heading: number;
  /** Bearing and distance to the current objective, if any. */
  waypoint: { bearing: number; distance: number; label: string } | null;
  /** 0..1, set to 1 when the player lands a hit. */
  hitFlash: number;
  /** 0..1, set to 1 when the player takes damage. */
  damageFlash: number;
  /** Lines shown above the radar (weapons, scrap, prompts). */
  info: string;
  radar: RadarBlip[];
}

const SECTION_LABELS: [SectionId, string][] = [
  ["torso", "TORSO"],
  ["armL", "L ARM"],
  ["armR", "R ARM"],
  ["legs", "LEGS "],
];

function sectionColor(f: number): string {
  if (f <= 0) return "#5a6068";
  if (f < 0.35) return "#ff4b3a";
  if (f < 0.7) return "#ffc247";
  return "#7dffa0";
}

/** Player HUD: crosshair, resources, damage readout, target info, compass and the cockpit frame. */
export class Hud {
  readonly ui: AdvancedDynamicTexture;
  private readonly energy = new Bar("energy", "#39c2ff");
  private readonly heat = new Bar("heat", "#ffa630");
  private readonly targetBar = new Bar("target", "#ff5a4a", 260);
  private readonly targetPanel: StackPanel;
  private readonly cockpitFrame: Control[] = [];
  private readonly crosshair: Rectangle[] = [];
  private readonly sectionTexts = new Map<SectionId, TextBlock>();
  private readonly objective: TextBlock;
  private readonly compass: TextBlock;
  private readonly message: TextBlock;
  private readonly info: TextBlock;
  private readonly damageVeil: Rectangle;
  private readonly markers = new Map<TransformNode, Rectangle>();
  private readonly radar: Ellipse;
  private readonly blips: Ellipse[] = [];

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("hud", true, scene);

    this.damageVeil = new Rectangle("damageVeil");
    this.damageVeil.thickness = 0;
    this.damageVeil.background = "#ff2a1a";
    this.damageVeil.alpha = 0;
    this.damageVeil.isHitTestVisible = false;
    this.ui.addControl(this.damageVeil);

    this.buildCockpitFrame();

    for (const [w, h] of [
      [18, 2],
      [2, 18],
    ] as const) {
      const line = new Rectangle("crosshair");
      line.width = `${w}px`;
      line.height = `${h}px`;
      line.thickness = 0;
      this.ui.addControl(line);
      this.crosshair.push(line);
    }

    // Top centre: compass, objective, transient message, target panel.
    const top = new StackPanel("top");
    top.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    top.top = "10px";
    top.width = "720px";
    this.compass = text("compass", 13, "#cfe8ff");
    this.compass.height = "20px";
    this.objective = text("objective", 13);
    this.objective.height = "20px";
    this.message = text("message", 15, "#ffd27a");
    this.message.height = "26px";
    this.targetPanel = new StackPanel("targetPanel");
    this.targetPanel.height = "26px";
    this.targetPanel.addControl(this.targetBar.root);
    top.addControl(this.compass);
    top.addControl(this.objective);
    top.addControl(this.message);
    top.addControl(this.targetPanel);
    this.ui.addControl(top);

    // Bottom left: section health, then resource bars.
    const status = new StackPanel("status");
    status.width = "240px";
    status.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    status.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    status.left = "16px";
    status.top = "-12px";
    for (const [id] of SECTION_LABELS) {
      const t = text(`section-${id}`, 12);
      t.height = "16px";
      t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
      status.addControl(t);
      this.sectionTexts.set(id, t);
    }
    const gap = new Rectangle("gap");
    gap.height = "6px";
    gap.thickness = 0;
    status.addControl(gap);
    status.addControl(this.energy.root);
    status.addControl(this.heat.root);
    this.ui.addControl(status);

    this.info = text("info", 12, "#cfe8ff");
    this.info.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.info.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.info.paddingRight = "16px";
    this.info.paddingBottom = "168px";
    this.info.isHitTestVisible = false;
    this.ui.addControl(this.info);

    // Bottom right: radar. Up is the direction the player is facing.
    this.radar = new Ellipse("radar");
    this.radar.width = "140px";
    this.radar.height = "140px";
    this.radar.thickness = 1;
    this.radar.color = "#8a97a6";
    this.radar.background = "rgba(0,0,0,0.45)";
    this.radar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.radar.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.radar.left = "-16px";
    this.radar.top = "-14px";
    this.ui.addControl(this.radar);
    const self = new Rectangle("radarSelf");
    self.width = "6px";
    self.height = "6px";
    self.thickness = 0;
    self.background = "#ffffff";
    self.rotation = Math.PI / 4;
    this.radar.addControl(self);
  }

  private buildCockpitFrame(): void {
    const strip = (name: string, cfg: (r: Rectangle) => void): void => {
      const r = new Rectangle(name);
      r.thickness = 0;
      r.background = PANEL;
      r.isVisible = false;
      cfg(r);
      this.ui.addControl(r);
      this.cockpitFrame.push(r);
    };
    strip("canopyTop", (r) => {
      r.height = "5%";
      r.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    });
    strip("dashboard", (r) => {
      r.height = "21%";
      r.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    });
    for (const side of [-1, 1]) {
      strip(`strut${side}`, (r) => {
        r.width = "4%";
        r.height = "130%";
        r.left = `${side * 43}%`;
        r.rotation = side * 0.16;
      });
    }
  }

  /** Show a marker that follows a hostile mech. */
  addMarker(node: TransformNode): void {
    const m = new Rectangle("marker");
    m.width = "9px";
    m.height = "9px";
    m.thickness = 0;
    m.background = "#ff5a4a";
    m.rotation = Math.PI / 4;
    this.ui.addControl(m);
    m.linkWithMesh(node);
    this.markers.set(node, m);
  }

  removeMarker(node: TransformNode): void {
    const m = this.markers.get(node);
    if (m) {
      this.ui.removeControl(m);
      m.dispose();
      this.markers.delete(node);
    }
  }

  private updateRadar(contacts: RadarBlip[]): void {
    while (this.blips.length < contacts.length) {
      const blip = new Ellipse("blip");
      blip.thickness = 0;
      this.radar.addControl(blip);
      this.blips.push(blip);
    }
    this.blips.forEach((blip, i) => {
      const c = contacts[i];
      blip.isVisible = c !== undefined;
      if (!c) return;
      // Contacts beyond radar range sit on the rim, so you still get their direction.
      const d = Math.hypot(c.x, c.z);
      const k = (Math.min(d, RADAR_RANGE) / RADAR_RANGE) * RADAR_RADIUS / Math.max(d, 0.001);
      const size = c.kind === "enemy" || c.kind === "salvage" ? 6 : 9;
      blip.width = `${size}px`;
      blip.height = `${size}px`;
      blip.left = `${c.x * k}px`;
      blip.top = `${-c.z * k}px`;
      blip.background = BLIP_COLORS[c.kind];
      blip.alpha = d > RADAR_RANGE ? 0.55 : 1;
    });
  }

  update(state: HudState): void {
    this.energy.set(state.energy);
    this.heat.set(state.heat, state.overheated, state.overheated ? "OVERHEAT - WEAPONS LOCKED" : "HEAT");
    for (const c of this.cockpitFrame) c.isVisible = state.cockpit;

    for (const [id, label] of SECTION_LABELS) {
      const f = state.sections[id];
      const t = this.sectionTexts.get(id)!;
      t.text = `${label} ${f <= 0 ? "DESTROYED" : `${Math.ceil(f * 100)}%`}`;
      t.color = sectionColor(f);
    }

    const cross = state.hitFlash > 0.05 ? "#ff5a4a" : "rgba(255,255,255,0.85)";
    for (const line of this.crosshair) line.background = cross;
    this.damageVeil.alpha = Math.min(0.35, state.damageFlash * 0.35);

    const deg = (((state.heading * 180) / Math.PI) % 360 + 360) % 360;
    let compass = `${COMPASS_POINTS[Math.round(deg / 45) % 8]} ${Math.round(deg).toString().padStart(3, "0")}°`;
    if (state.waypoint) {
      const rel = ((((state.waypoint.bearing - state.heading) * 180) / Math.PI + 540) % 360) - 180;
      const arrow = Math.abs(rel) < 12 ? "▲" : rel < 0 ? "◀" : "▶";
      compass += `   ${arrow} ${state.waypoint.label} ${Math.round(state.waypoint.distance)} m`;
    }
    this.compass.text = compass;
    this.objective.text = state.objective;
    this.message.text = state.message ?? "";
    this.info.text = state.info;

    this.updateRadar(state.radar);

    this.targetPanel.isVisible = state.target !== null;
    if (state.target) this.targetBar.set(state.target.health, false, state.target.name.toUpperCase());
  }
}
