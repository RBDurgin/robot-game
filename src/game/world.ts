import { Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { ENEMY_TUNING, SLICE_SQUADS } from "../data/encounters";
import { FACTIONS } from "../data/factions";
import { FRAMES, SECTION_IDS, type SectionId } from "../data/frames";
import { ENEMY_LOADOUTS, type Loadout } from "../data/loadouts";
import { SLICE_ZONE, type ZoneDef } from "../data/zone";
import { healthFraction, sectionFraction } from "../sim/damage";
import type { Intent } from "../sim/intent";
import { addItem, itemName } from "../sim/loadout";
import { rollLoot } from "../sim/loot";
import { makeRng, type Vec3 } from "../sim/math";
import { heightAt } from "../sim/terrain";
import { Sfx } from "../view/audio";
import { Effects } from "../view/effects";
import { Hud, type RadarBlip } from "../view/hud/hud";
import { Screens } from "../view/screens";
import { buildStructures, buildTerrain } from "../view/terrain";
import { AiController } from "./aiController";
import { CameraRig } from "./camera/cameraRig";
import { Combat } from "./combat";
import { PlayerInput } from "./input";
import { MechEntity } from "./mechEntity";
import { enablePhysics, stepPhysics } from "./physics";
import { SalvageField } from "./salvage";
import { loadSave, writeSave, type SaveData, type Settings } from "./save";

const SKY = new Color3(0.62, 0.71, 0.8);
const RESPAWN_DELAY = 3.5;
const ALERT_RADIUS = 120;

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
  readonly sfx = new Sfx();
  readonly rng: () => number;
  readonly save: SaveData;
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
  private message: { text: string; time: number } | null = null;
  private readonly spawnYaw: number;

  private constructor(
    readonly scene: Scene,
    readonly zone: ZoneDef,
    readonly input: PlayerInput,
    readonly cameraRig: CameraRig,
    readonly hud: Hud,
    readonly screens: Screens,
    readonly player: MechEntity,
    save: SaveData,
  ) {
    this.save = save;
    this.rng = makeRng(zone.seed);
    this.effects = new Effects(scene);
    this.salvage = new SalvageField(scene);
    this.spawnYaw = player.state.torsoYaw;
    this.mechs.push(player);

    this.combat = new Combat(scene, this.effects, () => this.mechs, this.rng, {
      onDamage: (victim, attacker) => {
        if (victim === this.player) {
          this.damageFlash = 1;
          this.cameraRig.shake(0.25);
          this.sfx.hitTaken();
        }
        if (attacker === this.player) {
          this.hitFlash = 1;
          this.sfx.hitLanded();
        }
        this.raiseAlarm(victim);
      },
      onKill: (victim) => this.onKill(victim),
      onFire: (shooter, weapon, at) => {
        const d = shooter === this.player ? 0 : Vector3.Distance(at, this.player.feet);
        this.sfx.shot(weapon.kind, weapon.damage > 30, d);
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
    const base = zone.playerBase;
    // Face the enemy outpost on spawn.
    const spawnYaw = Math.atan2(zone.enemyOutpost.x - base.x, zone.enemyOutpost.z - base.z);
    const player = new MechEntity(scene, {
      name: "player",
      frame: FRAMES.medium,
      faction: "drifters",
      position: World.groundPoint(zone, base.x, base.z, 0.6),
      yaw: spawnYaw,
      loadout: save.loadout,
    });

    const input = new PlayerInput(canvas);
    input.yaw = spawnYaw;
    input.pitch = -0.1;

    return new World(scene, zone, input, new CameraRig(scene), new Hud(scene), new Screens(overlay), player, save);
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
      frame: this.player.frame,
      loadout: this.save.loadout,
      inventory: this.save.inventory,
      scrap: this.save.scrap,
      onDeploy: (loadout) => this.deploy(loadout),
    });
  }

  /** Fit a loadout chosen in the hangar, repair, and return to play. */
  deploy(loadout: Loadout): void {
    this.save.loadout = loadout;
    writeSave(this.save);
    this.player.applyLoadout(loadout);
    this.player.restore();
    this.notify("Suit refitted and repaired.");
    this.resume();
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
      squad.members.forEach((loadoutId, i) => {
        const startIndex = Math.floor((i * patrol.length) / squad.members.length);
        const start = patrol[startIndex]!;
        const mech = new MechEntity(this.scene, {
          name: `${FACTIONS[squad.faction].name} ${loadoutId}`,
          frame: FRAMES[squad.frame],
          faction: squad.faction,
          position: { x: start.x, y: start.y + 0.6, z: start.z },
          yaw: this.rng() * Math.PI * 2,
          loadout: ENEMY_LOADOUTS[loadoutId],
          armorScale: ENEMY_TUNING.armorScale,
          damageScale: ENEMY_TUNING.damageScale,
        });
        mech.brain = new AiController(patrol, home, startIndex + 1);
        this.mechs.push(mech);
        this.hud.addMarker(mech.visual.markerNode);
      });
    }
  }

  /** A mech under attack (or one that spots the enemy) alerts nearby allies. */
  private raiseAlarm(source: MechEntity): void {
    for (const mech of this.mechs) {
      if (mech.brain && mech.faction === source.faction && Vector3.Distance(mech.feet, source.feet) < ALERT_RADIUS) {
        mech.brain.alert();
      }
    }
  }

  private onKill(victim: MechEntity): void {
    if (victim === this.player) {
      this.deaths++;
      this.respawnTimer = RESPAWN_DELAY;
      this.notify("Suit destroyed. Recovering to base...", RESPAWN_DELAY);
      return;
    }
    this.kills++;
    this.salvage.spawn(new Vector3(victim.feet.x, victim.feet.y + 1.4, victim.feet.z), rollLoot(victim.loadout, this.rng));
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

  /** One fixed simulation step. Does nothing unless the game is in play. */
  step(dt: number): void {
    if (this.mode !== "playing") return;
    this.tick++;

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
      this.combat.stepMech(this.player, intent);
      this.collectSalvage();
      if (this.phase === "return" && this.atBase) this.completeMission();
    } else {
      this.aimedMech = null;
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawnPlayer();
    }

    for (const mech of this.mechs) {
      if (!mech.brain || !mech.alive) continue;
      const before = mech.brain.state.mode;
      const intent = mech.brain.think(mech, this.mechs, this.scene, this.tick, dt, this.rng);
      if (before === "patrol" && mech.brain.state.mode !== "patrol") this.raiseAlarm(mech);
      mech.step(intent, dt);
      this.combat.stepMech(mech, intent);
    }

    this.combat.step(dt);
    stepPhysics(this.scene);

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

  private infoText(): string {
    const w = this.player.weapons;
    const lines = [
      `R  ${w.armR ? w.armR.def.name : "empty"}${this.player.isDestroyed("armR") ? " (destroyed)" : ""}`,
      `L  ${w.armL ? w.armL.def.name : "empty"}${this.player.isDestroyed("armL") ? " (destroyed)" : ""}`,
      `Scrap ${this.save.scrap}`,
    ];
    if (this.atBase && this.player.alive) lines.push("Press H: hangar (refit, repair)");
    return lines.join("\n");
  }

  /** Per-frame visual update. `alpha` is the fraction of a step since the last simulation step. */
  render(alpha: number, frameDt: number): void {
    const playing = this.mode === "playing";
    for (const mech of this.mechs) mech.renderUpdate(playing ? alpha : 1, playing ? frameDt : 0);
    this.cameraRig.update(this.player, this.input.yaw, this.input.pitch);
    if (playing) {
      this.effects.update(frameDt);
      this.salvage.update(frameDt);
      this.hitFlash = Math.max(0, this.hitFlash - frameDt * 6);
      this.damageFlash = Math.max(0, this.damageFlash - frameDt * 2.5);
      const s = this.player.state;
      this.sfx.setThrust(!this.player.alive ? 0 : s.boostTime > 0 ? 1 : s.jetting ? 0.7 : 0);
    }

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
      message: this.message?.text ?? null,
      heading: this.input.yaw,
      waypoint:
        this.phase === "done"
          ? null
          : { bearing: Math.atan2(dx, dz), distance: Math.hypot(dx, dz), label: this.phase === "assault" ? "OUTPOST" : "BASE" },
      hitFlash: this.hitFlash,
      damageFlash: this.damageFlash,
      info: this.infoText(),
      radar: this.radarBlips(),
    });
    this.scene.render();
  }
}
