import { makeRng } from "../sim/math";
import type { RGB } from "./biomes";
import type { LayoutId } from "./world";

export const SITE_MATERIALS = {
  pad: [0.25, 0.26, 0.28],
  baseWall: [0.42, 0.45, 0.48],
  baseTrim: [0.79, 0.47, 0.17],
  outpostWall: [0.3, 0.29, 0.3],
  outpostDark: [0.48, 0.14, 0.18],
  rust: [0.36, 0.24, 0.18],
  crate: [0.45, 0.41, 0.3],
  stone: [0.52, 0.5, 0.47],
  hull: [0.33, 0.36, 0.4],
} satisfies Record<string, RGB>;

export type SiteMaterial = keyof typeof SITE_MATERIALS;

/** A static box. Positions are offsets from the site centre; the site's ground is level. */
export interface BlockSpec {
  dx: number;
  dz: number;
  /** Height of the block's base above the site's ground. */
  lift?: number;
  size: [number, number, number];
  rotY?: number;
  tilt?: number;
  material: SiteMaterial;
}

const block = (material: SiteMaterial, dx: number, dz: number, size: [number, number, number], more: Partial<BlockSpec> = {}): BlockSpec => ({
  dx,
  dz,
  size,
  material,
  ...more,
});

/** A pad and an open-fronted hangar behind it, open toward +Z. */
function base(): BlockSpec[] {
  const hz = -30;
  return [
    block("pad", 0, 0, [26, 0.4, 26]),
    block("baseWall", 0, hz - 9, [24, 11, 1.2]),
    block("baseWall", -12, hz, [1.2, 11, 18]),
    block("baseWall", 12, hz, [1.2, 11, 18]),
    block("baseTrim", 0, hz, [26, 1, 20], { lift: 11 }),
    block("baseTrim", -20, -6, [1, 16, 1]),
  ];
}

/** A walled compound with gaps, two towers and a central bunker. */
function outpost(): BlockSpec[] {
  const half = 34;
  return [
    // South wall with a central gate gap.
    block("outpostWall", -22, -half, [24, 7, 2]),
    block("outpostWall", 22, -half, [24, 7, 2]),
    // North wall.
    block("outpostWall", 0, half, [68, 7, 2]),
    // West wall with a gap, east wall solid.
    block("outpostWall", -half, -18, [2, 7, 30]),
    block("outpostWall", -half, 22, [2, 7, 24]),
    block("outpostWall", half, 0, [2, 7, 68]),
    block("outpostDark", -half, -half, [6, 16, 6]),
    block("outpostDark", half, half, [6, 16, 6]),
    block("outpostDark", 0, 8, [18, 6, 14]),
    block("outpostWall", 0, 8, [8, 3, 6], { lift: 6 }),
    block("outpostWall", -14, -12, [5, 4, 5], { rotY: 0.4 }),
    block("outpostWall", 16, -16, [6, 5, 4], { rotY: -0.3 }),
  ];
}

/** A watch tower, a windbreak and a few crates. */
function camp(): BlockSpec[] {
  return [
    block("outpostDark", -10, 8, [4, 13, 4]),
    block("outpostWall", 6, -12, [18, 4, 1.5], { rotY: 0.25 }),
    block("crate", 8, 6, [4, 3, 4], { rotY: 0.5 }),
    block("crate", 12, 9, [3, 2.5, 3], { rotY: -0.2 }),
    block("crate", -4, -4, [3, 3, 5], { rotY: 1.1 }),
  ];
}

/** Scattered hull plates and girders from an old battle. */
function wreckField(rng: () => number, radius: number): BlockSpec[] {
  const blocks: BlockSpec[] = [];
  for (let i = 0; i < 9; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * radius * 0.85;
    blocks.push(
      block("rust", Math.cos(angle) * dist, Math.sin(angle) * dist, [4 + rng() * 9, 3 + rng() * 6, 1.5 + rng() * 3], {
        lift: -1,
        rotY: rng() * Math.PI,
        tilt: (rng() - 0.5) * 0.7,
      }),
    );
  }
  return blocks;
}

/** An open shed and stacked crates. */
function depot(): BlockSpec[] {
  return [
    block("baseWall", 0, -9, [14, 7, 1], {}),
    block("baseWall", -7, -4, [1, 7, 10]),
    block("baseWall", 7, -4, [1, 7, 10]),
    block("rust", 0, -4, [16, 0.8, 12], { lift: 7 }),
    block("crate", -11, 6, [4, 4, 4], { rotY: 0.3 }),
    block("crate", -11, 6, [3, 3, 3], { lift: 4, rotY: 0.7 }),
    block("crate", 10, 8, [5, 3, 4], { rotY: -0.4 }),
  ];
}

/** A tall mast that tapers in steps: visible from a long way off. */
function spire(): BlockSpec[] {
  return [
    block("stone", 0, 0, [9, 20, 9]),
    block("stone", 0, 0, [6.5, 18, 6.5], { lift: 20, rotY: 0.4 }),
    block("stone", 0, 0, [4, 16, 4], { lift: 38, rotY: 0.8 }),
    block("baseTrim", 0, 0, [1.6, 14, 1.6], { lift: 54 }),
  ];
}

/** Two piers and what is left of the deck between them. */
function arch(): BlockSpec[] {
  return [
    block("stone", -13, 0, [6, 28, 7]),
    block("stone", 13, 0, [6, 28, 7]),
    block("stone", -5, 0, [22, 4, 7], { lift: 28 }),
    block("stone", 15, 0, [9, 4, 7], { lift: 25, tilt: -0.45 }),
    block("stone", 6, 5, [8, 3, 5], { lift: -1, rotY: 0.6, tilt: 0.2 }),
  ];
}

/** A mast carrying a great tilted dish, with a hut at its foot. */
function dish(): BlockSpec[] {
  return [
    block("baseWall", 0, 0, [3, 24, 3]),
    block("hull", 0, 2, [24, 1.6, 24], { lift: 23, tilt: 0.5 }),
    block("baseWall", -9, -6, [7, 5, 6], { rotY: 0.2 }),
    block("baseTrim", -9, -6, [1, 6, 1], { lift: 5 }),
  ];
}

/** The broken hull of a crashed carrier, half buried. */
function hulk(): BlockSpec[] {
  return [
    block("hull", -6, 0, [52, 12, 14], { lift: -3, rotY: 0.35, tilt: 0.1 }),
    block("hull", 22, -14, [22, 16, 11], { lift: -4, rotY: -0.5, tilt: -0.18 }),
    block("rust", -24, 12, [2, 18, 11], { lift: -2, rotY: 0.35, tilt: 0.3 }),
    block("rust", 6, 16, [10, 4, 6], { lift: -1, rotY: 1.2, tilt: 0.25 }),
  ];
}

/** Stable seed from a site id, so a site's random details never change. */
function seedFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The blocks that stand on a site. The same site always gets the same blocks. */
export function siteBlocks(site: { id: string; layout: LayoutId; radius: number }): BlockSpec[] {
  switch (site.layout) {
    case "base":
      return base();
    case "outpost":
      return outpost();
    case "camp":
      return camp();
    case "wreckField":
      return wreckField(makeRng(seedFrom(site.id)), site.radius);
    case "depot":
      return depot();
    case "spire":
      return spire();
    case "arch":
      return arch();
    case "dish":
      return dish();
    case "hulk":
      return hulk();
  }
}

/** Where a site's salvage crates lie, as offsets from its centre. */
export function cacheSpots(site: { id: string; radius: number; cache?: number }): [number, number][] {
  const rng = makeRng(seedFrom(site.id) + 1);
  const spots: [number, number][] = [];
  for (let i = 0; i < (site.cache ?? 0); i++) {
    const angle = rng() * Math.PI * 2;
    const dist = (0.35 + rng() * 0.4) * site.radius;
    spots.push([Math.cos(angle) * dist, Math.sin(angle) * dist]);
  }
  return spots;
}
