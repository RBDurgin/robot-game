import type { Site, WorldModel } from "../sim/terrain";
import { BIOME_COUNT, sampleTerrain } from "../sim/terrain";
import { groundColor } from "./terrain";

/** Pixels along one side of the terrain picture. Each is sampled once, the first time the map opens. */
const TERRAIN_PIXELS = 224;

const terrainCache = new WeakMap<WorldModel, HTMLCanvasElement>();

/** A picture of the whole world from above: ground colour, lit from the north-west. */
function terrainPicture(model: WorldModel): HTMLCanvasElement {
  const cached = terrainCache.get(model);
  if (cached) return cached;
  const n = TERRAIN_PIXELS;
  const size = model.def.size;
  const step = size / n;
  const heights = new Float32Array(n * n);
  const colors = new Float32Array(n * n * 3);
  const mix = new Float32Array(BIOME_COUNT);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      // Row 0 is the north edge (+Z).
      const x = -size / 2 + (col + 0.5) * step;
      const z = size / 2 - (row + 0.5) * step;
      const i = row * n + col;
      heights[i] = sampleTerrain(model, x, z, mix);
      groundColor(model.def, x, z, heights[i]!, mix, colors, i * 3);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(n, n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const west = heights[row * n + Math.max(0, col - 1)]!;
      const north = heights[Math.max(0, row - 1) * n + col]!;
      const shade = Math.min(1.35, Math.max(0.55, 1 + ((heights[i]! - west) + (heights[i]! - north)) / step * 0.9));
      for (let c = 0; c < 3; c++) image.data[i * 4 + c] = Math.min(255, colors[i * 3 + c]! * shade * 255);
      image.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  terrainCache.set(model, canvas);
  return canvas;
}

export interface MapSite {
  site: Site;
  /** A base the player holds. */
  held: boolean;
  /** Still has a living garrison. */
  hostile: boolean;
}

export interface MapContent {
  model: WorldModel;
  player: { x: number; z: number; yaw: number };
  sites: MapSite[];
}

const SITE_COLORS = { held: "#39c2ff", hostile: "#ff5a4a", neutral: "#f2e9c9" };

/** Draw the world map: terrain, region names, the places the player knows, and the player. */
export function drawMap(canvas: HTMLCanvasElement, content: MapContent): void {
  const { model, player } = content;
  const w = canvas.width;
  const size = model.def.size;
  const px = (x: number): number => ((x + size / 2) / size) * w;
  const py = (z: number): number => ((size / 2 - z) / size) * w;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrainPicture(model), 0, 0, w, w);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(w / 52)}px system-ui, sans-serif`;
  for (const region of model.def.regions) {
    const label = region.name.toUpperCase();
    ctx.fillStyle = "rgba(10, 12, 16, 0.55)";
    ctx.fillText(label, px(region.x) + 1, py(region.z) + 1);
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillText(label, px(region.x), py(region.z));
  }

  ctx.font = `${Math.round(w / 60)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  for (const { site, held, hostile } of content.sites) {
    const x = px(site.x);
    const y = py(site.z);
    const r = site.kind === "base" || site.kind === "outpost" ? w / 110 : w / 170;
    ctx.fillStyle = held ? SITE_COLORS.held : hostile ? SITE_COLORS.hostile : SITE_COLORS.neutral;
    ctx.strokeStyle = "#0b0d10";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Bases are squares, enemy sites diamonds, everything else a dot.
    if (site.kind === "base") ctx.rect(x - r, y - r, r * 2, r * 2);
    else if (site.kind === "outpost" || site.kind === "camp") {
      ctx.moveTo(x, y - r * 1.3);
      ctx.lineTo(x + r * 1.3, y);
      ctx.lineTo(x, y + r * 1.3);
      ctx.lineTo(x - r * 1.3, y);
      ctx.closePath();
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(10, 12, 16, 0.7)";
    ctx.fillText(site.name, x + r + 5, y + 1);
    ctx.fillStyle = "#fff";
    ctx.fillText(site.name, x + r + 4, y);
  }

  // The player: an arrow pointing the way they face (yaw 0 is north, positive turns east).
  ctx.save();
  ctx.translate(px(player.x), py(player.z));
  ctx.rotate(player.yaw);
  const a = w / 60;
  ctx.beginPath();
  ctx.moveTo(0, -a * 1.4);
  ctx.lineTo(a * 0.8, a);
  ctx.lineTo(0, a * 0.45);
  ctx.lineTo(-a * 0.8, a);
  ctx.closePath();
  ctx.fillStyle = "#ffd23c";
  ctx.strokeStyle = "#0b0d10";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
