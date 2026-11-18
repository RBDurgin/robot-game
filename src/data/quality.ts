/** Graphics quality presets: what each costs is measured with `?profile` on the target machine. */
export type QualityLevel = "low" | "medium" | "high";

export interface QualityDef {
  label: string;
  /** Sun shadow map size in texels; 0 for no shadows. */
  shadowMap: number;
  /** Shadows are cast by mechs and structures within this many metres of the player. */
  shadowRange: number;
  /** Normal-mapped panel detail on mech parts. */
  surfaceDetail: boolean;
  /** Multiplier on particle counts for jets, impacts and explosions. */
  particles: number;
  /** Anti-aliasing, tone mapping and a light bloom on bright things. */
  post: boolean;
  /** A glow around emissive parts: canopies, lights, flames and tracers. */
  glow: boolean;
}

export const QUALITY: Record<QualityLevel, QualityDef> = {
  low: { label: "Low", shadowMap: 0, shadowRange: 0, surfaceDetail: false, particles: 0.4, post: false, glow: false },
  medium: { label: "Medium", shadowMap: 1024, shadowRange: 70, surfaceDetail: true, particles: 1, post: true, glow: false },
  high: { label: "High", shadowMap: 2048, shadowRange: 120, surfaceDetail: true, particles: 1.6, post: true, glow: true },
};

/** The preset a new save starts on; it must hold 60 fps on the reference machine (phase 7). */
export const DEFAULT_QUALITY: QualityLevel = "medium";

export const isQualityLevel = (v: unknown): v is QualityLevel => typeof v === "string" && v in QUALITY;
