import { SECTION_IDS, type FrameDef, type SectionId } from "../data/frames";

export interface SectionState {
  armor: number;
  structure: number;
  maxArmor: number;
  maxStructure: number;
  destroyed: boolean;
}

export interface Health {
  sections: Record<SectionId, SectionState>;
  alive: boolean;
}

export interface DamageResult {
  /** Sections destroyed by this hit, in order. */
  destroyed: SectionId[];
  killed: boolean;
}

/** `armorScale` lets fitted plating raise (or strip) armor without changing the frame. */
export function createHealth(frame: FrameDef, armorScale = 1): Health {
  const sections = {} as Record<SectionId, SectionState>;
  for (const id of SECTION_IDS) {
    const def = frame.sections[id];
    const armor = Math.round(def.armor * armorScale);
    sections[id] = { armor, structure: def.structure, maxArmor: armor, maxStructure: def.structure, destroyed: false };
  }
  return { sections, alive: true };
}

/**
 * Apply damage to one section. Armor absorbs first, then structure. A destroyed arm or leg
 * passes any further damage through to the torso; destroying the torso kills the mech.
 */
export function applyDamage(health: Health, section: SectionId, amount: number): DamageResult {
  const result: DamageResult = { destroyed: [], killed: false };
  if (!health.alive || amount <= 0) return result;

  let remaining = amount;
  let target: SectionId = section;
  for (let pass = 0; pass < 2 && remaining > 0; pass++) {
    const s = health.sections[target];
    if (!s.destroyed) {
      const toArmor = Math.min(s.armor, remaining);
      s.armor -= toArmor;
      remaining -= toArmor;
      const toStructure = Math.min(s.structure, remaining);
      s.structure -= toStructure;
      remaining -= toStructure;
      if (s.structure <= 0) {
        s.destroyed = true;
        result.destroyed.push(target);
      }
    }
    if (target === "torso") break;
    target = "torso";
  }

  if (health.sections.torso.destroyed) {
    health.alive = false;
    result.killed = true;
  }
  return result;
}

/** Remaining armor + structure of a section as a 0..1 fraction. */
export function sectionFraction(s: SectionState): number {
  return s.destroyed ? 0 : (s.armor + s.structure) / (s.maxArmor + s.maxStructure);
}

/** Overall survivability, driven by the torso since losing it is fatal. */
export const healthFraction = (health: Health): number => sectionFraction(health.sections.torso);

/** Movement multiplier from leg condition. */
export function mobilityFor(health: Health): number {
  const legs = health.sections.legs;
  if (legs.destroyed) return 0.45;
  return legs.structure < legs.maxStructure * 0.5 ? 0.75 : 1;
}

export function repairAll(health: Health): void {
  for (const id of SECTION_IDS) {
    const s = health.sections[id];
    s.armor = s.maxArmor;
    s.structure = s.maxStructure;
    s.destroyed = false;
  }
  health.alive = true;
}
