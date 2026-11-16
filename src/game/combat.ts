import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import type { SectionId } from "../data/frames";
import { MELEE, WEAPON_RULES, type WeaponDef } from "../data/weapons";
import { applyDamage, type DamageResult } from "../sim/damage";
import { raycastMech, splashSection } from "../sim/hit";
import { TRIGGER_FIELD, type Intent } from "../sim/intent";
import { angleDiff, forwardFromYawPitch, yawFromDir, type Vec3 } from "../sim/math";
import { addHeat } from "../sim/mech";
import { angleBetween, beamPulses, clearLock, pelletDirections, spreadDirection, steerMissile, stepLock } from "../sim/weapons";
import type { Effects } from "../view/effects";
import type { MechEntity, MountedWeapon } from "./mechEntity";
import { raycastWorld } from "./physics";

export interface TraceHit {
  point: Vector3;
  distance: number;
  mech: MechEntity | null;
  section: SectionId | null;
}

export interface CombatEvents {
  onDamage(victim: MechEntity, attacker: MechEntity, amount: number, result: DamageResult): void;
  onKill(victim: MechEntity, attacker: MechEntity): void;
  onFire(shooter: MechEntity, weapon: WeaponDef, at: Vector3): void;
  onExplosion(at: Vector3, radius: number): void;
}

/** Who may hurt whom. Supplied by the world, because the player's relations change as they play. */
export interface CombatRules {
  /** The two attack each other on sight: weapons lock on, and blasts and melee swings hurt. */
  hostile(a: MechEntity, b: MechEntity): boolean;
  /** A shot from `shooter` stops on `target` rather than passing through. */
  canHit(shooter: MechEntity, target: MechEntity): boolean;
  /** Multiplier on damage `attacker` deals to `victim`. */
  damageScale(attacker: MechEntity, victim: MechEntity): number;
}

interface Projectile {
  pos: Vector3;
  vel: Vector3;
  def: WeaponDef;
  shooter: MechEntity;
  travelled: number;
  mesh: Mesh;
  /** Guided missiles: the mech being chased, if the shooter had a lock. */
  target: MechEntity | null;
}

/** Weapons fire, projectiles, melee and damage for every mech. */
export class Combat {
  private readonly projectiles: Projectile[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly effects: Effects,
    private readonly mechs: () => readonly MechEntity[],
    private readonly rng: () => number,
    private readonly events: CombatEvents,
    private readonly rules: CombatRules,
  ) {}

  /**
   * Nearest thing along a ray: static world geometry or a living mech `shooter` can hit.
   * AI pilots' shots pass through anyone they are not at war with, so they have no friendly
   * fire; the player's shots hit whoever is in the way (see `CombatRules.canHit`).
   */
  trace(origin: Vector3, dir: Vector3, range: number, shooter: MechEntity): TraceHit | null {
    let best: TraceHit | null = null;
    const world = raycastWorld(this.scene, origin, origin.add(dir.scale(range)));
    if (world) best = { point: world.point, distance: world.distance, mech: null, section: null };

    for (const mech of this.mechs()) {
      if (mech === shooter || !mech.alive || !this.rules.canHit(shooter, mech)) continue;
      const hit = raycastMech(origin, dir, best ? best.distance : range, mech.feet, mech.state.torsoYaw, mech.frame, mech.isDestroyed);
      if (hit && (!best || hit.distance < best.distance)) {
        best = { point: origin.add(dir.scale(hit.distance)), distance: hit.distance, mech, section: hit.section };
      }
    }
    return best;
  }

  /** Handle one mech's trigger pulls for this step. Call after the mech has moved. */
  stepMech(mech: MechEntity, intent: Intent): void {
    if (!mech.alive) return;
    this.updateLock(mech, intent);
    for (const weapon of mech.mounted) {
      const held = intent[TRIGGER_FIELD[weapon.hardpoint.trigger]] && !mech.state.overheated && mech.weaponWorks(weapon);
      if (weapon.def.kind === "beam") {
        if (held) this.fireBeam(mech, weapon, intent);
        else weapon.beamTime = 0;
      } else if (held && weapon.cooldown <= 0) {
        this.fireWeapon(mech, weapon, intent);
      }
    }
    if (intent.melee && !mech.state.overheated) this.melee(mech);
  }

  /**
   * Guided weapons lock onto the hostile nearest the crosshair, if it is inside the lock cone,
   * in range and in plain sight. The lock builds while the crosshair stays on it.
   */
  private updateLock(mech: MechEntity, intent: Intent): void {
    const seeker = mech.mounted.find((w) => w.def.turnRate !== undefined && mech.weaponWorks(w));
    if (!seeker) {
      clearLock(mech.lock);
      return;
    }
    const eye = mech.center;
    const aim = this.aimDirection(eye, intent);
    let candidate: MechEntity | null = null;
    let best = WEAPON_RULES.lockCone;
    for (const other of this.mechs()) {
      if (other === mech || !other.alive || !this.rules.hostile(mech, other)) continue;
      const to = other.center.subtract(eye);
      const dist = to.length();
      if (dist > seeker.def.range || dist < 1) continue;
      const off = angleBetween(aim, to.scaleInPlace(1 / dist));
      if (off < best) {
        best = off;
        candidate = other;
      }
    }
    if (candidate && raycastWorld(this.scene, eye, candidate.center)) candidate = null;
    if (mech.lock.target && !mech.lock.target.alive) clearLock(mech.lock);
    stepLock(mech.lock, candidate, 1 / 60, WEAPON_RULES.lockGrace);
  }

  /** The mech `mech` has a full lock on, or null. */
  lockedTarget(mech: MechEntity): MechEntity | null {
    const seeker = mech.mounted.find((w) => w.def.turnRate !== undefined);
    return seeker && mech.lock.target && mech.lock.time >= (seeker.def.lockTime ?? 0) ? mech.lock.target : null;
  }

  /** Weapon spread for this mech right now: a braced frame shoots straighter. */
  private spreadFor(mech: MechEntity, def: WeaponDef): number {
    return def.spread * (mech.state.braced ? (mech.frame.brace?.spreadScale ?? 1) : 1);
  }

  private fireWeapon(mech: MechEntity, weapon: MountedWeapon, intent: Intent): void {
    const def = weapon.def;
    weapon.cooldown = def.cooldown;
    addHeat(mech.state, mech.frame, def.heat);
    mech.visual.kickRecoil(weapon.hardpoint.id);

    const muzzle = mech.muzzle(weapon.hardpoint);
    const aim = this.aimDirection(muzzle, intent);
    const spread = this.spreadFor(mech, def);
    this.effects.spark(muzzle, 0.9, def.color);
    this.events.onFire(mech, def, muzzle);

    if (def.kind === "hitscan") {
      // Pellets that land on the same section are applied as one hit.
      const hits = new Map<string, { mech: MechEntity; section: SectionId; count: number }>();
      for (const d of pelletDirections(aim, spread, def.pellets ?? 1, this.rng)) {
        const dir = new Vector3(d.x, d.y, d.z);
        const hit = this.trace(muzzle, dir, def.range, mech);
        const end = hit ? hit.point : muzzle.add(dir.scale(def.range));
        this.effects.tracer(muzzle, end, def.color);
        if (!hit) continue;
        this.effects.spark(hit.point, hit.mech ? 1.6 : 1.0, hit.mech ? 0xffffff : def.color);
        if (hit.mech && hit.section) {
          const key = `${hit.mech.name}/${hit.section}`;
          const entry = hits.get(key) ?? { mech: hit.mech, section: hit.section, count: 0 };
          entry.count++;
          hits.set(key, entry);
        }
      }
      for (const h of hits.values()) this.damage(h.mech, h.section, def.damage * h.count, mech);
    } else {
      const d = spreadDirection(aim, spread, this.rng);
      const dir = new Vector3(d.x, d.y, d.z);
      const mesh = this.effects.acquireShell(def.color);
      mesh.position.copyFrom(muzzle);
      mesh.lookAt(muzzle.add(dir));
      const target = def.turnRate !== undefined ? this.lockedTarget(mech) : null;
      this.projectiles.push({ pos: muzzle.clone(), vel: dir.scale(def.projectileSpeed ?? 80), def, shooter: mech, travelled: 0, mesh, target });
    }
  }

  /** A beam is drawn and heats the mech every step it is held; its damage lands in pulses. */
  private fireBeam(mech: MechEntity, weapon: MountedWeapon, intent: Intent): void {
    const def = weapon.def;
    const dt = 1 / 60;
    addHeat(mech.state, mech.frame, def.heat * dt);
    const muzzle = mech.muzzle(weapon.hardpoint);
    const aim = this.aimDirection(muzzle, intent);
    const dir = new Vector3(aim.x, aim.y, aim.z);
    const hit = this.trace(muzzle, dir, def.range, mech);
    const end = hit ? hit.point : muzzle.add(dir.scale(def.range));
    this.effects.beam(muzzle, end, def.color);
    if (hit) this.effects.spark(hit.point, 0.8, def.color);
    const pulses = beamPulses(weapon, dt, WEAPON_RULES.beamPulse);
    if (pulses === 0) return;
    this.events.onFire(mech, def, muzzle);
    if (hit?.mech && hit.section) this.damage(hit.mech, hit.section, def.damage * WEAPON_RULES.beamPulse * pulses, mech);
  }

  /** Unit direction from `from` to the pilot's aim point (or straight ahead if there is none). */
  private aimDirection(from: Vector3, intent: Intent): Vec3 {
    if (intent.aimPoint) {
      const x = intent.aimPoint.x - from.x;
      const y = intent.aimPoint.y - from.y;
      const z = intent.aimPoint.z - from.z;
      const l = Math.hypot(x, y, z);
      // Very close aim points would make the two arms cross; fall back to firing straight.
      if (l > 4) return { x: x / l, y: y / l, z: z / l };
    }
    return forwardFromYawPitch(intent.aimYaw, intent.aimPitch);
  }

  private melee(mech: MechEntity): void {
    if (mech.meleeCooldown > 0) return;
    mech.meleeCooldown = MELEE.cooldown;
    addHeat(mech.state, mech.frame, MELEE.heat);
    mech.visual.kickRecoil("armL");
    mech.visual.kickRecoil("armR");
    for (const other of this.mechs()) {
      if (other === mech || !other.alive || !this.rules.hostile(mech, other)) continue;
      const dx = other.feet.x - mech.feet.x;
      const dz = other.feet.z - mech.feet.z;
      if (Math.hypot(dx, dz) > MELEE.range || Math.abs(other.feet.y - mech.feet.y) > mech.frame.height) continue;
      if (Math.abs(angleDiff(mech.state.torsoYaw, yawFromDir(dx, dz))) > MELEE.arc / 2) continue;
      this.effects.spark(other.center, 3, 0xffffff);
      this.damage(other, "torso", MELEE.damage, mech);
    }
  }

  damage(victim: MechEntity, section: SectionId, amount: number, attacker: MechEntity): void {
    if (!victim.alive) return;
    // A braced frame shrugs off part of every hit.
    const brace = victim.state.braced ? (victim.frame.brace?.damageTaken ?? 1) : 1;
    const dealt = amount * this.rules.damageScale(attacker, victim) * brace;
    const result = applyDamage(victim.health, section, dealt);
    for (const destroyed of result.destroyed) {
      if (destroyed === "armL" || destroyed === "armR") victim.visual.setArmVisible(destroyed, false);
    }
    this.events.onDamage(victim, attacker, dealt, result);
    if (result.killed) {
      this.effects.blast(victim.center, 7);
      this.events.onExplosion(victim.center, 12);
      this.events.onKill(victim, attacker);
    }
  }

  private explode(p: Projectile, at: Vector3, direct: TraceHit | null): void {
    const radius = p.def.splashRadius ?? 0;
    this.effects.blast(at, Math.max(1.5, radius * 0.6), p.def.color);
    this.events.onExplosion(at, radius);
    if (direct?.mech && direct.section) this.damage(direct.mech, direct.section, p.def.damage, p.shooter);
    if (radius <= 0) return;
    for (const mech of this.mechs()) {
      if (mech === p.shooter || mech === direct?.mech || !mech.alive || !this.rules.hostile(p.shooter, mech)) continue;
      const reach = radius + mech.frame.radius;
      const d = Vector3.Distance(mech.center, at);
      if (d >= reach) continue;
      this.damage(mech, splashSection(at, mech.feet, mech.frame), p.def.damage * 0.6 * (1 - d / reach), p.shooter);
    }
  }

  /** Advance projectiles by one step. */
  step(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.target?.alive && p.def.turnRate !== undefined) {
        const v = steerMissile(p.vel, p.pos, p.target.center, p.def.turnRate, dt);
        p.vel.set(v.x, v.y, v.z);
        p.mesh.lookAt(p.pos.add(p.vel));
      }
      const speed = p.vel.length();
      const stepLen = speed * dt;
      const dir = p.vel.scale(1 / speed);
      const hit = this.trace(p.pos, dir, stepLen, p.shooter);
      if (hit) {
        this.explode(p, hit.point, hit);
      } else {
        p.pos.addInPlace(p.vel.scale(dt));
        p.travelled += stepLen;
        p.mesh.position.copyFrom(p.pos);
        if (p.travelled < p.def.range) continue;
        this.explode(p, p.pos, null);
      }
      this.effects.releaseShell(p.mesh);
      this.projectiles.splice(i, 1);
    }
  }

  /** Remove all live projectiles (used when the encounter resets). */
  clear(): void {
    for (const p of this.projectiles) this.effects.releaseShell(p.mesh);
    this.projectiles.length = 0;
  }
}
