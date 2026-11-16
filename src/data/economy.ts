import type { ItemId } from "../sim/loadout";

/** What scrap buys. Repairs are billed on respawn and when deploying from a hangar. */
export const ECONOMY = {
  /** Scrap per point of armor or structure put back. */
  repairPerPoint: 0.12,
  /** The most one repair can cost, however much of the suit is gone. */
  repairCap: 90,
  /** Share of an item's price paid back when it is sold. */
  sellRatio: 0.4,
};

/** What each part costs at a base. Every part is for sale; drops are the cheaper way to get one. */
export const PRICES = {
  pulseRifle: 120,
  slugCannon: 180,
  scatterGun: 150,
  lanceBeam: 220,
  arcLauncher: 200,
  swarmPod: 240,
  seekerRack: 300,
  lightPlating: 90,
  standardPlating: 60,
  heavyPlating: 160,
} satisfies Record<ItemId, number>;
