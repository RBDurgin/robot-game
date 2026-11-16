import { BIOME_IDS } from "../data/biomes";
import type { SiteDef, WorldDef } from "../data/world";
import { makeRng } from "./math";
import { biomeWeights, naturalHeight, type Site, type WorldModel } from "./terrain";

/** A rule gives up on a site after this many rejected positions. */
const ATTEMPTS_PER_SITE = 60;
/** A generated site must sit this firmly inside one of its rule's biomes. */
const MIN_BIOME_WEIGHT = 0.85;

/**
 * Place the minor sites the world's rules ask for. Deterministic for a given definition: the
 * same seed always gives the same sites, so saves can refer to them by id.
 */
export function generateSites(def: WorldDef): SiteDef[] {
  const placed: SiteDef[] = [];
  const limit = def.size / 2 - def.rim.width - 150;
  const weights = new Float32Array(BIOME_IDS.length);
  def.placement.forEach((rule, ruleIndex) => {
    const rng = makeRng(def.seed + 977 * (ruleIndex + 1));
    let made = 0;
    for (let attempt = 0; attempt < rule.count * ATTEMPTS_PER_SITE && made < rule.count; attempt++) {
      const x = Math.round((rng() * 2 - 1) * limit);
      const z = Math.round((rng() * 2 - 1) * limit);
      biomeWeights(def, x, z, weights);
      if (!rule.biomes.some((id) => weights[BIOME_IDS.indexOf(id)]! >= MIN_BIOME_WEIGHT)) continue;
      if ([...def.sites, ...placed].some((s) => Math.hypot(s.x - x, s.z - z) < def.siteSpacing)) continue;
      made++;
      placed.push({
        id: `${rule.layout}-${ruleIndex}-${made}`,
        name: rule.names[made - 1] ?? `${rule.names[0] ?? rule.kind} ${made}`,
        kind: rule.kind,
        layout: rule.layout,
        x,
        z,
        radius: rule.radius,
        ...(rule.garrison ? { garrison: rule.garrison } : {}),
        ...(rule.cache ? { cache: rule.cache } : {}),
      });
    }
  });
  return placed;
}

/** Derive everything the game needs from a world definition. Do this once at start-up. */
export function buildWorldModel(def: WorldDef): WorldModel {
  const withLevel = (site: SiteDef, generated: boolean): Site => ({ ...site, generated, level: naturalHeight(def, site.x, site.z) });
  const sites = [...def.sites.map((s) => withLevel(s, false)), ...generateSites(def).map((s) => withLevel(s, true))];
  return { def, sites, siteById: new Map(sites.map((s) => [s.id, s])) };
}
