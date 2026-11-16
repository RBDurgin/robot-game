import { CharacterSupportedState, PhysicsCharacterController, Scene, Vector3 } from "@babylonjs/core";
import { FACTIONS, type FactionId } from "../data/factions";
import { HARDPOINT_IDS, type FrameDef, type HardpointDef, type HardpointId, type SectionId } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { WEAPONS, type WeaponDef } from "../data/weapons";
import { createHealth, mobilityFor, repairAll, type Health } from "../sim/damage";
import { fitToFrame, loadoutStats } from "../sim/loadout";
import type { Intent } from "../sim/intent";
import type { Vec3 } from "../sim/math";
import { createMechState, stepMech, type MechState } from "../sim/mech";
import { clearLock, createLock, type LockState } from "../sim/weapons";
import { MechVisual } from "../view/mechVisual";
import type { AiController } from "./aiController";
import { GRAVITY, markMechShape } from "./physics";

const DOWN = new Vector3(0, -1, 0);
/** Height of the model that hardpoint muzzle offsets are measured on. */
const REFERENCE_HEIGHT = 4.6;

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
  hardpoint: HardpointDef;
  cooldown: number;
  /** Beams: time held since the last damage pulse. */
  beamTime: number;
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
  /** Fitted weapon per hardpoint; null where nothing is fitted or the frame has no such mount. */
  readonly weapons: Record<HardpointId, MountedWeapon | null> = { armR: null, armL: null, shoulderR: null, shoulderL: null };
  /** The fitted weapons, in hardpoint order. */
  mounted: MountedWeapon[] = [];
  /** Guided-missile lock on another mech. */
  readonly lock: LockState<MechEntity> = createLock();
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
  private prevStride = 0;
  private readonly controller: PhysicsCharacterController;
  private readonly scratch = new Vector3();

  constructor(scene: Scene, spawn: MechSpawn) {
    this.name = spawn.name;
    this.frame = spawn.frame;
    this.faction = spawn.faction;
    this.damageScale = spawn.damageScale ?? 1;
    this.state = createMechState(spawn.frame, spawn.yaw);
    this.baseArmorScale = spawn.armorScale ?? 1;
    this.visual = new MechVisual(scene, spawn.name, FACTIONS[spawn.faction].colors, spawn.frame);
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

  /**
   * Fit a loadout (anything this frame cannot mount is left off). This rebuilds the mech's
   * armor, so it also fully repairs it.
   */
  applyLoadout(loadout: Loadout): void {
    this.loadout = fitToFrame(this.frame, loadout);
    const stats = loadoutStats(this.frame, this.loadout);
    this.loadMobility = stats.mobility;
    this.health = createHealth(this.frame, this.baseArmorScale * stats.armorScale);
    this.visual.setArmVisible("armL", true);
    this.visual.setArmVisible("armR", true);
    this.mounted = [];
    for (const id of HARDPOINT_IDS) {
      const hardpoint = this.frame.hardpoints.find((h) => h.id === id);
      const weaponId = this.loadout.weapons[id];
      const mount: MountedWeapon | null = hardpoint && weaponId ? { def: WEAPONS[weaponId], hardpoint, cooldown: 0, beamTime: 0 } : null;
      this.weapons[id] = mount;
      if (mount) this.mounted.push(mount);
      if (hardpoint) this.visual.setWeapon(id, mount ? mount.def.shape : null);
    }
  }

  /** True if the weapon can still fire: the part of the mech that carries it is intact. */
  weaponWorks(weapon: MountedWeapon): boolean {
    return !this.isDestroyed(weapon.hardpoint.section);
  }

  /**
   * Where shots leave a hardpoint. Computed from the torso pose rather than read from the
   * visual, so combat gives the same result whether or not the mech is being drawn.
   */
  muzzle(hardpoint: HardpointDef): Vector3 {
    const k = this.frame.height / REFERENCE_HEIGHT;
    const lx = hardpoint.muzzle[0] * k * this.frame.look.bulk;
    const lz = hardpoint.muzzle[2] * k;
    const sin = Math.sin(this.state.torsoYaw);
    const cos = Math.cos(this.state.torsoYaw);
    return new Vector3(this.feet.x + lx * cos + lz * sin, this.feet.y + hardpoint.muzzle[1] * k, this.feet.z - lx * sin + lz * cos);
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

  /**
   * Keep the mech within `limit` metres of the world's centre on both axes.
   * Returns true if it had to be moved back.
   */
  confine(limit: number): boolean {
    const p = this.controller.getPosition();
    const x = Math.min(limit, Math.max(-limit, p.x));
    const z = Math.min(limit, Math.max(-limit, p.z));
    if (x === p.x && z === p.z) return false;
    this.controller.setPosition(new Vector3(x, p.y, z));
    this.feet.x = x;
    this.feet.z = z;
    return true;
  }

  /** Take on damage carried over from an earlier life in the scene (see `MechRecord`). */
  adoptHealth(health: Health): void {
    this.health = health;
    for (const arm of ["armL", "armR"] as const) this.visual.setArmVisible(arm, !health.sections[arm].destroyed);
  }

  /** Restore to factory condition (used on respawn and when repairing at base). */
  restore(): void {
    repairAll(this.health);
    this.state.energy = this.frame.energyMax;
    this.state.heat = 0;
    this.state.overheated = false;
    this.state.boostCharges = this.frame.boostCharges ?? 1;
    this.state.boostCooldown = 0;
    clearLock(this.lock);
    this.visual.setArmVisible("armL", true);
    this.visual.setArmVisible("armR", true);
    this.visual.setVisible(true);
  }

  step(intent: Intent, dt: number): void {
    const s = this.state;
    s.mobility = mobilityFor(this.health) * this.loadMobility;
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    for (const w of this.mounted) w.cooldown = Math.max(0, w.cooldown - dt);

    this.prevStride = s.strideDistance;
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
        // Two footsteps make one full leg cycle.
        walkPhase: ((this.prevStride + (s.strideDistance - this.prevStride) * alpha) / this.frame.strideLength) * Math.PI,
        legsYaw: s.legsYaw,
        torsoYaw: s.torsoYaw,
        torsoPitch: s.torsoPitch,
        speed: this.horizontalSpeed,
        walkSpeed: this.frame.walkSpeed,
        grounded: s.grounded,
        thrust: s.boostTime > 0 ? 1 : s.jetting ? 0.7 : 0,
        braced: s.braced,
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
