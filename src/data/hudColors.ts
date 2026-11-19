/**
 * HUD and marker colours. "standard" is the original look; "distinct" never asks the player to
 * tell red from green: friend and foe are blue against orange, and section damage goes from blue
 * through yellow to orange, each step also lighter or darker than the next. Both are told apart
 * by more than hue too: section bars carry their percentage, and the heat bar flashes a warning.
 */
export interface HudPalette {
  hostile: string;
  neutral: string;
  allied: string;
  salvage: string;
  base: string;
  outpost: string;
  /** Section bars, from healthy to nearly gone, and destroyed. */
  sectionOk: string;
  sectionWorn: string;
  sectionCritical: string;
  sectionGone: string;
  /** A bar in its warning state (heat near lockout), and the alert text. */
  warn: string;
}

export const HUD_PALETTES = {
  standard: {
    hostile: "#ff5a4a",
    neutral: "#d8d2b8",
    allied: "#4dd6ff",
    salvage: "#4dffa6",
    base: "#39c2ff",
    outpost: "#ffa630",
    sectionOk: "#7dffa0",
    sectionWorn: "#ffc247",
    sectionCritical: "#ff4b3a",
    sectionGone: "#5a6068",
    warn: "#ff4b3a",
  },
  distinct: {
    hostile: "#ff8a1f",
    neutral: "#e6e2d0",
    allied: "#3d9bff",
    salvage: "#ffe14d",
    base: "#8fd3ff",
    outpost: "#d68cff",
    sectionOk: "#5ab8ff",
    sectionWorn: "#ffe14d",
    sectionCritical: "#ff7a00",
    sectionGone: "#5a6068",
    warn: "#ff7a00",
  },
} as const satisfies Record<string, HudPalette>;

export type HudColors = keyof typeof HUD_PALETTES;
export const isHudColors = (v: unknown): v is HudColors => typeof v === "string" && v in HUD_PALETTES;
