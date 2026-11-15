/** Colours are 0xRRGGBB. */
export interface ColorScheme {
  primary: number;
  secondary: number;
  accent: number;
}

export interface FactionDef {
  id: string;
  name: string;
  colors: ColorScheme;
  /** Faction ids this faction attacks on sight. */
  hostileTo: string[];
}

export const FACTIONS = {
  drifters: {
    id: "drifters",
    name: "Drifter Compact",
    colors: { primary: 0xc9772b, secondary: 0x3a3f47, accent: 0x6fe3ff },
    hostileTo: ["combine"],
  },
  combine: {
    id: "combine",
    name: "Kestrel Combine",
    colors: { primary: 0x7b2230, secondary: 0x24262b, accent: 0xff5a3c },
    hostileTo: ["drifters"],
  },
} satisfies Record<string, FactionDef>;

export type FactionId = keyof typeof FACTIONS;

export const areHostile = (a: FactionId, b: FactionId): boolean =>
  (FACTIONS[a].hostileTo as string[]).includes(b) || (FACTIONS[b].hostileTo as string[]).includes(a);
