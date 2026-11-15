import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import { areHostile } from "../data/factions";
import type { SectionId } from "../data/frames";
import { MELEE, type WeaponDef } from "../data/weapons";
import { applyDamage, type DamageResult } from "../sim/damage";
import { raycastMech, splashSection } from "../sim/hit";
import type { Intent } from "../sim/intent";
import { angleDiff, forwardFromYawPitch, yawFromDir } from "../sim/math";
import { addHeat } from "../sim/mech";
import type { Effects } from "../view/effects";
import type { ArmSide } from "../view/mechVisual";
import type { MechEntity } from "./mechEntity";
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

interface Projectile {
  pos: Vector3;
  vel: Vector3;
  def: WeaponDef;
  shooter: MechEntity;
  travelled: number;
  mesh: Mesh;
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
  ) {}

  /**
   * Nearest thing along a ray: static world geometry or a living mech hostile to `shooter`.
   * Friendly mechs are ignored, so there is no friendly fire.
   */
  trace(origin: Vector3, dir: Vector3, range: number, shooter: MechEntity): TraceHit | null {
    let best: TraceHit | null = null;
    const world = raycastWorld(this.scene, origin, origin.add(dir.scale(range)));
    if (world) best = { point: world.point, distance: world.distance, mech: null, section: null };

    for (const mech of this.mechs()) {
      if (mech === shooter || !mech.alive || !areHostile(mech.faction, shooter.faction)) continue;
      const hit = raycastMech(origin, dir, best ? best.distance : range, mech.feet, mech.state.torsoYaw, mech.frame, mech.isDestroyed);
      if (hit && (!best || hit.distance < best.distance)) {
        best = { point: origin.add(dir.scale(hit.distance)), distance: hit.distance, mech, section: hit.section };
      }
    }
    return best;
  }

  /** Handle one mech's trigger pulls for this step. Call after the mech has moved. */
  stepMech(mech: MechEntity, intent: Intent): void {
    if (!mech.alive || mech.state.overheated) return;
    if (intent.firePrimary) this.fireWeapon(mech, "armR", intent);
    if (intent.fireSecondary) this.fireWeapon(mech, "armL", intent);
    if (intent.melee) this.melee(mech);
  }

  private fireWeapon(mech: MechEntity, side: ArmSide, intent: Intent): void {
    const weapon = mech.weapons[side];
    if (!weapon || weapon.cooldown > 0 || mech.isDestroyed(side) || mech.state.overheated) return;
    weapon.cooldown = weapon.def.cooldown;
    addHeat(mech.state, mech.frame, weapon.def.heat);
    mech.visual.kickRecoil(side);

    const def = weapon.def;
    const muzzle = mech.muzzle(side);
    const dir = this.shotDirection(muzzle, intent, def.spread);
    this.effects.spark(muzzle, 0.9, def.color);
    this.events.onFire(mech, def, muzzle);

    if (def.kind === "hitscan") {
      const hit = this.trace(muzzle, dir, def.range, mech);
      const end = hit ? hit.point : muzzle.add(dir.scale(def.range));
      this.effects.tracer(muzzle, end, def.color);
      if (hit) {
        this.effects.spark(hit.point, hit.mech ? 1.6 : 1.0, hit.mech ? 0xffffff : def.color);
        if (hit.mech && hit.section) this.damage(hit.mech, hit.section, def.damage, mech);
      }
    } else {
      const mesh = this.effects.acquireShell(def.color);
      mesh.position.copyFrom(muzzle);
      mesh.lookAt(muzzle.add(dir));
      this.projectiles.push({ pos: muzzle.clone(), vel: dir.scale(def.projectileSpeed ?? 80), def, shooter: mech, travelled: 0, mesh });
    }
  }

  /** Direction from the muzzle to the pilot's aim point, with weapon spread applied. */
  private shotDirection(muzzle: Vector3, intent: Intent, spread: number): Vector3 {
    let dir: Vector3 | null = null;
    if (intent.aimPoint) {
      const to = new Vector3(intent.aimPoint.x - muzzle.x, intent.aimPoint.y - muzzle.y, intent.aimPoint.z - muzzle.z);
      // Very close aim points would make the two arms cross; fall back to firing straight.
      if (to.length() > 4) dir = to.normalize();
    }
    if (!dir) {
      const f = forwardFromYawPitch(intent.aimYaw, intent.aimPitch);
      dir = new Vector3(f.x, f.y, f.z);
    }
    if (spread > 0) {
      dir.x += (this.rng() * 2 - 1) * spread;
      dir.y += (this.rng() * 2 - 1) * spread;
      dir.z += (this.rng() * 2 - 1) * spread;
      dir.normalize();
    }
    return dir;
  }

  private melee(mech: MechEntity): void {
    if (mech.meleeCooldown > 0) return;
    mech.meleeCooldown = MELEE.cooldown;
    addHeat(mech.state, mech.frame, MELEE.heat);
    mech.visual.kickRecoil("armL");
    mech.visual.kickRecoil("armR");
    for (const other of this.mechs()) {
      if (other === mech || !other.alive || !areHostile(other.faction, mech.faction)) continue;
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
    const dealt = amount * attacker.damageScale;
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
      if (mech === p.shooter || mech === direct?.mech || !mech.alive || !areHostile(mech.faction, p.shooter.faction)) continue;
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
