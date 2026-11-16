import { Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { ENEMY_TUNING, SLICE_SQUADS } from "../data/encounters";
import { FACTIONS } from "../data/factions";
import { FEEL } from "../data/feel";
import { FRAMES, SECTION_IDS, type FrameId, type SectionId } from "../data/frames";
import { ENEMY_LOADOUTS, type Loadout } from "../data/loadouts";
import { WEAPONS, type WeaponId } from "../data/weapons";
import { SLICE_ZONE, type ZoneDef } from "../data/zone";
import { AI_ROLES } from "../sim/ai/brain";
import { healthFraction, sectionFraction } from "../sim/damage";
import type { Intent } from "../sim/intent";
import { addItem, itemName } from "../sim/loadout";
import { lockProgress } from "../sim/weapons";
import { pickAttackers } from "../sim/ai/squad";
import { rollLoot } from "../sim/loot";
import { makeRng, type Vec3 } from "../sim/math";
import { heightAt } from "../sim/terrain";
import { Sfx } from "../view/audio";
import { Effects } from "../view/effects";
import { Hud, type RadarBlip } from "../view/hud/hud";
import { Screens } from "../view/screens";
import { buildStructures, buildTerrain } from "../view/terrain";
import { WreckField } from "../view/wreck";
import { AiController } from "./aiController";
import { CameraRig } from "./camera/cameraRig";
import { Combat } from "./combat";
import { PlayerInput } from "./input";
import { MechEntity } from "./mechEntity";
import { perfEnd, perfMark, perfStart } from "./perf";
import { enablePhysics, raycastWorld, stepPhysics } from "./physics";
import { SalvageField } from "./salvage";
import { loadSave, writeSave, type SaveData, type Settings } from "./save";

const SKY = new Color3(0.62, 0.71, 0.8);
const RESPAWN_DELAY = 3.5;
/** Damage in one hit that counts as a heavy blow for feedback (sound, shake). */
const HEAVY_HIT = 45;
const SECTION_NAMES: Record<SectionId, string> = { torso: "torso", armL: "left arm", armR: "right arm", legs: "legs" };

/** paused: menu open. hangar: refitting at base. complete: mission summary showing. */
export type GameMode = "playing" | "paused" | "hangar" | "complete";
/** assault: enemies remain. return: outpost cleared, head home. done: summary has been shown. */
export type MissionPhase = "assault" | "return" | "done";

/** Owns the scene and everything in it, and advances the game one fixed step at a time. */
export class World {
  readonly mechs: MechEntity[] = [];
  readonly effects: Effects;
  readonly combat: Combat;
  readonly salvage: SalvageField;
  readonly wrecks: WreckField;
  readonly sfx = new Sfx();
  readonly rng: () => number;
  readonly save: SaveData;
  /** The player's mech. Replaced by a new one when the player changes frame in the hangar. */
  player: MechEntity;
  /** Called after the player's mech is rebuilt on a different frame. */
  onPlayerFrameChanged: (() => void) | null = null;
  mode: GameMode = "paused";
  phase: MissionPhase = "assault";
  tick = 0;
  /** Test hook: fields set here replace the player's real input. */
  intentOverride: Partial<Intent> | null = null;
  /** Hostile mech currently under the crosshair. */
  aimedMech: MechEntity | null = null;
  kills = 0;
  deaths = 0;
  itemsSalvaged = 0;

  private started = false;
  private respawnTimer = 0;
  private hitFlash = 0;
  private damageFlash = 0;
  private killFlash = 0;
  /** Enemy pilots currently allowed to fire. */
  private attackers = new Set<MechEntity>();
  /** Player heat state last step, to spot the moment a warning should sound. */
  private wasHot = false;
  private wasOverheated = false;
  private message: { text: string; time: number } | null = null;
  private readonly spawnYaw: number;

  private constructor(
    readonly scene: Scene,
    readonly zone: ZoneDef,
    readonly input: PlayerInput,
    readonly cameraRig: CameraRig,
    readonly hud: Hud,
    readonly screens: Screens,
    player: MechEntity,
    save: SaveData,
  ) {
    this.save = save;
    this.player = player;
    this.rng = makeRng(zone.seed);
    this.effects = new Effects(scene);
    this.salvage = new SalvageField(scene);
    this.wrecks = new WreckField(scene, FEEL.maxWrecks);
    this.spawnYaw = player.state.torsoYaw;
    this.mechs.push(player);

    this.combat = new Combat(scene, this.effects, () => this.mechs, this.rng, {
      onDamage: (victim, attacker, amount, result) => {
        const strength = Math.min(1, amount / HEAVY_HIT);
        const lost = result.destroyed.filter((id) => id !== "torso");
        if (victim === this.player) {
          this.damageFlash = Math.max(this.damageFlash, 0.45 + 0.55 * strength);
          this.cameraRig.shake(Math.min(FEEL.hitShakeMax, FEEL.hitShakeBase + amount * FEEL.hitShakePerDamage));
          this.sfx.hitTaken(strength);
          for (const id of lost) {
            this.notify(id === "legs" ? "Legs crippled: movement reduced." : `${id === "armL" ? "Left" : "Right"} arm destroyed: weapon lost.`, 4);
          }
        }
        if (attacker === this.player) {
          this.hitFlash = 1;
          this.sfx.hitLanded(strength);
          for (const id of lost) this.notify(`${victim.name}: ${SECTION_NAMES[id]} destroyed.`, 3);
        }
        this.raiseAlarm(victim);
      },
      onKill: (victim, attacker) => this.onKill(victim, attacker),
      onFire: (shooter, weapon, at) => {
        const d = shooter === this.player ? 0 : Vector3.Distance(at, this.player.feet);
        const perShot = weapon.damage * (weapon.pellets ?? 1);
        this.sfx.shot(weapon.kind === "projectile" ? "projectile" : "hitscan", weapon.kind !== "beam" && perShot > 30, d);
      },
      onExplosion: (at, radius) => {
        const d = Vector3.Distance(at, this.player.center);
        this.sfx.explosion(d, radius);
        this.cameraRig.shake(Math.max(0, 1 - d / 60) * 0.8);
      },
    });

    this.applySettings(save.settings);
    this.cameraRig.mode = save.settings.defaultView;

    input.onPress("KeyV", () => {
      if (this.mode === "playing") this.cameraRig.toggle();
    });
    input.onPress("KeyH", () => {
      if (this.mode === "playing" && this.atBase && this.player.alive) this.openHangar();
    });
    input.onPress("KeyP", () => {
      if (this.mode === "playing") this.pause();
    });
    // Esc makes the browser release the mouse; treat that as a pause request.
    input.onPointerReleased = () => {
      if (this.mode === "playing") this.pause();
    };
    window.addEventListener("blur", () => {
      if (this.mode === "playing" && this.started) this.pause();
    });

    this.spawnSquads();
    this.pause();
  }

  static async create(engine: Engine, canvas: HTMLCanvasElement, overlay: HTMLElement): Promise<World> {
    const zone = SLICE_ZONE;
    const scene = new Scene(engine);
    scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = SKY;
    scene.fogStart = 220;
    scene.fogEnd = 900;
    scene.skipPointerMovePicking = true;
    await enablePhysics(scene);

    const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
    sky.intensity = 0.65;
    sky.groundColor = new Color3(0.35, 0.33, 0.3);
    const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35), scene);
    sun.intensity = 0.95;

    buildTerrain(scene, zone);
    buildStructures(scene, zone);

    const save = loadSave();
    // `?arsenal` in the URL stocks the hangar with two of every weapon and plating, for playtests.
    if (new URLSearchParams(location.search).has("arsenal")) {
      for (const id of [...Object.keys(WEAPONS), "lightPlating", "standardPlating", "heavyPlating"] as (WeaponId | "lightPlating")[]) {
        save.inventory[id] = Math.max(save.inventory[id] ?? 0, 2);
      }
    }
    const base = zone.playerBase;
    // Face the enemy outpost on spawn.
    const spawnYaw = Math.atan2(zone.enemyOutpost.x - base.x, zone.enemyOutpost.z - base.z);
    const player = new MechEntity(scene, {
      name: "player",
      frame: FRAMES[save.frame],
      faction: "drifters",
      position: World.groundPoint(zone, base.x, base.z, 0.6),
      yaw: spawnYaw,
      loadout: save.loadout,
    });

    const input = new PlayerInput(canvas);
    input.yaw = spawnYaw;
    input.pitch = -0.1;

    const world = new World(scene, zone, input, new CameraRig(scene), new Hud(scene), new Screens(overlay), player, save);
    // Compile the shaders that are first needed mid-fight, while the start screen is up.
    await Promise.all([world.effects.prewarm(), world.wrecks.prewarm(), world.salvage.prewarm(), player.visual.prewarm()]);
    return world;
  }

  static groundPoint(zone: ZoneDef, x: number, z: number, lift = 0): Vec3 {
    return { x, y: heightAt(zone, x, z) + lift, z };
  }

  get enemies(): MechEntity[] {
    return this.mechs.filter((m) => m !== this.player && m.alive);
  }

  /** True when the player is close enough to the base to use the hangar. */
  get atBase(): boolean {
    const base = this.zone.playerBase;
    return Math.hypot(this.player.feet.x - base.x, this.player.feet.z - base.z) < base.radius;
  }

  // --- Menus and game mode ---

  private applySettings(settings: Settings): void {
    this.save.settings = settings;
    this.input.sensitivity = settings.sensitivity;
    this.sfx.setVolume(settings.volume);
  }

  pause(): void {
    this.mode = "paused";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.screens.showPause({
      isStart: !this.started,
      settings: this.save.settings,
      onSettings: (s) => {
        this.applySettings(s);
        writeSave(this.save);
      },
      onResume: () => this.resume(),
      onReset: () => {
        try {
          localStorage.clear();
        } catch {
          // Nothing stored, nothing to clear.
        }
        location.reload();
      },
    });
  }

  /** Close any menu and play. Call from a click or key press so the mouse can be captured. */
  resume(): void {
    if (!this.started) {
      this.started = true;
      this.cameraRig.mode = this.save.settings.defaultView;
    }
    this.screens.hide();
    this.mode = "playing";
    this.input.enabled = true;
    this.input.lockPointer();
    this.sfx.unlock();
  }

  openHangar(): void {
    this.mode = "hangar";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.sfx.ui();
    this.screens.showHangar({
      frame: this.save.frame,
      loadout: this.save.loadout,
      inventory: this.save.inventory,
      scrap: this.save.scrap,
      onDeploy: (frame, loadout) => this.deploy(frame, loadout),
    });
  }

  /** Fit the frame and loadout chosen in the hangar, repair, and return to play. */
  deploy(frame: FrameId, loadout: Loadout): void {
    const changed = frame !== this.save.frame;
    this.save.frame = frame;
    this.save.loadout = loadout;
    writeSave(this.save);
    if (changed) {
      this.rebuildPlayer(frame);
    } else {
      this.player.applyLoadout(loadout);
      this.player.restore();
    }
    this.notify(changed ? `${this.player.frame.name} frame ready.` : "Suit refitted and repaired.");
    this.resume();
  }

  /** Swap the player's mech for one built on another frame, standing where the old one stood. */
  private rebuildPlayer(frame: FrameId): void {
    const old = this.player;
    const at = { x: old.feet.x, y: old.feet.y + 0.3, z: old.feet.z };
    const yaw = old.state.torsoYaw;
    old.dispose();
    this.player = new MechEntity(this.scene, {
      name: "player",
      frame: FRAMES[frame],
      faction: "drifters",
      position: at,
      yaw,
      loadout: this.save.loadout,
    });
    this.mechs[this.mechs.indexOf(old)] = this.player;
    for (const mech of this.mechs) if (mech.lock.target === old) mech.lock.target = null;
    void this.player.visual.prewarm();
    this.onPlayerFrameChanged?.();
  }

  private completeMission(): void {
    this.phase = "done";
    this.mode = "complete";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.screens.showComplete(
      { seconds: this.tick / 60, kills: this.kills, deaths: this.deaths, scrap: this.save.scrap, items: this.itemsSalvaged },
      () => location.reload(),
      () => this.resume(),
    );
  }

  // --- Encounter ---

  private spawnSquads(): void {
    const post = this.zone.enemyOutpost;
    const home = World.groundPoint(this.zone, post.x, post.z - 20);
    for (const squad of SLICE_SQUADS) {
      const patrol = squad.patrol.map(([dx, dz]) => World.groundPoint(this.zone, post.x + dx, post.z + dz));
      squad.members.forEach((member, i) => {
        const startIndex = Math.floor((i * patrol.length) / squad.members.length);
        const start = patrol[startIndex]!;
        const mech = new MechEntity(this.scene, {
          name: `${FACTIONS[squad.faction].name} ${member.loadout}`,
          frame: FRAMES[member.frame],
          faction: squad.faction,
          position: { x: start.x, y: start.y + 0.6, z: start.z },
          yaw: this.rng() * Math.PI * 2,
          loadout: ENEMY_LOADOUTS[member.loadout],
          armorScale: ENEMY_TUNING.armorScale,
          damageScale: ENEMY_TUNING.damageScale,
        });
        mech.brain = new AiController(patrol, home, startIndex + 1, squad.id, AI_ROLES[member.role]);
        this.mechs.push(mech);
        this.hud.addMarker(mech.visual.markerNode);
      });
    }
  }

  /**
   * A mech under attack (or one that spots the enemy) alerts its own squad, wherever they are.
   * Other squads only join once they see the enemy for themselves, so squads can be fought
   * one at a time.
   */
  private raiseAlarm(source: MechEntity): void {
    if (!source.brain) return;
    for (const mech of this.mechs) {
      if (mech.brain && mech.brain.squadId === source.brain.squadId) mech.brain.alert();
    }
  }

  /** The terrain or structure surface directly below a point (or the point itself if none). */
  private groundBelow(at: Vector3): Vector3 {
    const hit = raycastWorld(this.scene, at, new Vector3(at.x, at.y - 400, at.z));
    return hit ? hit.point : at.clone();
  }

  private onKill(victim: MechEntity, attacker: MechEntity): void {
    perfMark("kill");
    // Mechs can die in the air; the wreck and its salvage come to rest on the ground below.
    const ground = this.groundBelow(victim.center);
    this.wrecks.spawn(ground, victim.state.legsYaw, victim.frame.height);
    if (attacker === this.player && victim !== this.player) {
      this.killFlash = 1;
      this.sfx.kill();
    }
    if (victim === this.player) {
      this.deaths++;
      this.respawnTimer = RESPAWN_DELAY;
      this.notify("Suit destroyed. Recovering to base...", RESPAWN_DELAY);
      return;
    }
    this.kills++;
    // The crate floats just above the wreck.
    this.salvage.spawn(new Vector3(ground.x, ground.y + 2.6, ground.z), rollLoot(victim.loadout, this.rng));
    const left = this.enemies.length;
    if (left > 0) {
      this.notify(`Hostile destroyed. ${left} remaining.`, 4);
    } else {
      this.phase = "return";
      this.notify("Outpost cleared! Collect salvage and return to base.", 6);
    }
  }

  notify(text: string, seconds = 3): void {
    this.message = { text, time: seconds };
  }

  private respawnPlayer(): void {
    const base = this.zone.playerBase;
    this.player.restore();
    this.player.teleport(World.groundPoint(this.zone, base.x, base.z, 0.6), this.spawnYaw);
    this.input.yaw = this.spawnYaw;
    this.input.pitch = -0.1;
    this.notify("Suit restored at base.");
  }

  private collectSalvage(): void {
    const drops = this.salvage.collectNear(this.player.feet);
    if (drops.length === 0) return;
    const names: string[] = [];
    let scrap = 0;
    for (const drop of drops) {
      scrap += drop.scrap;
      for (const item of drop.items) {
        addItem(this.save.inventory, item);
        names.push(itemName(item));
        this.itemsSalvaged++;
      }
    }
    this.save.scrap += scrap;
    writeSave(this.save);
    this.sfx.pickup();
    this.notify(`Salvaged: ${[...names, `${scrap} scrap`].join(", ")}`, 5);
  }

  /** Footfalls and landings: sound for every mech in earshot, dust, and a camera kick for the player. */
  private groundFeedback(mech: MechEntity): void {
    const s = mech.state;
    const isPlayer = mech === this.player;
    const distance = isPlayer ? 0 : Vector3.Distance(mech.feet, this.player.feet);
    if (s.landImpact >= FEEL.landMinSpeed) {
      const strength = Math.min(1, s.landImpact / FEEL.landFullSpeed);
      this.sfx.land(strength, distance);
      this.effects.dust(mech.feet, mech.frame.radius * (1.2 + 1.8 * strength));
      if (isPlayer) this.cameraRig.shake(FEEL.landShake * strength);
    } else if (s.footstep) {
      this.sfx.footstep(Math.min(1, mech.horizontalSpeed / mech.frame.sprintSpeed), distance);
    }
  }

  /** Warn as the player's heat nears the cap, sound the alarm at lockout, and the all-clear after. */
  private heatFeedback(): void {
    const s = this.player.state;
    const hot = s.heat >= this.player.frame.heatCapacity * FEEL.heatWarnFraction;
    if (s.overheated && !this.wasOverheated) this.sfx.overheat();
    else if (!s.overheated && this.wasOverheated) this.sfx.cooled();
    else if (hot && !this.wasHot && !s.overheated) this.sfx.heatWarning();
    this.wasHot = hot;
    this.wasOverheated = s.overheated;
  }

  /** One fixed simulation step. Does nothing unless the game is in play. */
  step(dt: number): void {
    if (this.mode !== "playing") return;
    this.tick++;

    let t = perfStart();
    if (this.player.alive) {
      const ray = this.cameraRig.aimRay(this.input.yaw, this.input.pitch);
      const hit = this.combat.trace(ray.origin, ray.direction, 600, this.player);
      const aim = hit ? hit.point : ray.far;
      this.aimedMech = hit?.mech ?? null;
      const intent: Intent = {
        ...this.input.buildIntent({ x: aim.x, y: aim.y, z: aim.z }),
        ...this.intentOverride,
      };
      // Scripted aim (tests) also drives the camera so the view matches what the mech does.
      this.input.yaw = intent.aimYaw;
      this.input.pitch = intent.aimPitch;
      this.player.step(intent, dt);
      this.groundFeedback(this.player);
      this.combat.stepMech(this.player, intent);
      this.heatFeedback();
      this.collectSalvage();
      if (this.phase === "return" && this.atBase) this.completeMission();
    } else {
      this.aimedMech = null;
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawnPlayer();
    }

    perfEnd("step.player", t);
    t = perfStart();

    // Only a few of the pilots in the fight may fire at once; see ENEMY_TUNING.maxAttackers.
    const fighting = this.mechs.filter((m) => m.brain && m.alive && m.brain.state.mode !== "patrol");
    this.attackers = pickAttackers(
      fighting.map((m) => ({ pilot: m, distance: m.brain!.targetDistance, holding: this.attackers.has(m) })),
      ENEMY_TUNING.maxAttackers,
    );

    for (const mech of this.mechs) {
      if (!mech.brain || !mech.alive) continue;
      const before = mech.brain.state.mode;
      const intent = mech.brain.think(mech, this.mechs, this.scene, this.tick, dt, this.rng, this.attackers.has(mech));
      if (before === "patrol" && mech.brain.state.mode !== "patrol") this.raiseAlarm(mech);
      mech.step(intent, dt);
      this.groundFeedback(mech);
      this.combat.stepMech(mech, intent);
    }

    perfEnd("step.ai", t);
    t = perfStart();
    this.combat.step(dt);
    perfEnd("step.projectiles", t);
    t = perfStart();
    stepPhysics(this.scene);
    perfEnd("step.physics", t);

    // Clear away destroyed enemies.
    for (let i = this.mechs.length - 1; i >= 0; i--) {
      const mech = this.mechs[i]!;
      if (mech !== this.player && !mech.alive) {
        this.hud.removeMarker(mech.visual.markerNode);
        mech.dispose();
        this.mechs.splice(i, 1);
      }
    }

    if (this.message && (this.message.time -= dt) <= 0) this.message = null;
  }

  // --- Presentation ---

  private sectionFractions(): Record<SectionId, number> {
    const out = {} as Record<SectionId, number>;
    for (const id of SECTION_IDS) out[id] = sectionFraction(this.player.health.sections[id]);
    return out;
  }

  private radarBlips(): RadarBlip[] {
    const sin = Math.sin(this.input.yaw);
    const cos = Math.cos(this.input.yaw);
    const p = this.player.feet;
    const rel = (x: number, z: number, kind: RadarBlip["kind"]): RadarBlip => {
      const dx = x - p.x;
      const dz = z - p.z;
      return { x: dx * cos - dz * sin, z: dx * sin + dz * cos, kind };
    };
    const blips: RadarBlip[] = [
      rel(this.zone.playerBase.x, this.zone.playerBase.z, "base"),
      rel(this.zone.enemyOutpost.x, this.zone.enemyOutpost.z, "outpost"),
    ];
    for (const pos of this.salvage.positions) blips.push(rel(pos.x, pos.z, "salvage"));
    for (const mech of this.enemies) blips.push(rel(mech.feet.x, mech.feet.z, "enemy"));
    return blips;
  }

  /** True if a living enemy has a full missile lock on the player. */
  private get lockedOn(): boolean {
    return this.player.alive && this.mechs.some((m) => m !== this.player && m.alive && this.combat.lockedTarget(m) === this.player);
  }

  private infoText(): string {
    const p = this.player;
    const tags = { armR: "R ", armL: "L ", shoulderR: "SR", shoulderL: "SL" };
    const lines = p.frame.hardpoints.map((h) => {
      const w = p.weapons[h.id];
      return `${tags[h.id]} ${w ? w.def.name : "empty"}${w && !p.weaponWorks(w) ? " (destroyed)" : ""}`;
    });
    const seeker = p.mounted.find((w) => w.def.lockTime !== undefined && p.weaponWorks(w));
    if (seeker && p.lock.target) {
      const progress = lockProgress(p.lock, seeker.def.lockTime ?? 0);
      lines.push(progress >= 1 ? "SEEKER LOCKED" : `Seeker locking ${Math.round(progress * 100)}%`);
    }
    const charges = p.frame.boostCharges ?? 1;
    if (charges > 1) lines.push(`Dash ${"●".repeat(p.state.boostCharges)}${"○".repeat(charges - p.state.boostCharges)}`);
    if (p.state.braced) lines.push("BRACED");
    lines.push(`Scrap ${this.save.scrap}`);
    if (this.atBase && this.player.alive) lines.push("Press H: hangar (refit, repair)");
    return lines.join("\n");
  }

  /** Per-frame visual update. `alpha` is the fraction of a step since the last simulation step. */
  render(alpha: number, frameDt: number): void {
    const playing = this.mode === "playing";
    let t = perfStart();
    for (const mech of this.mechs) mech.renderUpdate(playing ? alpha : 1, playing ? frameDt : 0);
    this.cameraRig.update(this.player, this.input.yaw, this.input.pitch, frameDt);
    if (playing) {
      this.effects.update(frameDt);
      this.salvage.update(frameDt);
      this.hitFlash = Math.max(0, this.hitFlash - frameDt * 6);
      this.damageFlash = Math.max(0, this.damageFlash - frameDt * 2.5);
      this.killFlash = Math.max(0, this.killFlash - frameDt * 1.6);
      const s = this.player.state;
      this.sfx.setThrust(!this.player.alive ? 0 : s.boostTime > 0 ? 1 : s.jetting ? 0.7 : 0);
    }

    perfEnd("visuals", t);
    t = perfStart();
    const s = this.player.state;
    const left = this.enemies.length;
    const goal = this.phase === "assault" ? this.zone.enemyOutpost : this.zone.playerBase;
    const dx = goal.x - this.player.feet.x;
    const dz = goal.z - this.player.feet.z;
    const objective =
      this.phase === "assault"
        ? `Clear the Combine outpost: ${left} hostile${left === 1 ? "" : "s"} remaining`
        : this.phase === "return"
          ? `Outpost cleared. Return to base${this.salvage.count > 0 ? ` (${this.salvage.count} salvage left)` : ""}`
          : "Mission complete. The basin is yours to explore.";
    this.hud.update({
      energy: s.energy / this.player.frame.energyMax,
      heat: s.heat / this.player.frame.heatCapacity,
      overheated: s.overheated,
      cockpit: this.cameraRig.mode === "cockpit",
      sections: this.sectionFractions(),
      target: this.aimedMech ? { name: this.aimedMech.name, health: healthFraction(this.aimedMech.health) } : null,
      objective,
      // Without the mouse captured there is no looking around; say how to get it back.
      message:
        this.message?.text ?? (this.lockedOn ? "MISSILE LOCK: break line of sight or dash" : this.input.needsPointer ? "Click the view to capture the mouse" : null),
      heading: this.input.yaw,
      waypoint:
        this.phase === "done"
          ? null
          : { bearing: Math.atan2(dx, dz), distance: Math.hypot(dx, dz), label: this.phase === "assault" ? "OUTPOST" : "BASE" },
      heatWarnAt: FEEL.heatWarnFraction,
      hitFlash: this.hitFlash,
      killFlash: this.killFlash,
      damageFlash: this.damageFlash,
      info: this.infoText(),
      radar: this.radarBlips(),
    });
    perfEnd("hud", t);
    t = perfStart();
    this.scene.render();
    perfEnd("scene.render", t);
  }
}
