import { Color3, DirectionalLight, Engine, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { BIOMES, BIOME_IDS } from "../data/biomes";
import { ENEMY_TUNING } from "../data/encounters";
import { FACTIONS } from "../data/factions";
import { FEEL } from "../data/feel";
import { FRAMES, SECTION_IDS, type FrameId, type SectionId } from "../data/frames";
import { ENEMY_LOADOUTS, type Loadout } from "../data/loadouts";
import { cacheSpots } from "../data/siteLayouts";
import { STREAM } from "../data/streaming";
import { WEAPONS, type WeaponId } from "../data/weapons";
import { WORLD } from "../data/world";
import { AI_ROLES } from "../sim/ai/brain";
import { healthFraction, sectionFraction } from "../sim/damage";
import type { Intent } from "../sim/intent";
import { addItem, itemName } from "../sim/loadout";
import { lockProgress } from "../sim/weapons";
import { pickAttackers } from "../sim/ai/squad";
import { rollCache, rollLoot } from "../sim/loot";
import { lerp, makeRng, type Vec3 } from "../sim/math";
import { buildPopulation, garrisonLeft, populationChanges, type MechRecord } from "../sim/population";
import { biomeWeights, heightAt, regionAt, type Site, type WorldModel } from "../sim/terrain";
import { buildWorldModel } from "../sim/worldgen";
import { Sfx } from "../view/audio";
import { Effects } from "../view/effects";
import { Hud, type RadarBlip } from "../view/hud/hud";
import { Screens } from "../view/screens";
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
import { TerrainStreamer } from "./terrainStream";

const RESPAWN_DELAY = 3.5;
/** Ticks between saves of the player's position. */
const POSITION_SAVE_TICKS = 300;
/** How fast sky and fog follow the biome the player is in, per second. */
const FOG_RATE = 0.6;
/** Damage in one hit that counts as a heavy blow for feedback (sound, shake). */
const HEAVY_HIT = 45;
const SECTION_NAMES: Record<SectionId, string> = { torso: "torso", armL: "left arm", armR: "right arm", legs: "legs" };

/** paused: menu open. hangar: refitting at base. map: world map open. complete: mission summary showing. */
export type GameMode = "playing" | "paused" | "hangar" | "map" | "complete";
/** assault: enemies remain. return: outpost cleared, head home. done: summary has been shown. */
export type MissionPhase = "assault" | "return" | "done";

/** Owns the scene and everything in it, and advances the game one fixed step at a time. */
export class World {
  /** The mechs in the scene: the player and the enemies near enough to be awake. */
  readonly mechs: MechEntity[] = [];
  /** Every enemy pilot in the world, awake or asleep. */
  readonly population: MechRecord[];
  /** The record behind each awake enemy. */
  private readonly records = new Map<MechEntity, MechRecord>();
  /** The named region the player is in. */
  region: { id: string; name: string };
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
  private readonly fog = { r: 0, g: 0, b: 0, start: 0, end: 0, set: false };
  private readonly biomeMix = new Float32Array(BIOME_IDS.length);

  private constructor(
    readonly scene: Scene,
    readonly model: WorldModel,
    readonly terrain: TerrainStreamer,
    readonly input: PlayerInput,
    readonly cameraRig: CameraRig,
    readonly hud: Hud,
    readonly screens: Screens,
    player: MechEntity,
    save: SaveData,
  ) {
    this.save = save;
    this.player = player;
    this.rng = makeRng(model.def.seed);
    this.effects = new Effects(scene);
    this.salvage = new SalvageField(scene);
    this.wrecks = new WreckField(scene, FEEL.maxWrecks);
    this.mechs.push(player);
    this.population = buildPopulation(model, new Set(save.cleared));
    this.region = regionAt(model.def, player.feet.x, player.feet.z);
    if (save.cleared.includes(model.def.missionOutpost)) this.phase = "done";
    terrain.onSite = (site, loaded) => this.onSiteStreamed(site, loaded);

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
    input.onPress("KeyM", () => {
      if (this.mode === "playing") this.openMap();
      else if (this.mode === "map") this.resume();
    });
    input.onPress("Escape", () => {
      if (this.mode === "map") this.resume();
    });
    // Esc makes the browser release the mouse; treat that as a pause request.
    input.onPointerReleased = () => {
      if (this.mode === "playing") this.pause();
    };
    window.addEventListener("blur", () => {
      if (this.mode === "playing" && this.started) this.pause();
    });

    this.updateFog(Infinity);
    this.pause();
  }

  static async create(engine: Engine, canvas: HTMLCanvasElement, overlay: HTMLElement): Promise<World> {
    const model = buildWorldModel(WORLD);
    const scene = new Scene(engine);
    // Sky and fog are set from the biome the player is in; see `updateFog`.
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.skipPointerMovePicking = true;
    await enablePhysics(scene);

    const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
    sky.intensity = 0.65;
    sky.groundColor = new Color3(0.35, 0.33, 0.3);
    const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35), scene);
    sun.intensity = 0.95;

    const save = loadSave();
    // `?arsenal` in the URL stocks the hangar with two of every weapon and plating, for playtests.
    if (new URLSearchParams(location.search).has("arsenal")) {
      for (const id of [...Object.keys(WEAPONS), "lightPlating", "standardPlating", "heavyPlating"] as (WeaponId | "lightPlating")[]) {
        save.inventory[id] = Math.max(save.inventory[id] ?? 0, 2);
      }
    }
    // Start where the player left off, or at the home base facing the first outpost.
    const home = model.siteById.get(model.def.homeBase)!;
    const limit = model.def.size / 2 - model.def.edgeMargin;
    const saved = save.position && Math.max(Math.abs(save.position.x), Math.abs(save.position.z)) <= limit ? save.position : null;
    const start = saved ?? { x: home.x, z: home.z, yaw: World.homeYaw(model) };
    const spawnYaw = start.yaw;
    const player = new MechEntity(scene, {
      name: "player",
      frame: FRAMES[save.frame],
      faction: "drifters",
      position: World.groundPoint(model, start.x, start.z, 0.6),
      yaw: spawnYaw,
      loadout: save.loadout,
    });

    const input = new PlayerInput(canvas);
    input.yaw = spawnYaw;
    input.pitch = -0.1;

    const world = new World(scene, model, new TerrainStreamer(scene, model), input, new CameraRig(scene), new Hud(scene), new Screens(overlay), player, save);
    // Everything around the start point is built before the first frame; after that the
    // world streams in a little per frame as the player moves.
    world.terrain.loadAll(start.x, start.z);
    // Compile the shaders that are first needed mid-fight, while the start screen is up.
    await Promise.all([world.effects.prewarm(), world.wrecks.prewarm(), world.salvage.prewarm(), player.visual.prewarm()]);
    return world;
  }

  static groundPoint(model: WorldModel, x: number, z: number, lift = 0): Vec3 {
    return { x, y: heightAt(model, x, z) + lift, z };
  }

  /** Facing from the home base toward the first outpost. */
  private static homeYaw(model: WorldModel): number {
    const home = model.siteById.get(model.def.homeBase)!;
    const post = model.siteById.get(model.def.missionOutpost)!;
    return Math.atan2(post.x - home.x, post.z - home.z);
  }

  /** Ground height at a position. */
  heightAt(x: number, z: number): number {
    return heightAt(this.model, x, z);
  }

  get homeBase(): Site {
    return this.model.siteById.get(this.model.def.homeBase)!;
  }

  get missionOutpost(): Site {
    return this.model.siteById.get(this.model.def.missionOutpost)!;
  }

  /** Bases the player holds: those held from the start and those taken since. */
  get heldBases(): Site[] {
    return this.model.sites.filter((s) => s.kind === "base" && (s.held || this.save.held.includes(s.id)));
  }

  /** The held base the player is standing in, if any. */
  get currentBase(): Site | null {
    const p = this.player.feet;
    return this.heldBases.find((b) => Math.hypot(p.x - b.x, p.z - b.z) < b.radius) ?? null;
  }

  private nearestHeldBase(x: number, z: number): Site {
    let best = this.homeBase;
    for (const b of this.heldBases) {
      if (Math.hypot(b.x - x, b.z - z) < Math.hypot(best.x - x, best.z - z)) best = b;
    }
    return best;
  }

  /** True while any awake enemy is hunting rather than patrolling. */
  get inCombat(): boolean {
    return this.mechs.some((m) => m.brain && m.alive && m.brain.state.mode !== "patrol");
  }

  get enemies(): MechEntity[] {
    return this.mechs.filter((m) => m !== this.player && m.alive);
  }

  /** True when the player is close enough to the base to use the hangar. */
  get atBase(): boolean {
    return this.currentBase !== null;
  }

  // --- Menus and game mode ---

  private applySettings(settings: Settings): void {
    this.save.settings = settings;
    this.input.sensitivity = settings.sensitivity;
    this.sfx.setVolume(settings.volume);
  }

  pause(): void {
    this.savePosition();
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
      () => {
        // Play the opening mission again: its garrison returns and the player starts at home.
        this.save.cleared = this.save.cleared.filter((id) => id !== this.model.def.missionOutpost);
        this.save.position = null;
        writeSave(this.save);
        location.reload();
      },
      () => this.resume(),
    );
  }

  // --- Map and travel ---

  openMap(): void {
    this.mode = "map";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.sfx.ui();
    const held = new Set(this.heldBases.map((b) => b.id));
    const blocked = !this.player.alive ? "Suit destroyed." : this.inCombat ? "Hostiles are engaged: break contact to travel." : null;
    this.screens.showMap({
      model: this.model,
      player: { x: this.player.feet.x, z: this.player.feet.z, yaw: this.input.yaw },
      region: this.region.name,
      sites: this.model.sites
        .filter((s) => this.save.discovered.includes(s.id) || held.has(s.id))
        .map((s) => ({ site: s, held: held.has(s.id), hostile: garrisonLeft(this.population, s.id) > 0 })),
      total: this.model.sites.length,
      travelBlocked: blocked,
      onTravel: (id) => this.travelTo(id),
      onClose: () => this.resume(),
    });
  }

  /** Fast travel to a base the player holds. Returns false if that is not allowed right now. */
  travelTo(siteId: string): boolean {
    const base = this.heldBases.find((b) => b.id === siteId);
    if (!base || !this.player.alive || this.inCombat) return false;
    this.movePlayer(base.x, base.z, base.id === this.model.def.homeBase ? World.homeYaw(this.model) : 0);
    this.savePosition();
    this.notify(`Arrived at ${base.name}.`, 4);
    this.resume();
    return true;
  }

  /** Put the player down at a point, with the ground there loaded first. */
  private movePlayer(x: number, z: number, yaw: number): void {
    this.terrain.ensureGround(x, z);
    this.player.teleport(World.groundPoint(this.model, x, z, 0.6), yaw);
    this.input.yaw = yaw;
    this.input.pitch = -0.1;
    this.updateFog(Infinity);
  }

  private savePosition(): void {
    if (!this.started || !this.player.alive) return;
    this.save.position = { x: Math.round(this.player.feet.x), z: Math.round(this.player.feet.z), yaw: Math.round(this.input.yaw * 100) / 100 };
    writeSave(this.save);
  }

  // --- The world around the player ---

  /** A site's structures have streamed in or out: its salvage cache comes and goes with them. */
  private onSiteStreamed(site: Site, loaded: boolean): void {
    if (!loaded) {
      this.salvage.removeAt(site.id);
      return;
    }
    if (!site.cache || this.save.looted.includes(site.id)) return;
    // The same crates every time, until they are taken.
    const rng = makeRng(this.model.def.seed ^ (this.model.sites.indexOf(site) * 7919));
    for (const [dx, dz] of cacheSpots(site)) {
      const x = site.x + dx;
      const z = site.z + dz;
      this.salvage.spawn(new Vector3(x, this.heightAt(x, z) + 2.6, z), rollCache(rng), site.id);
    }
  }

  /** Note any site the player has come upon, and take an unguarded base on arrival. */
  private discoverSites(): void {
    const p = this.player.feet;
    for (const site of this.model.sites) {
      if (Math.hypot(p.x - site.x, p.z - site.z) > site.radius + STREAM.discoverMargin) continue;
      if (!this.save.discovered.includes(site.id)) {
        this.save.discovered.push(site.id);
        writeSave(this.save);
        perfMark("discover");
        if (site.id !== this.model.def.homeBase) this.notify(`Discovered: ${site.name}`, 4);
      }
      if (site.kind === "base" && !site.garrison) this.holdBase(site);
    }
  }

  private holdBase(site: Site): void {
    if (site.held || this.save.held.includes(site.id)) return;
    this.save.held.push(site.id);
    writeSave(this.save);
    this.notify(`${site.name} secured: hangar and fast travel available.`, 6);
  }

  /** Wake sleeping enemies near the player and put far ones back to sleep. */
  private streamPopulation(): void {
    const p = this.player.feet;
    for (const [mech, record] of this.records) {
      record.x = mech.feet.x;
      record.z = mech.feet.z;
    }
    const { wake, sleep } = populationChanges(this.population, p.x, p.z, STREAM);
    for (const record of sleep) {
      const mech = this.mechs.find((m) => this.records.get(m) === record);
      if (!mech) continue;
      record.active = false;
      record.yaw = mech.state.legsYaw;
      record.health = mech.health;
      record.patrolIndex = mech.brain?.state.patrolIndex ?? record.patrolIndex;
      this.removeMech(mech);
    }
    for (const record of wake) {
      // Never before the ground under it has a collider.
      if (!this.terrain.hasGround(record.x, record.z)) continue;
      perfMark("wake");
      const mech = new MechEntity(this.scene, {
        name: `${FACTIONS[record.faction].name} ${record.member.loadout}`,
        frame: FRAMES[record.member.frame],
        faction: record.faction,
        position: World.groundPoint(this.model, record.x, record.z, 0.6),
        yaw: record.yaw,
        loadout: ENEMY_LOADOUTS[record.member.loadout],
        armorScale: ENEMY_TUNING.armorScale,
        damageScale: ENEMY_TUNING.damageScale,
      });
      if (record.health) mech.adoptHealth(record.health);
      mech.brain = new AiController(record.patrol, record.home, record.patrolIndex, record.squadId, AI_ROLES[record.member.role]);
      record.active = true;
      this.records.set(mech, record);
      this.mechs.push(mech);
      this.hud.addMarker(mech.visual.markerNode);
    }
  }

  /** Take an enemy mech out of the scene (destroyed, or gone back to sleep). */
  private removeMech(mech: MechEntity): void {
    this.hud.removeMarker(mech.visual.markerNode);
    this.records.delete(mech);
    this.attackers.delete(mech);
    if (this.aimedMech === mech) this.aimedMech = null;
    for (const other of this.mechs) if (other.lock.target === mech) other.lock.target = null;
    mech.dispose();
    this.mechs.splice(this.mechs.indexOf(mech), 1);
  }

  /** Sky and fog follow the mix of biomes where the player stands. */
  private updateFog(frameDt: number): void {
    const p = this.player.feet;
    const mix = biomeWeights(this.model.def, p.x, p.z, this.biomeMix);
    let r = 0;
    let g = 0;
    let b = 0;
    let start = 0;
    let end = 0;
    BIOME_IDS.forEach((id, i) => {
      const fog = BIOMES[id].fog;
      r += mix[i]! * fog.color[0];
      g += mix[i]! * fog.color[1];
      b += mix[i]! * fog.color[2];
      start += mix[i]! * fog.start;
      end += mix[i]! * fog.end;
    });
    const f = this.fog;
    const k = f.set ? Math.min(1, frameDt * FOG_RATE) : 1;
    f.set = true;
    f.r = lerp(f.r, r, k);
    f.g = lerp(f.g, g, k);
    f.b = lerp(f.b, b, k);
    f.start = lerp(f.start, start, k);
    f.end = lerp(f.end, end, k);
    this.scene.fogColor.set(f.r, f.g, f.b);
    this.scene.clearColor.set(f.r, f.g, f.b, 1);
    this.scene.fogStart = f.start;
    this.scene.fogEnd = f.end;
  }

  // --- Encounter ---

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
    const record = this.records.get(victim);
    if (!record) return;
    record.alive = false;
    record.active = false;
    const site = this.model.siteById.get(record.siteId)!;
    const left = garrisonLeft(this.population, site.id);
    if (left > 0) {
      this.notify(`Hostile destroyed. ${left} remaining at ${site.name}.`, 4);
      return;
    }
    if (!this.save.cleared.includes(site.id)) this.save.cleared.push(site.id);
    writeSave(this.save);
    if (site.id === this.model.def.missionOutpost && this.phase === "assault") {
      this.phase = "return";
      this.notify("Outpost cleared! Collect salvage and return to base.", 6);
    } else if (site.kind === "base") {
      this.holdBase(site);
    } else {
      this.notify(`${site.name} cleared.`, 5);
    }
  }

  notify(text: string, seconds = 3): void {
    this.message = { text, time: seconds };
  }

  private respawnPlayer(): void {
    const base = this.nearestHeldBase(this.player.feet.x, this.player.feet.z);
    this.player.restore();
    this.movePlayer(base.x, base.z, base.id === this.model.def.homeBase ? World.homeYaw(this.model) : 0);
    this.notify(`Suit restored at ${base.name}.`);
  }

  private collectSalvage(): void {
    const drops = this.salvage.collectNear(this.player.feet);
    if (drops.length === 0) return;
    const names: string[] = [];
    let scrap = 0;
    for (const { drop, site } of drops) {
      // A site's cache is spent once its last crate is taken.
      if (site && this.salvage.countAt(site) === 0 && !this.save.looted.includes(site)) this.save.looted.push(site);
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
    // Scripted teleports (tests, the console) can put the player anywhere: make sure there is
    // ground there before anything moves. In normal play this finds everything already loaded.
    this.terrain.ensureGround(this.player.feet.x, this.player.feet.z);
    this.streamPopulation();
    if (this.tick % 10 === 0 && this.player.alive) {
      this.discoverSites();
      const region = regionAt(this.model.def, this.player.feet.x, this.player.feet.z);
      if (region.id !== this.region.id) {
        this.region = region;
        if (!this.message) this.notify(`Entering ${region.name}`, 4);
      }
    }
    if (this.tick % POSITION_SAVE_TICKS === 0 && this.player.state.grounded) this.savePosition();
    perfEnd("step.world", t);
    t = perfStart();
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
      // The rim mountains are the wall; this is the backstop for anyone who jets up them.
      if (this.player.confine(this.model.def.size / 2 - this.model.def.edgeMargin)) this.notify("The mountains are impassable. Turn back.", 2);
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
      if (mech !== this.player && !mech.alive) this.removeMech(mech);
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
    const blips: RadarBlip[] = [];
    const base = this.nearestHeldBase(p.x, p.z);
    blips.push(rel(base.x, base.z, "base"));
    // Known enemy sites that still have a garrison, when they are near enough to matter.
    for (const site of this.model.sites) {
      if (!site.garrison || garrisonLeft(this.population, site.id) === 0) continue;
      const known = this.save.discovered.includes(site.id) || (site.id === this.model.def.missionOutpost && this.phase === "assault");
      if (known && Math.hypot(site.x - p.x, site.z - p.z) < 1500) blips.push(rel(site.x, site.z, "outpost"));
    }
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
    lines.push(`${this.region.name} · M: map`);
    if (this.atBase && this.player.alive) lines.push("Press H: hangar (refit, repair)");
    return lines.join("\n");
  }

  /** Per-frame visual update. `alpha` is the fraction of a step since the last simulation step. */
  render(alpha: number, frameDt: number): void {
    const playing = this.mode === "playing";
    // Streaming runs every frame, menus included, so the world is ready when play resumes.
    this.terrain.update(this.player.feet.x, this.player.feet.z);
    this.updateFog(playing ? frameDt : 0);
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
    const left = garrisonLeft(this.population, this.model.def.missionOutpost);
    const goal = this.phase === "assault" ? this.missionOutpost : this.nearestHeldBase(this.player.feet.x, this.player.feet.z);
    const dx = goal.x - this.player.feet.x;
    const dz = goal.z - this.player.feet.z;
    const objective =
      this.phase === "assault"
        ? `Clear the Combine outpost: ${left} hostile${left === 1 ? "" : "s"} remaining`
        : this.phase === "return"
          ? `Outpost cleared. Return to base${this.salvage.count > 0 ? ` (${this.salvage.count} salvage left)` : ""}`
          : `Explore the Marches: ${this.save.discovered.length} of ${this.model.sites.length} places found`;
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
