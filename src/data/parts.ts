/** Armor plating fitted over the frame. Heavier plating protects more but slows the mech. */
export interface PlatingDef {
  id: string;
  name: string;
  /** Multiplier on every section's armor. */
  armorScale: number;
  /** Tonnes; counts against the frame's load capacity. */
  mass: number;
  description: string;
}

export const PLATING = {
  lightPlating: {
    id: "lightPlating",
    name: "Skirmish Plating",
    armorScale: 0.7,
    mass: 1.5,
    description: "Thin composite. Less protection, noticeably quicker.",
  },
  standardPlating: {
    id: "standardPlating",
    name: "Line Plating",
    armorScale: 1,
    mass: 3,
    description: "Factory-standard armor.",
  },
  heavyPlating: {
    id: "heavyPlating",
    name: "Bulwark Plating",
    armorScale: 1.4,
    mass: 5,
    description: "Thick layered armor. Leaves little capacity for heavy weapons.",
  },
} satisfies Record<string, PlatingDef>;

export type PlatingId = keyof typeof PLATING;
