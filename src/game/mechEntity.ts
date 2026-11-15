import { CharacterSupportedState, PhysicsCharacterController, Scene, Vector3 } from "@babylonjs/core";
import { FACTIONS, type FactionId } from "../data/factions";
import type { FrameDef, SectionId } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { WEAPONS, type WeaponDef } from "../data/weapons";
import { createHealth, mobilityFor, repairAll, type Health } from "../sim/damage";
import { loadoutStats } from "../sim/loadout";
import type { Intent } from "../sim/intent";
import type { Vec3 } from "../sim/math";
import { createMechState, stepMech, type MechState } from "../sim/mech";
import { MechVisual, type ArmSide } from "../view/mechVisual";
import type { AiController } from "./aiController";
import { GRAVITY, markMechShape } from "./physics";

const DOWN = new Vector3(0, -1, 0);
export const ARM_SIDES: readonly ArmSide[] = ["armR", "armL"];

export interface MechSpawn {
  name: string;
  frame: FrameDef;
  faction: FactionId;
  /** Feet position. */
  position: Vec3;
  yaw: number;
  loadout: Loadout;
  armorScale?: number;
  damageScale?: number;
}

export interface MountedWeapon {
  def: WeaponDef;
  cooldown: number;
}

/**
 * One mech in the world: simulation state + physics body + visual.
 * Player and AI mechs are identical; only the source of their Intent differs.
 */
export class MechEntity {
  readonly name: string;
  readonly frame: FrameDef;
  readonly faction: FactionId;
  readonly state: MechState;
  health!: Health;
  loadout!: Loadout;
  readonly visual: MechVisual;
  readonly weapons: Record<ArmSide, MountedWeapon | null> = { armL: null, armR: null };
  meleeCooldown = 0;
  /** Multiplier on damage this mech deals. */
  damageScale: number;
  /** Armor multiplier applied on top of the fitted plating (enemy tuning). */
  private readonly baseArmorScale: number;
  /** Movement multiplier from carried mass. */
  private loadMobility = 1;
  /** AI pilot, or null for the player. */
  brain: AiController | null = null;
  /** Feet position after the latest simulation step. */
  readonly feet = new Vector3();
  private readonly prevFeet = new Vector3();
  private readonly renderFeet = new Vector3();
  private readonly controller: PhysicsCharacterController;
  private readonly scratch = new Vector3();

  constructor(scene: Scene, spawn: MechSpawn) {
    this.name = spawn.name;
    this.frame = spawn.frame;
    this.faction = spawn.faction;
    this.damageScale = spawn.damageScale ?? 1;
    this.state = createMechState(spawn.frame, spawn.yaw);
    this.baseArmorScale = spawn.armorScale ?? 1;
    this.visual = new MechVisual(scene, spawn.name, FACTIONS[spawn.faction].colors);
    this.applyLoadout(spawn.loadout);

    const half = spawn.frame.height / 2;
    this.controller = new PhysicsCharacterController(
      new Vector3(spawn.position.x, spawn.position.y + half, spawn.position.z),
      { capsuleHeight: spawn.frame.height, capsuleRadius: spawn.frame.radius },
      scene,
    );
    markMechShape(this.controller.shape);
    this.controller.maxSlopeCosine = Math.cos((50 * Math.PI) / 180);
    this.controller.characterMass = spawn.frame.mass * 1000;
    this.feet.set(spawn.position.x, spawn.position.y, spawn.position.z);
    this.prevFeet.copyFrom(this.feet);
    this.renderFeet.copyFrom(this.feet);
  }

  get alive(): boolean {
    return this.health.alive;
  }

  /** Centre of the collision capsule. */
  get center(): Vector3 {
    return new Vector3(this.feet.x, this.feet.y + this.frame.height / 2, this.feet.z);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.state.vel.x, this.state.vel.z);
  }

  isDestroyed = (section: SectionId): boolean => this.health.sections[section].destroyed;

  /** Fit a loadout. This rebuilds the mech's armor, so it also fully repairs it. */
  applyLoadout(loadout: Loadout): void {
    this.loadout = { ...loadout };
    const stats = loadoutStats(this.frame, loadout);
    this.loadMobility = stats.mobility;
    this.health = createHealth(this.frame, this.baseArmorScale * stats.armorScale);
    this.visual.setArmVisible("armL", true);
    this.visual.setArmVisible("armR", true);
    for (const side of ARM_SIDES) {
      const id = loadout[side];
      const def: WeaponDef | null = id ? WEAPONS[id] : null;
      this.weapons[side] = def ? { def, cooldown: 0 } : null;
      this.visual.setWeapon(side, def ? def.shape : null);
    }
  }

  /**
   * Where shots leave a weapon. Computed from the torso pose rather than read from the
   * visual, so combat gives the same result whether or not the mech is being drawn.
   */
  muzzle(side: ArmSide): Vector3 {
    const k = this.frame.height / 4.6;
    const lx = (side === "armL" ? -1.5 : 1.5) * k;
    const lz = 2.6 * k;
    const sin = Math.sin(this.state.torsoYaw);
    const cos = Math.cos(this.state.torsoYaw);
    return new Vector3(this.feet.x + lx * cos + lz * sin, this.feet.y + 3.05 * k, this.feet.z - lx * sin + lz * cos);
  }

  teleport(feet: Vec3, yaw: number): void {
    this.controller.setPosition(new Vector3(feet.x, feet.y + this.frame.height / 2, feet.z));
    this.controller.setVelocity(Vector3.Zero());
    this.feet.set(feet.x, feet.y, feet.z);
    this.prevFeet.copyFrom(this.feet);
    const s = this.state;
    s.vel.x = s.vel.y = s.vel.z = 0;
    s.legsYaw = s.torsoYaw = yaw;
  }

  /** Restore to factory condition (used on respawn and when repairing at base). */
  restore(): void {
    repairAll(this.health);
    this.state.energy = this.frame.energyMax;
    this.state.heat = 0;
    this.state.overheated = false;
    this.visual.setArmVisible("armL", true);
    this.visual.setArmVisible("armR", true);
    this.visual.setVisible(true);
  }

  step(intent: Intent, dt: number): void {
    const s = this.state;
    s.mobility = mobilityFor(this.health) * this.loadMobility;
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    for (const side of ARM_SIDES) {
      const w = this.weapons[side];
      if (w) w.cooldown = Math.max(0, w.cooldown - dt);
    }

    const support = this.controller.checkSupport(dt, DOWN);
    const grounded = support.supportedState === CharacterSupportedState.SUPPORTED;

    stepMech(s, this.frame, intent, grounded, dt);

    // When walking on the ground, slide the horizontal velocity along the surface so the
    // mech follows slopes instead of launching off crests or digging into rises.
    const followGround = grounded && s.vel.y <= 0;
    const v = this.scratch.set(s.vel.x, s.vel.y, s.vel.z);
    if (followGround) {
      const n = support.averageSurfaceNormal;
      const into = Vector3.Dot(v, n);
      v.subtractInPlace(n.scale(into));
    }
    this.controller.setVelocity(v);
    this.controller.integrate(dt, support, GRAVITY);

    // Feed the collision-resolved velocity back so walls and ceilings actually stop the mech.
    const actual = this.controller.getVelocity();
    s.vel.x = actual.x;
    s.vel.z = actual.z;
    s.vel.y = followGround ? 0 : actual.y;

    this.prevFeet.copyFrom(this.feet);
    const p = this.controller.getPosition();
    this.feet.set(p.x, p.y - this.frame.height / 2, p.z);
  }

  /** Update the visual, interpolating between the last two simulation steps. */
  renderUpdate(alpha: number, frameDt: number): void {
    Vector3.LerpToRef(this.prevFeet, this.feet, alpha, this.renderFeet);
    const s = this.state;
    this.visual.update(
      {
        position: this.renderFeet,
        legsYaw: s.legsYaw,
        torsoYaw: s.torsoYaw,
        torsoPitch: s.torsoPitch,
        speed: this.horizontalSpeed,
        walkSpeed: this.frame.walkSpeed,
        grounded: s.grounded,
        thrust: s.boostTime > 0 ? 1 : s.jetting ? 0.7 : 0,
      },
      frameDt,
    );
  }

  /** Interpolated feet position used for rendering this frame. */
  get renderPosition(): Vector3 {
    return this.renderFeet;
  }

  dispose(): void {
    this.visual.dispose();
    this.controller.dispose();
  }
}
