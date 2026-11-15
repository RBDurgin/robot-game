import { flatAreas, type ZoneDef } from "../data/zone";
import { fbm2D, lerp, smoothstep } from "./math";

/** Rolling terrain height before any levelling is applied. */
function rawHeight(zone: ZoneDef, x: number, z: number): number {
  const f = 1 / zone.featureSize;
  const base = fbm2D(x * f, z * f, zone.seed, 5);
  // A sharper ridged layer gives hills crests to fight over rather than only smooth bumps.
  const ridge = 1 - Math.abs(fbm2D(x * f * 1.7 + 40, z * f * 1.7 - 17, zone.seed + 7, 3) * 2 - 1);
  return (base * 0.75 + ridge * ridge * 0.25) * zone.relief;
}

/**
 * Ground height at a world position. Pure function of the zone definition, so the
 * terrain mesh, spawn placement and AI all agree without sharing any engine state.
 */
export function heightAt(zone: ZoneDef, x: number, z: number): number {
  let h = rawHeight(zone, x, z);
  for (const area of flatAreas(zone)) {
    const d = Math.hypot(x - area.x, z - area.z);
    if (d < area.radius * 1.8) {
      const level = rawHeight(zone, area.x, area.z);
      h = lerp(level, h, smoothstep(area.radius, area.radius * 1.8, d));
    }
  }
  // Raise the rim so the zone reads as a basin and the edge is a natural wall.
  const half = zone.size / 2;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(half - 90, half, edge) * 60;
  return h;
}
