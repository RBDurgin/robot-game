import { QUALITY } from "../data/quality";
import { Graphics } from "../view/graphics";
import { Cockpit } from "../view/cockpit";
import { getPartMaterials } from "../view/parts/proceduralParts";
import { preloadModels } from "../view/parts/GltfPartVisual";
import { downloadText, slotAsSaveFile } from "../view/download";
import { Color3, DirectionalLight, Engine, HemisphericLight, Scene, SpotLight, Vector3, type AbstractMesh } from "../babylon";
import { BIOMES, BIOME_IDS } from "../data/biomes";
import { DANGER, ENEMY_TUNING } from "../data/encounters";
import { cssColor, FACTIONS, isWarFactionId, PLAYER_FACTION, WAR_FACTION_IDS, type WarFactionId } from "../data/factions";
import { FEEL } from "../data/feel";
import { FRAMES, SECTION_IDS, type FrameId, type SectionId } from "../data/frames";
import { ENEMY_LOADOUTS } from "../data/loadouts";
import { PLATING } from "../data/parts";
import { UNLOCK_IDS } from "../data/unlocks";
import type { Danger, RegionDef } from "../data/world";
import { CAMPAIGN_LENGTH, campaignOf } from "../data/missions";
import { PATRON_OFFER, PATRONS } from "../data/patrons";
import { cacheSpots } from "../data/siteLayouts";
import { STREAM } from "../data/streaming";
import { REPUTATION, WAR } from "../data/war";
import { WEAPONS } from "../data/weapons";
import { WORLD } from "../data/world";
import { AI_ROLES } from "../sim/ai/brain";
import { healthFraction, sectionFraction } from "../sim/damage";
import { repairBill, repairCost } from "../sim/economy";
import type { Intent } from "../sim/intent";
import { addItem, fitKit, fitLoadout, plainSpec, specName, type Fit } from "../sim/items";
import type { ItemId } from "../sim/loadout";
import { lockProgress } from "../sim/weapons";
import { pickAttackers } from "../sim/ai/squad";
import { cacheTableFor, lootTableFor, rollCache, rollLoot } from "../sim/loot";
import { lerp, makeRng, type Vec3 } from "../sim/math";
import { awaitedSites, BASE_PLACE, currentStage, inTraining, missionEvent, nextMission, objectiveText, PLAYER_STRIDE, resumeMission, skipTraining, startMission, stepMission, type PlayerAct, type Line, type MissionDef, type MissionEffect, type MissionFacts, type MissionState, type PlaceDef, type WorldEvent } from "../sim/mission";
import { contractDef, contractsOnOffer, isContractId, type ContractSpec } from "../sim/contracts";
import { patronsOffering, takePatron, type PatronDef } from "../sim/patron";
import { buildPopulation, garrisonLeft, missionRecords, populationChanges, raidersLeft, raidRecords, syncGarrison, type IdSource, type MechRecord } from "../sim/population";
import { attitudeOf, awardStanding, hostileFactions, recordCapture, recordFriendlyFire, recordKill, type Attitude } from "../sim/reputation";
import { buildWarMap, captureByRaid, clearSite, endRaid, parseWar, regionControl, setTroops, settleRaid, siteCounts, stepWar, type Holder, type WarContext, type WarEvent, type WarMap, type WarState } from "../sim/war";
import { biomeWeights, heightAt, regionAt, type Site, type WorldModel } from "../sim/terrain";
import { buildWorldModel } from "../sim/worldgen";
import { darkness, lampsWanted, parseTime, skipTo, skyAt, timeOfDay, type SkyState } from "../sim/sky";
import { LIGHTS } from "../data/lights";
import { WEATHER } from "../data/weather";
import { CLEAR, forceWeather, frontsAt, parseWeather, weatherAt, weatherFog, weatherLight, weatherName, type ForcedWeather, type Front, type WeatherSample } from "../sim/weather";
import { WeatherEffects } from "../view/weather";
import { Sfx } from "../view/audio";
import { Effects } from "../view/effects";
import { isActionId, type ActionId } from "../data/controls";
import { Hud, hudPalette, type HudState, type RadarBlip } from "../view/hud/hud";
import { Screens } from "../view/screens";
import { PlaceMarker } from "../view/placeMarker";
import { SkyDome } from "../view/skyDome";
import { WreckField } from "../view/wreck";
import { AiController } from "./aiController";
import { CameraRig } from "./camera/cameraRig";
import { Combat } from "./combat";
import { PlayerInput } from "./input";
import { MechEntity } from "./mechEntity";
import { perfEnd, perfMark, perfStart } from "./perf";
import { enablePhysics, raycastWorld, stepPhysics } from "./physics";
import { SalvageField } from "./salvage";
import type { SaveData, Settings } from "./save";
import { openSaveStore, readSaveFile, writeSaveFile, type SaveStore } from "./saveStore";
import { TerrainStreamer } from "./terrainStream";

const RESPAWN_DELAY = 3.5;
/** Ticks between saves of the player's position. */
const POSITION_SAVE_TICKS = 300;
/** How fast sky and fog follow the biome the player is in, per second. */
const FOG_RATE = 0.6;
/** The fill light's colour from below in daylight. */
const GROUND_LIGHT = [0.35, 0.33, 0.3] as const;
/** Damage in one hit that counts as a heavy blow for feedback (sound, shake). */
const HEAVY_HIT = 45;
/** Colour of the marker over a mech and of its radar blip, by how it regards the player. */
/** A woken mech on its way into the world; see `World.warmWaking`. */
interface Waking {
  mech: MechEntity;
  record: MechRecord;
  /** The meshes it will draw, once its imported parts have loaded. */
  meshes: AbstractMesh[] | null;
  /** Meshes warmed, or shown, so far. */
  next: number;
  revealing: boolean;
}

/** A mech's marker colour, by how it regards the player, in the HUD colours in use. */
const attitudeColor = (attitude: Attitude): string => hudPalette()[attitude];
/** Allies this close to the player come to help when a fight starts, metres. */
const RALLY_RANGE = 320;
/** Wingmen are picked from allied pilots within this many metres. */
const WINGMAN_RANGE = 160;
const MAX_WINGMEN = 2;
/** Raiders nobody can see close on their target at this speed (m/s), and stop this far from its middle (m). */
const RAID_MARCH = 6;
const RAID_ARRIVED = 30;
const SECTION_NAMES: Record<SectionId, string> = { torso: "torso", armL: "left arm", armR: "right arm", legs: "legs" };

/** paused: menu open. hangar: refitting at base. map: world map open. briefing: reading a mission on offer. complete: mission summary showing. */
export type GameMode = "playing" | "paused" | "hangar" | "map" | "briefing" | "complete";

/** Owns the scene and everything in it, and advances the game one fixed step at a time. */
export class World {
  /** The mechs in the scene: the player and the enemies near enough to be awake. */
  readonly mechs: MechEntity[] = [];
  /** Every AI pilot in the world, awake or asleep. Changes as the war moves garrisons about. */
  readonly population: MechRecord[];
  /** The record behind each awake AI mech. */
  private readonly records = new Map<MechEntity, MechRecord>();
  private readonly recordIds: IdSource = { next: 0 };
  /** The sites the war is fought over. */
  readonly warMap: WarMap;
  /** Who holds what. Lives in the save. */
  readonly war: WarState;
  private readonly warContext: WarContext;
  /** Damage the player has done to squads that were not hostile, by squad id. */
  private readonly grievance = new Map<string, number>();
  /** Allied pilots following the player. */
  readonly wingmen = new Set<MechEntity>();
  /** The named region the player is in. */
  region: RegionDef;
  readonly effects: Effects;
  /** Shadows, post-processing and surface detail, by the quality setting. */
  readonly graphics: Graphics;
  /** The modelled cockpit seen in cockpit view. */
  private readonly cockpit: Cockpit;
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
  /** Called with everything that happens in the world that a mission could be waiting for. */
  onEvent: ((event: WorldEvent) => void) | null = null;
  tick = 0;
  /** Test hook: stops the war's clock, so tests can rely on who holds what. */
  warPaused = false;
  /** Stops the time of day (tests, screenshots, `?time=`). */
  skyPaused = false;
  /** The light and colours of the sky this frame. */
  sky: SkyState;
  /** Storm fronts on the move this frame. */
  fronts: Front[] = [];
  /** The weather where the player is, as shown this frame (eased toward the true weather). */
  weather: WeatherSample = CLEAR;
  /** Weather held at the player by `?weather=` or `setWeather`, instead of the fronts'. */
  weatherForced: ForcedWeather | null = null;
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
  /** Pilots currently allowed to fire on the player. */
  private attackers = new Set<MechEntity>();
  /** Player heat state last step, to spot the moment a warning should sound. */
  private wasHot = false;
  private wasOverheated = false;
  private message: { text: string; time: number } | null = null;
  /** Radio lines waiting their turn; the first is the one on screen. */
  private readonly comms: { line: Line; time: number }[] = [];
  /** After a failure, the mission is not begun again until the player is back at a base. */
  private missionHeld = false;
  /** Names this playing of the mission in progress; the pilots it brings in carry it as their site. */
  private missionRun = "";
  private missionRuns = 0;
  /** Pickups a mission has asked for that are waiting for the ground under them to load. */
  private pendingDrops: { tag: string; name: string; x: number; z: number }[] = [];
  /** What the tagged pickups lying about are called. */
  private readonly dropNames = new Map<string, string>();
  private readonly placeMarker: PlaceMarker;
  private readonly fog = { r: 0, g: 0, b: 0, start: 0, end: 0, set: false };
  private readonly biomeMix = new Float32Array(BIOME_IDS.length);
  private readonly sunLight: DirectionalLight;
  private readonly skyLight: HemisphericLight;
  private readonly weatherEffects: WeatherEffects;
  /** Brightness of a lightning flash, fading to 0. */
  private lightning = 0;
  /** The player has been told about the storm they are in. */
  private stormNoticed = false;
  /** The player's headlights: made once at start-up and dimmed to nothing when off, so no shader recompiles. */
  private readonly headlight: SpotLight;
  /** The player's headlights are on. Kept here, as the player's mech is replaced on a refit. */
  headlightsOn = false;
  private readonly skyDome: SkyDome;
  private domeOn = true;

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
    readonly store: SaveStore,
  ) {
    this.save = save;
    this.player = player;
    this.rng = makeRng(model.def.seed);
    this.effects = new Effects(scene);
    this.sunLight = scene.getLightByName("sun") as DirectionalLight;
    this.skyLight = scene.getLightByName("sky") as HemisphericLight;
    this.headlight = scene.getLightByName("headlight") as SpotLight;
    this.skyDome = new SkyDome(scene);
    // `?time=dusk` (or a fraction of a day) sets the time and stops the clock, for screenshots.
    const time = parseTime(new URLSearchParams(location.search).get("time"));
    if (time !== null) {
      skipTo(save.sky, time);
      this.skyPaused = true;
    }
    this.sky = skyAt(timeOfDay(save.sky));
    // `?weather=rain` (or dust, storm, clear, or a strength) holds the weather at the player.
    this.weatherForced = parseWeather(new URLSearchParams(location.search).get("weather"));
    this.weatherEffects = new WeatherEffects(scene);
    this.graphics = new Graphics(scene, this.sunLight, cameraRig.camera, hud.ui);
    this.cockpit = new Cockpit(scene, cameraRig.camera, getPartMaterials(scene, FACTIONS[PLAYER_FACTION].colors));
    this.salvage = new SalvageField(scene);
    this.placeMarker = new PlaceMarker(scene);
    this.wrecks = new WreckField(scene, FEEL.maxWrecks);
    this.mechs.push(player);
    this.warMap = buildWarMap(model);
    const fresh = save.war === null;
    this.war = parseWar(save.war, this.warMap);
    if (fresh) {
      // A new game, or a save from before the war: start it around what the player had done.
      for (const id of save.held) if (this.warMap.byId.has(id)) clearSite(this.war, this.warMap, id, true);
      for (const id of save.cleared) if (this.warMap.byId.has(id) && !save.held.includes(id)) clearSite(this.war, this.warMap, id, false);
    }
    save.war = this.war;
    save.held = this.heldBases.filter((b) => !b.held).map((b) => b.id);
    this.warContext = {
      observed: (id) => this.observed(id),
      frozen: (id) => this.awaited(id),
      hostileToPlayer: (faction) => attitudeOf(this.save.standing, faction) === "hostile",
    };
    this.population = buildPopulation(model, this.war, this.recordIds);
    this.region = regionAt(model.def, player.feet.x, player.feet.z);
    // A contract on a site this world does not have cannot be finished.
    if (this.save.missions.contract && !this.warMap.byId.has(this.save.missions.contract.site)) this.save.missions.contract = this.save.missions.active = null;
    const saved = this.mission;
    if (saved) this.runMission(saved.def, resumeMission(saved.def, saved.state));
    else this.offerMission();
    terrain.onSite = (site, loaded) => this.onSiteStreamed(site, loaded);

    const rules = {
      hostile: (a: MechEntity, b: MechEntity) => this.hostile(a, b),
      // The player's shots hit whoever they are pointed at; shooting friends has consequences.
      canHit: (shooter: MechEntity, target: MechEntity) => shooter === this.player || this.hostile(shooter, target),
      damageScale: (attacker: MechEntity, victim: MechEntity) => (attacker.brain && victim.brain ? ENEMY_TUNING.aiDamageScale : attacker.damageScale),
    };
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
          this.onPlayerHit(victim, amount);
        }
        this.raiseAlarm(victim);
        if (victim === this.player || attacker === this.player) this.rallyAllies();
      },
      onKill: (victim, attacker) => this.onKill(victim, attacker),
      onFire: (shooter, weapon, at) => {
        const perShot = weapon.damage * (weapon.pellets ?? 1);
        this.sfx.shot(weapon.kind, weapon.kind !== "beam" && perShot > 30, shooter === this.player ? null : at);
        if (shooter === this.player) this.playerDid("fire");
      },
      onExplosion: (at, radius) => {
        const d = Vector3.Distance(at, this.player.center);
        this.sfx.explosion(at, radius);
        this.cameraRig.shake(Math.max(0, 1 - d / 60) * 0.8);
      },
    }, rules);

    this.applySettings(save.settings);
    this.cameraRig.mode = save.settings.defaultView;

    input.onAction("view", () => {
      if (this.mode !== "playing") return;
      this.cameraRig.toggle();
      this.playerDid("view");
    });
    input.onAction("lights", () => {
      if (this.mode !== "playing" || !this.player.alive) return;
      this.headlightsOn = !this.headlightsOn;
      this.sfx.ui();
    });
    input.onAction("hangar", () => {
      if (this.mode === "playing" && this.atBase && this.player.alive) this.openHangar();
    });
    input.onAction("briefing", () => {
      if (this.mode !== "playing" || !this.player.alive) return;
      if (this.offers) this.openOffers();
      else this.openBriefing();
    });
    input.onAction("contracts", () => {
      if (this.mode === "playing" && this.player.alive) this.openContracts();
    });
    input.onAction("log", () => {
      if (this.mode === "playing") this.openLog();
    });
    input.onAction("wing", () => {
      if (this.mode === "playing" && this.player.alive) this.toggleWingmen();
    });
    input.onAction("pause", () => {
      if (this.mode === "playing") this.pause();
    });
    input.onAction("map", () => {
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

    this.updateWeather(Infinity);
    this.updateSky();
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
    // Made before any material, so every one is compiled with it; off is intensity 0.
    const h = LIGHTS.headlight;
    const headlight = new SpotLight("headlight", Vector3.Zero(), new Vector3(0, 0, 1), h.angle, h.exponent, scene);
    headlight.diffuse = new Color3(...LIGHTS.color);
    headlight.specular = headlight.diffuse.scale(0.5);
    headlight.range = h.range;
    headlight.intensity = 0;

    const store = await openSaveStore();
    const save = await store.load();
    // `?arsenal` in the URL stocks the hangar with two of every weapon and plating, for playtests.
    if (new URLSearchParams(location.search).has("arsenal")) {
      save.unlocks = [...UNLOCK_IDS];
      for (const id of [...Object.keys(WEAPONS), ...Object.keys(PLATING)] as ItemId[]) {
        for (let have = save.inventory.filter((item) => item.id === id).length; have < 2; have++) addItem(save.inventory, plainSpec(id));
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
      faction: PLAYER_FACTION,
      position: World.groundPoint(model, start.x, start.z, 0.6),
      yaw: spawnYaw,
      loadout: fitLoadout(save.fit, save.inventory),
      kit: fitKit(save.fit, save.inventory),
    });

    const input = new PlayerInput(canvas);
    input.yaw = spawnYaw;
    input.pitch = -0.1;

    const world = new World(scene, model, new TerrainStreamer(scene, model), input, new CameraRig(scene), new Hud(scene), new Screens(overlay), player, save, store);
    // Everything around the start point is built before the first frame; after that the
    // world streams in a little per frame as the player moves.
    world.terrain.loadAll(start.x, start.z);
    // Compile the shaders that are first needed mid-fight, while the start screen is up.
    // Imported models are loaded once here too, so mechs that wake later do not pop in.
    await Promise.all([world.effects.prewarm(), world.wrecks.prewarm(), world.salvage.prewarm(), player.visual.prewarm(), preloadModels(scene)]);
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

  /** Who holds a site: a faction, the player, or nobody. Null too for places nobody fights over. */
  ownerOf(siteId: string): Holder {
    return this.war.sites[siteId]?.owner ?? null;
  }

  /** Bases the player holds: their home and those taken since. */
  get heldBases(): Site[] {
    return this.model.sites.filter((s) => s.kind === "base" && this.ownerOf(s.id) === "player");
  }

  /** Bases the player can use (hangar, fast travel): their own and those of factions allied to them. */
  get openBases(): Site[] {
    return this.model.sites.filter((s) => {
      if (s.kind !== "base") return false;
      const owner = this.ownerOf(s.id);
      return owner === "player" || (isWarFactionId(owner) && this.attitude(owner) === "allied");
    });
  }

  /** The usable base the player is standing in, if any. */
  get currentBase(): Site | null {
    const p = this.player.feet;
    return this.openBases.find((b) => Math.hypot(p.x - b.x, p.z - b.z) < b.radius) ?? null;
  }

  private nearestOf(bases: Site[], x: number, z: number): Site {
    let best = this.homeBase;
    for (const b of bases) {
      if (Math.hypot(b.x - x, b.z - z) < Math.hypot(best.x - x, best.z - z)) best = b;
    }
    return best;
  }

  /** The player's nearest base that is not under attack: where a lost suit is recovered to. */
  private nearestHeldBase(x: number, z: number): Site {
    return this.nearestOf(this.heldBases.filter((b) => !this.war.raids.some((r) => r.to === b.id)), x, z);
  }

  /** True while any awake pilot is hunting the player. */
  get inCombat(): boolean {
    return this.mechs.some((m) => m.brain && m.alive && m.brain.state.mode !== "patrol" && m.brain.target === this.player);
  }

  /** Every other living mech in the scene, friend or foe. */
  get others(): MechEntity[] {
    return this.mechs.filter((m) => m !== this.player && m.alive);
  }

  /** The living mechs in the scene that are hostile to the player. */
  get enemies(): MechEntity[] {
    return this.mechs.filter((m) => m !== this.player && m.alive && this.hostile(this.player, m));
  }

  // --- Factions and standing ---

  /** How a faction regards the player. */
  attitude(faction: WarFactionId): Attitude {
    return attitudeOf(this.save.standing, faction);
  }

  /** How one mech regards the player: its faction's attitude, unless the player has provoked its squad. */
  attitudeOfMech(mech: MechEntity): Attitude {
    if (!isWarFactionId(mech.faction)) return "allied";
    // A squad a mission brought in can have its mind made up already.
    const stance = this.records.get(mech)?.mission?.stance;
    if (stance) return stance;
    if (mech.brain && (this.grievance.get(mech.brain.squadId) ?? 0) >= REPUTATION.provokeDamage) return "hostile";
    return this.attitude(mech.faction);
  }

  /** Whether two mechs attack each other on sight. */
  hostile(a: MechEntity, b: MechEntity): boolean {
    if (a === b) return false;
    if (a === this.player) return this.attitudeOfMech(b) === "hostile";
    if (b === this.player) return this.attitudeOfMech(a) === "hostile";
    return hostileFactions(a.faction, b.faction, this.save.standing);
  }

  /** Change the player's standing through `change`, and say so when a faction's attitude shifts. */
  private changeStanding(change: () => void): void {
    const before = WAR_FACTION_IDS.map((f) => this.attitude(f));
    change();
    let shifted = false;
    WAR_FACTION_IDS.forEach((f, i) => {
      const now = this.attitude(f);
      if (now === before[i]) return;
      shifted = true;
      const name = FACTIONS[f].name;
      this.notify(now === "hostile" ? `The ${name} now attacks you on sight.` : now === "allied" ? `The ${name} counts you an ally: its bases are open to you.` : before[i] === "hostile" ? `The ${name} no longer attacks you on sight.` : `The ${name} no longer counts you an ally.`, 6);
    });
    if (shifted) this.refreshMarkers();
  }

  /** The player has hit a mech: shooting those who were not hostile costs standing and patience. */
  private onPlayerHit(victim: MechEntity, amount: number): void {
    if (!victim.brain || !isWarFactionId(victim.faction) || this.hostile(this.player, victim)) return;
    const faction = victim.faction;
    const squad = victim.brain.squadId;
    const total = (this.grievance.get(squad) ?? 0) + amount;
    this.grievance.set(squad, total);
    this.changeStanding(() => recordFriendlyFire(this.save.standing, faction, amount));
    if (total >= REPUTATION.provokeDamage && this.attitude(faction) !== "hostile") {
      this.notify(`You have provoked the ${FACTIONS[faction].short}: this squad will fight you.`, 5);
      for (const mech of this.mechs) if (mech.brain?.squadId === squad) this.wingmen.delete(mech), (mech.brain.follow = null);
      this.refreshMarkers();
    } else if (!this.message) {
      this.notify(`Check fire: that is a ${FACTIONS[faction].short} suit.`, 2);
    }
  }

  /** Allies near the player join a fight the player is in. */
  private rallyAllies(): void {
    const p = this.player.feet;
    for (const mech of this.mechs) {
      if (mech.brain && mech.alive && this.attitudeOfMech(mech) === "allied" && Vector3.Distance(mech.feet, p) < RALLY_RANGE) mech.brain.alert();
    }
  }

  /** Call the nearest allied pilots to follow the player, or send them home if some already do. */
  toggleWingmen(): void {
    if (this.wingmen.size > 0) {
      this.releaseWingmen();
      this.notify("Wingmen released.");
      return;
    }
    const p = this.player.feet;
    const near = this.mechs
      .filter((m) => m.brain && m.alive && !m.brain.passive && this.attitudeOfMech(m) === "allied" && Vector3.Distance(m.feet, p) < WINGMAN_RANGE)
      .sort((a, b) => Vector3.DistanceSquared(a.feet, p) - Vector3.DistanceSquared(b.feet, p))
      .slice(0, MAX_WINGMEN);
    if (near.length === 0) {
      this.notify("No allied pilots near enough to call.");
      return;
    }
    for (const mech of near) {
      mech.brain!.follow = this.player;
      this.wingmen.add(mech);
    }
    this.notify(`${near.length} ${FACTIONS[near[0]!.faction].short} ${near.length === 1 ? "pilot" : "pilots"} on your wing. ${this.input.keyName("wing")}: release.`, 4);
  }

  private releaseWingmen(): void {
    for (const mech of this.wingmen) if (mech.brain) (mech.brain.follow = null), (mech.brain.leaderThreatened = false);
    this.wingmen.clear();
  }

  private refreshMarkers(): void {
    for (const mech of this.mechs) if (mech !== this.player) this.hud.setMarkerColor(mech.visual.markerNode, attitudeColor(this.attitudeOfMech(mech)));
  }

  // --- The war ---

  /** True if the player is near enough to a site that what happens there must be played out for real. */
  private observed(siteId: string): boolean {
    const site = this.model.siteById.get(siteId);
    const p = this.player.feet;
    return site !== undefined && Math.hypot(site.x - p.x, site.z - p.z) < WAR.observeRange;
  }

  /** Living defenders of a site: pilots of whoever holds it. */
  private defendersLeft(siteId: string): number {
    const owner = this.ownerOf(siteId);
    return isWarFactionId(owner) ? garrisonLeft(this.population, siteId, owner) : 0;
  }

  /** One tick of the war, and whatever it changes around the player. */
  private warTick(): void {
    const events = stepWar(this.war, this.warMap, this.warContext);
    for (const event of events) this.onWarEvent(event);
    this.watchRaids();
    if (events.length > 0) this.store.write(this.save);
  }

  /** Rebuild a site's sleeping garrison from the war, unless the player is there to see it. */
  private syncSite(siteId: string, evenIfObserved = false): void {
    const site = this.model.siteById.get(siteId);
    if (site && (evenIfObserved || !this.observed(siteId))) syncGarrison(this.population, this.model, site, this.war, this.recordIds);
  }

  private onWarEvent(event: WarEvent): void {
    if (event.type === "reinforced" || event.type === "joined") {
      this.syncSite(event.site);
    } else if (event.type === "launched") {
      this.syncSite(event.raid.from);
      const target = this.model.siteById.get(event.raid.to)!;
      if (this.ownerOf(target.id) === "player") {
        const minutes = Math.max(1, Math.round((event.raid.eta * WAR.tickSeconds) / 60));
        this.notify(`${FACTIONS[event.raid.faction].name} raid heading for ${target.name}: about ${minutes} min. Defend it or lose it.`, 8);
      }
    } else if (event.type === "staged") {
      const target = this.model.siteById.get(event.raid.to)!;
      const from = this.model.siteById.get(event.raid.from)!;
      this.population.push(...raidRecords(this.model, event.raid, target, from, WAR.raidSpawnDistance, this.recordIds));
      this.notify(`${FACTIONS[event.raid.faction].name} raid closing on ${target.name}.`, 5);
    } else {
      this.syncSite(event.site);
      if (event.type === "captured") this.emit({ type: "siteCaptured", site: event.site, by: event.by });
      this.reportBattle(event);
    }
  }

  /** Tell the player how a raid ended, if it concerns them or a place they know. */
  private reportBattle(event: Extract<WarEvent, { type: "captured" | "repelled" }>): void {
    const site = this.model.siteById.get(event.site)!;
    const by = FACTIONS[event.by];
    if (event.type === "captured" && event.from === "player") {
      this.save.held = this.save.held.filter((id) => id !== site.id);
      this.notify(`${site.name} has fallen to the ${by.name}.`, 8);
    } else if (this.save.discovered.includes(site.id) && (!this.message || this.message.time < 1)) {
      const from = event.type === "captured" && isWarFactionId(event.from) ? ` from the ${FACTIONS[event.from].short}` : "";
      this.notify(event.type === "captured" ? `War report: the ${by.short} took ${site.name}${from}.` : `War report: a ${by.short} raid on ${site.name} was beaten off.`, 5);
    }
  }

  /** Follow the raids being played out with real mechs, and report each one's end to the war. */
  private watchRaids(): void {
    const p = this.player.feet;
    for (const raid of [...this.war.raids]) {
      if (!raid.staged) continue;
      const site = this.model.siteById.get(raid.to)!;
      const attackers = raidersLeft(this.population, raid.id);
      const defenders = this.defendersLeft(site.id);
      let result: WarEvent | null = null;
      // Raiders too far from the player to be awake march in unseen.
      let arrivedAll = true;
      let awake = false;
      for (const r of this.population) {
        if (!r.alive || (r.raidId !== raid.id && (r.siteId !== site.id || r.raidId !== undefined))) continue;
        awake ||= r.active;
        if (r.raidId !== raid.id) continue;
        const d = Math.hypot(site.x - r.x, site.z - r.z);
        if (d > RAID_ARRIVED && !r.active) {
          const stride = Math.min(d - RAID_ARRIVED, RAID_MARCH * WAR.tickSeconds);
          r.x += ((site.x - r.x) / d) * stride;
          r.z += ((site.z - r.z) / d) * stride;
        }
        if (Math.hypot(site.x - r.x, site.z - r.z) > site.radius + 40) arrivedAll = false;
      }
      if (attackers === 0) {
        result = endRaid(this.war, raid.id);
      } else if (!this.observed(site.id) || (!awake && arrivedAll && this.ownerOf(site.id) !== "player")) {
        // The player has left, or is too far off for anyone to be awake: finish it unseen with
        // whoever is still standing.
        result = settleRaid(this.war, this.warMap, raid.id, attackers, defenders);
      } else if (defenders === 0) {
        // The player holds their own base by standing in it.
        const contested = this.ownerOf(site.id) === "player" && this.player.alive && Math.hypot(p.x - site.x, p.z - site.z) < WAR.contestRange;
        const arrived = this.population.some((r) => r.raidId === raid.id && r.alive && Math.hypot(r.x - site.x, r.z - site.z) < site.radius + 40);
        if (contested || !arrived) continue;
        result = captureByRaid(this.war, this.warMap, raid.id, attackers);
        if (result) {
          // The survivors are the new garrison, where they stand.
          for (const r of this.population) {
            if (r.raidId !== raid.id) continue;
            delete r.raidId;
            r.squadId = `${site.id}:raid${raid.id}`;
          }
          for (const [mech, r] of this.records) if (r.squadId === `${site.id}:raid${raid.id}` && mech.brain) mech.brain.squadId = r.squadId;
        }
      }
      if (!result) continue;
      this.removeRaidRecords(raid.id);
      if (result.type === "captured" || result.type === "repelled") {
        // Awake pilots are kept as they are; anyone asleep is rebuilt to match the result.
        this.syncSite(result.site, true);
        this.reportBattle(result);
      }
      this.store.write(this.save);
    }
  }

  /** Take what is left of a finished raid out of the world. */
  private removeRaidRecords(raidId: number): void {
    for (let i = this.population.length - 1; i >= 0; i--) {
      const r = this.population[i]!;
      if (r.raidId !== raidId) continue;
      const mech = [...this.records].find(([, rec]) => rec === r)?.[0];
      // Survivors still in view walk on as stragglers; they are forgotten when they next sleep.
      if (mech && mech.alive) continue;
      this.population.splice(i, 1);
    }
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
    this.graphics.apply(settings.quality);
    this.effects.particles.scale = QUALITY[settings.quality].particles;
    this.weatherEffects.scale = QUALITY[settings.quality].particles;
    this.input.bindings = settings.bindings;
    this.input.sprintToggle = settings.sprintToggle;
    this.cameraRig.shakeScale = settings.shake;
    this.hud.setTextScale(settings.textScale);
    this.hud.setColors(settings.hudColors);
    for (const mech of this.mechs) if (mech !== this.player) this.hud.setMarkerColor(mech.visual.markerNode, attitudeColor(this.attitudeOfMech(mech)));
    // Menus are HTML: zoom them as a whole, so their layout scales with the text.
    this.screens.zoom(settings.textScale);
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
        this.store.write(this.save);
      },
      onResume: () => this.resume(),
      slots: () => this.store.list(),
      onSlot: (slot) => {
        this.store.select(slot);
        this.reload();
      },
      onSkipTraining: this.training
        ? () => {
            this.resume();
            this.skipTraining();
          }
        : undefined,
      onExport: () => downloadText(`robot-game-slot-${this.store.slot}.json`, writeSaveFile(this.save)),
      notice:
        this.store.damaged && !this.started
          ? {
              text: `The save in slot ${this.store.slot} could not be read, so this is a new game. A copy of the old save was kept.`,
              action: "Download the old save",
              run: () => void this.store.damagedCopy().then((raw) => raw && downloadText(`robot-game-slot-${this.store.slot}-damaged.json`, slotAsSaveFile(raw))),
            }
          : undefined,
      onImport: async (text) => {
        try {
          this.store.write(readSaveFile(text));
        } catch (e) {
          return e instanceof Error ? e.message : "That file could not be read.";
        }
        this.reload();
        return null;
      },
      onReset: () => {
        this.store.clear();
        this.reload();
      },
    });
  }

  /** Start the page again once everything written so far is stored. Nothing is saved after this. */
  private reload(): void {
    void this.store.close().then(() => location.reload());
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
    this.playerDid("hangar");
    this.mode = "hangar";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.sfx.ui();
    this.screens.showHangar({
      fireKeys: { primary: this.input.keyName("firePrimary"), secondary: this.input.keyName("fireSecondary"), tertiary: this.input.keyName("fireTertiary") },
      frame: this.save.frame,
      fit: this.save.fit,
      wallet: this.save,
      repairCost: repairCost(this.player.health),
      onTrade: () => {
        this.sfx.ui();
        this.store.write(this.save);
      },
      onDeploy: (frame, fit) => this.deploy(frame, fit),
    });
  }

  /** Take the price of putting the player's suit right out of their scrap. Returns what was paid. */
  private chargeRepair(): number {
    const bill = repairBill(repairCost(this.player.health), this.save.scrap);
    this.save.scrap -= bill;
    return bill;
  }

  /** Fit the frame and loadout chosen in the hangar, repair, and return to play. */
  deploy(frame: FrameId, fit: Fit): void {
    const changed = frame !== this.save.frame;
    const bill = this.chargeRepair();
    this.save.frame = frame;
    this.save.fit = fit;
    this.store.write(this.save);
    if (changed) {
      this.rebuildPlayer(frame);
    } else {
      this.player.applyLoadout(fitLoadout(fit, this.save.inventory), fitKit(fit, this.save.inventory));
      this.player.restore();
    }
    const paid = bill > 0 ? ` Repairs cost ${bill} scrap.` : "";
    this.notify((changed ? `${this.player.frame.name} frame ready.` : bill > 0 ? "Suit refitted and repaired." : "Suit refitted.") + paid, 4);
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
      faction: PLAYER_FACTION,
      position: at,
      yaw,
      loadout: fitLoadout(this.save.fit, this.save.inventory),
      kit: fitKit(this.save.fit, this.save.inventory),
    });
    this.mechs[this.mechs.indexOf(old)] = this.player;
    for (const mech of this.mechs) if (mech.lock.target === old) mech.lock.target = null;
    void this.player.visual.prewarm();
    this.onPlayerFrameChanged?.();
  }

  // --- Missions ---

  /** The scripted mission in progress, and how far it has got. */
  get mission(): { def: MissionDef; state: MissionState } | null {
    const state = this.save.missions.active;
    if (!state) return null;
    if (isContractId(state.id)) return this.contractMission && this.contractMission.id === state.id ? { def: this.contractMission, state } : null;
    const def = this.missions.find((m) => m.id === state.id);
    return def ? { def, state } : null;
  }

  /** The mission the contract in progress stands for, built once. */
  private contractBuilt: { spec: ContractSpec; def: MissionDef } | null = null;
  private get contractMission(): MissionDef | null {
    const spec = this.save.missions.contract;
    if (!spec) return null;
    if (this.contractBuilt?.spec !== spec) this.contractBuilt = { spec, def: contractDef(spec) };
    return this.contractBuilt.def;
  }

  /** The contracts on the board at a base. Only one mission can be in hand, so none can be taken while one is. */
  get contracts(): ContractSpec[] {
    const regions = new Map(this.model.def.regions.map((r) => [r.id, r.danger]));
    return contractsOnOffer(this.war, this.warMap, this.save.standing, (id) => regions.get(id) ?? 1);
  }

  /** Read the contract board. Only at a base. */
  openContracts(): void {
    if (!this.atBase) {
      this.notify("Contracts are posted at bases you hold, or an ally's.", 3);
      return;
    }
    const contracts = this.contracts;
    const busy = this.mission;
    this.mode = "briefing";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.sfx.ui();
    this.screens.showContracts({
      busy: busy ? `You already have ${busy.def.title} in hand. Finish it, or fail it, before taking a contract.` : null,
      contracts: contracts.map((spec) => {
        const def = contractDef(spec);
        return {
          title: def.title,
          from: def.briefing!.from,
          text: def.briefing!.text,
          rewards: this.rewardLines(def),
          color: cssColor(FACTIONS[spec.giver].colors.primary),
          onAccept: () => {
            this.takeContract(spec);
            this.resume();
          },
        };
      }),
      onClose: () => this.resume(),
    });
  }

  /** Take a contract from the board. Not while another mission is in hand. */
  takeContract(spec: ContractSpec): void {
    if (this.save.missions.active) return;
    this.save.missions.contract = spec;
    this.beginMission(contractDef(spec));
  }

  /** The campaign as it stands for this player: their patron's missions follow the shared ones. */
  get missions(): MissionDef[] {
    return campaignOf(this.save.missions.patron);
  }

  private readonly missionFacts: MissionFacts = {
    inArea: (place, radius) => this.inPlace(place, radius),
    defendersAt: (site) => this.defendersLeft(site),
    squadIn: (tag, place) => {
      const def = this.mission?.def;
      const squad = this.population.filter((r) => r.alive && r.siteId === this.missionRun && r.mission?.tag === tag);
      if (!def || squad.length === 0) return false;
      const at = this.placeOf(def, place);
      return squad.every((r) => Math.hypot(r.x - at.x, r.z - at.z) < at.radius);
    },
  };

  /** Where a mission's place is: one of its own, a site, or the nearest base the player holds. */
  private placeOf(def: MissionDef, place: string): PlaceDef {
    if (place === BASE_PLACE) return this.nearestOf(this.heldBases, this.player.feet.x, this.player.feet.z);
    return def.places?.[place] ?? this.model.siteById.get(place) ?? this.homeBase;
  }

  private inPlace(place: string, radius?: number): boolean {
    if (place === BASE_PLACE) return this.atBase;
    const def = this.mission?.def;
    if (!def) return false;
    const at = this.placeOf(def, place);
    return Math.hypot(this.player.feet.x - at.x, this.player.feet.z - at.z) < (radius ?? at.radius);
  }

  /** True if the mission in progress is waiting for this site to be cleared. */
  private awaited(siteId: string): boolean {
    const m = this.mission;
    return m !== null && awaitedSites(m.def, m.state).includes(siteId);
  }

  /** Metres walked (and sprinted) since the last `move` (and `sprint`) report. */
  private walked = { move: 0, sprint: 0 };
  private heatWarned = false;

  /** Tell a mission's training stage what the player has just done with the suit. */
  private playerDid(act: PlayerAct): void {
    const m = this.mission;
    if (m && inTraining(m.def, m.state)) this.emit({ type: "playerDid", act });
  }

  /** Compare the suit before and after a step, for training stages. */
  private reportActs(intent: Intent, before: { grounded: boolean; jetting: boolean; boosting: boolean }, dt: number): void {
    const m = this.mission;
    if (!m || !inTraining(m.def, m.state)) return;
    const s = this.player.state;
    if (s.grounded) {
      const d = this.player.horizontalSpeed * dt;
      this.walked.move += d;
      if (intent.sprint) this.walked.sprint += d;
      for (const act of ["move", "sprint"] as const) {
        while (this.walked[act] >= PLAYER_STRIDE) {
          this.walked[act] -= PLAYER_STRIDE;
          this.playerDid(act);
        }
      }
    }
    if (before.grounded && !s.grounded && intent.jump) this.playerDid("jump");
    if (!before.jetting && s.jetting) this.playerDid("jets");
    if (!before.boosting && s.boostTime > 0) this.playerDid("boost");
    const hot = s.overheated || s.heat / this.player.frame.heatCapacity >= FEEL.heatWarnFraction;
    if (hot && !this.heatWarned) this.playerDid("heatWarning");
    this.heatWarned = hot;
  }

  /** Whether the mission in progress is teaching the controls. */
  get training(): boolean {
    const m = this.mission;
    return m !== null && inTraining(m.def, m.state);
  }

  /** Leave the training stages of the mission in progress for its first real one. */
  skipTraining(): void {
    const m = this.mission;
    if (!m) return;
    this.applyMission(m.def, skipTraining(m.def, m.state));
    this.store.write(this.save);
  }

  /** Report something that has happened to the mission in progress and to anyone listening. */
  private emit(event: WorldEvent): void {
    const m = this.mission;
    if (m) missionEvent(m.def, m.state, event);
    this.onEvent?.(event);
  }

  /** Begin the next mission on offer, if it is one that starts by itself. */
  private offerMission(): void {
    if (this.save.missions.active || (this.missionHeld && !this.atBase)) return;
    this.missionHeld = false;
    const def = nextMission(this.missions, this.save.missions.done);
    if (def?.auto) this.beginMission(def);
  }

  /** The mission waiting to be taken at a base, if there is one. */
  get offered(): MissionDef | null {
    if (this.save.missions.active) return null;
    const def = nextMission(this.missions, this.save.missions.done);
    return def && !def.auto ? def : null;
  }

  /** The patrons with an offer waiting for the player at base, once the campaign has reached that point. */
  get offers(): PatronDef[] | null {
    const { active, patron, done } = this.save.missions;
    if (active || patron || !done.includes(PATRON_OFFER.after)) return null;
    return patronsOffering(PATRONS, this.save.standing);
  }

  /** Hear the patrons' offers. Only at a base. */
  openOffers(): void {
    const offers = this.offers;
    if (!offers || !this.atBase) return;
    this.mode = "briefing";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.sfx.ui();
    this.screens.showOffers({
      offers: offers.map((p) => ({ name: p.name, role: p.role, motto: p.motto, text: p.offer, color: cssColor(FACTIONS[p.faction].colors.primary), onTake: () => this.choosePatron(p.faction) })),
      onLater: () => this.resume(),
    });
  }

  /** Take a patron: the rest of the campaign is theirs. There is no going back on it. */
  choosePatron(faction: WarFactionId): void {
    const offers = this.offers;
    const patron = offers?.find((p) => p.faction === faction);
    if (!offers || !patron) return;
    this.changeStanding(() => takePatron(this.save.standing, offers, faction, PATRON_OFFER));
    this.save.missions.patron = faction;
    this.store.write(this.save);
    this.resume();
    this.notify(`You fly for the ${FACTIONS[faction].name} now.`, 6);
    this.say([{ speaker: "Hale", text: `${patron.speaker}. All right. I'll keep the radio room open either way, Magpie.` }]);
  }

  beginMission(def: MissionDef): void {
    // Training is for the first time through: a replay, or a player who has finished any
    // mission, goes straight to the real thing.
    const veteran = this.save.missions.done.length > 0;
    const { state, effects } = startMission(def, veteran);
    this.save.missions.active = state;
    this.runMission(def, effects);
  }

  /** Start a new playing of a mission (taken, or picked up from a save) and do what its stage asks. */
  private runMission(def: MissionDef, effects: MissionEffect[]): void {
    this.missionRun = `mission:${def.id}:${++this.missionRuns}`;
    this.applyMission(def, effects);
  }

  /** A mission is over: the pilots it brought in who are out of sight go; the rest walk on until they are. */
  private endRun(): void {
    this.missionRun = "";
    this.pendingDrops.length = 0;
    this.dropNames.clear();
    this.salvage.removeTagged();
    for (let i = this.population.length - 1; i >= 0; i--) {
      const r = this.population[i]!;
      if (r.mission && !r.active) this.population.splice(i, 1);
    }
  }

  /** What a mission pays, in words. */
  private rewardLines(def: MissionDef): string[] {
    const lines = def.reward.scrap > 0 ? [`${def.reward.scrap} scrap`] : [];
    for (const [faction, by] of Object.entries(def.reward.standing ?? {})) {
      if (isWarFactionId(faction) && by !== 0) lines.push(`${by > 0 ? "+" : ""}${by} standing with the ${FACTIONS[faction].short}`);
    }
    for (const item of def.reward.items ?? []) lines.push(specName(item));
    return lines;
  }

  /** Read the mission on offer. Only at a base. */
  openBriefing(): void {
    const def = this.offered;
    if (!def?.briefing || !this.atBase) return;
    this.mode = "briefing";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.sfx.ui();
    this.screens.showBriefing({
      title: def.title,
      type: def.type,
      from: def.briefing.from,
      text: def.briefing.text,
      rewards: this.rewardLines(def),
      onAccept: () => {
        this.beginMission(def);
        this.resume();
      },
      onLater: () => this.resume(),
    });
  }

  private stepMissions(dt: number): void {
    const m = this.mission;
    if (m) this.applyMission(m.def, stepMission(m.def, m.state, dt, this.missionFacts));
    else if (this.tick % 30 === 0) this.offerMission();
    // What a mission leaves to be found appears once there is ground to put it on.
    for (let i = this.pendingDrops.length - 1; i >= 0; i--) {
      const drop = this.pendingDrops[i]!;
      if (!this.terrain.hasGround(drop.x, drop.z)) continue;
      this.dropNames.set(drop.tag, drop.name);
      this.salvage.spawn(new Vector3(drop.x, this.heightAt(drop.x, drop.z) + 2.6, drop.z), { items: [], scrap: 0 }, null, drop.tag);
      this.pendingDrops.splice(i, 1);
    }
  }

  private applyMission(def: MissionDef, effects: MissionEffect[]): void {
    // The mission has moved on: what was still waiting to be said about the last stage is stale.
    if (effects.some((e) => e.do === "stage" || e.do === "complete" || e.do === "fail")) {
      this.comms.length = Math.min(this.comms.length, 1);
      if (this.comms[0]) this.comms[0].time = Math.min(this.comms[0].time, 1);
    }
    for (const effect of effects) {
      if (effect.do === "say") this.say(effect.lines);
      else if (effect.do === "notify") this.notify(effect.text, effect.seconds);
      // Not before play begins: a slot nobody has played in stays empty.
      else if (effect.do === "stage") this.started && this.store.write(this.save);
      else if (effect.do === "spawn") {
        // A squad that lasts across stages is brought in once.
        if (effect.keep && this.population.some((r) => r.alive && r.siteId === this.missionRun && r.mission?.tag === effect.tag)) continue;
        const route = (effect.route ?? []).map((place) => this.placeOf(def, place));
        this.population.push(...missionRecords(this.model, effect, this.placeOf(def, effect.at), this.missionRun, this.recordIds, route));
      }
      else if (effect.do === "drop") this.pendingDrops.push({ tag: effect.tag, name: effect.name, ...this.placeOf(def, effect.at) });
      else if (effect.do === "complete") this.completeMission(def);
      else this.failMission(def);
    }
  }

  /** The mission log: what is in progress, who the player flies for, and what has been done. */
  openLog(): void {
    const m = this.mission;
    const patron = PATRONS.find((p) => p.faction === this.save.missions.patron);
    this.mode = "briefing";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.sfx.ui();
    this.screens.showLog({
      current: m ? { title: m.def.title, objective: objectiveText(m.def, m.state, this.missionFacts, 0) } : null,
      next: m ? null : this.offers ? "Offers are waiting for you at any base you hold." : this.offered ? `${this.offered.title}: briefing at any base you hold.` : null,
      patron: patron ? `${patron.name}, ${patron.role}` : null,
      done: this.missions.filter((def) => this.save.missions.done.includes(def.id)).map((def) => ({ title: def.title, type: def.type, text: def.debrief.text })),
      total: Math.max(this.missions.length, CAMPAIGN_LENGTH),
      onClose: () => this.resume(),
    });
  }

  /** Put lines of dialogue on the radio, one after another. */
  say(lines: Line[]): void {
    for (const raw of lines) {
      const line = { ...raw, text: this.withKeys(raw.text) };
      this.comms.push({ line, time: FEEL.commsBase + line.text.length * FEEL.commsPerChar });
    }
  }

  private failMission(def: MissionDef): void {
    const contract = isContractId(def.id);
    this.save.missions.active = null;
    this.save.missions.contract = null;
    this.endRun();
    this.missionHeld = true;
    this.store.write(this.save);
    this.notify(contract ? `Contract void: ${def.title.replace("Contract: ", "")}.` : `Mission failed: ${def.title}. ${def.auto ? "Return to a base to try again." : "Take it again at a base."}`, 6);
  }

  private completeMission(def: MissionDef): void {
    const { scrap, standing } = def.reward;
    this.save.missions.active = null;
    this.save.missions.contract = null;
    this.endRun();
    // Contracts come round again; the campaign's missions are done once.
    if (!isContractId(def.id)) this.save.missions.done.push(def.id);
    const rewards = this.rewardLines(def);
    this.save.scrap += scrap;
    for (const item of def.reward.items ?? []) addItem(this.save.inventory, item);
    if (standing) {
      this.changeStanding(() => {
        for (const [faction, by] of Object.entries(standing)) if (isWarFactionId(faction)) awardStanding(this.save.standing, faction, by);
      });
    }
    this.store.write(this.save);
    this.mode = "complete";
    this.input.enabled = false;
    this.input.releasePointer();
    this.sfx.setThrust(0);
    this.screens.showComplete(
      { ...def.debrief, rewards, seconds: this.tick / 60, kills: this.kills, deaths: this.deaths, scrap: this.save.scrap, items: this.itemsSalvaged },
      !def.replayable ? null : () => {
        // Play the mission again: the garrisons it had the player clear return, and the player starts at home.
        this.save.missions.done = this.save.missions.done.filter((id) => id !== def.id);
        for (const stage of def.stages) {
          for (const goal of stage.goals) {
            const info = goal.when === "siteCleared" ? this.warMap.byId.get(goal.site) : undefined;
            if (!info) continue;
            this.save.cleared = this.save.cleared.filter((id) => id !== info.id);
            this.war.sites[info.id] = { owner: info.startOwner, troops: info.capacity };
            this.war.raids = this.war.raids.filter((r) => r.to !== info.id && r.from !== info.id);
          }
        }
        this.save.position = null;
        this.store.write(this.save);
        this.reload();
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
    const open = new Set(this.openBases.map((b) => b.id));
    const counts = siteCounts(this.war);
    const tint = (holder: Holder): string | null => (holder === "player" ? cssColor(FACTIONS[PLAYER_FACTION].colors.primary) : holder ? cssColor(FACTIONS[holder].colors.primary) : null);
    const control = regionControl(this.war, this.warMap);
    const blocked = !this.player.alive ? "Suit destroyed." : this.inCombat ? "Hostiles are engaged: break contact to travel." : null;
    this.screens.showMap({
      model: this.model,
      player: { x: this.player.feet.x, z: this.player.feet.z, yaw: this.input.yaw },
      region: `${this.region.name} (${DANGER[this.region.danger].name})`,
      sites: this.model.sites
        .filter((s) => this.save.discovered.includes(s.id) || held.has(s.id))
        .map((s) => {
          const owner = this.ownerOf(s.id);
          return {
            site: s,
            held: held.has(s.id),
            travel: open.has(s.id),
            hostile: isWarFactionId(owner) && this.attitude(owner) === "hostile",
            owner: isWarFactionId(owner) ? FACTIONS[owner].short : null,
            color: tint(owner),
            raided: this.war.raids.some((r) => r.to === s.id),
          };
        }),
      territory: Object.entries(control).map(([regionId, c]) => ({ regionId, color: tint(c.owner), contested: c.contested })),
      fronts: this.fronts,
      weather: this.weatherText() ? `${this.weatherText()} overhead.` : this.fronts.length > 0 ? "Clear here." : "Clear skies everywhere.",
      factions: WAR_FACTION_IDS.map((f) => ({
        name: FACTIONS[f].name,
        style: FACTIONS[f].style,
        color: cssColor(FACTIONS[f].colors.primary),
        standing: Math.round(this.save.standing[f]),
        attitude: this.attitude(f),
        sites: counts[f],
      })),
      total: this.model.sites.length,
      travelBlocked: blocked,
      onTravel: (id) => this.travelTo(id),
      onClose: () => this.resume(),
    });
  }

  /** Fast travel to a base the player holds. Returns false if that is not allowed right now. */
  travelTo(siteId: string): boolean {
    const base = this.openBases.find((b) => b.id === siteId);
    if (!base || !this.player.alive || this.inCombat) return false;
    this.releaseWingmen();
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
    this.store.write(this.save);
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
      this.salvage.spawn(new Vector3(x, this.heightAt(x, z) + 2.6, z), rollCache(rng, cacheTableFor(regionAt(this.model.def, site.x, site.z).danger)), site.id);
    }
  }

  /** Note any site the player has come upon, and take a base nobody holds on arrival. */
  private discoverSites(): void {
    const p = this.player.feet;
    for (const site of this.model.sites) {
      if (Math.hypot(p.x - site.x, p.z - site.z) > site.radius + STREAM.discoverMargin) continue;
      if (!this.save.discovered.includes(site.id)) {
        this.save.discovered.push(site.id);
        this.store.write(this.save);
        perfMark("discover");
        if (site.id !== this.model.def.homeBase) this.notify(`Discovered: ${site.name}`, 4);
      }
      if (site.kind === "base" && this.ownerOf(site.id) === null && this.war.sites[site.id]) this.holdBase(site);
    }
  }

  private holdBase(site: Site): void {
    if (this.ownerOf(site.id) !== "player") {
      clearSite(this.war, this.warMap, site.id, true);
      this.emit({ type: "siteCaptured", site: site.id, by: "player" });
    }
    if (site.held || this.save.held.includes(site.id)) return;
    this.save.held.push(site.id);
    this.store.write(this.save);
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
      // Still being made ready to show: drop it and put the pilot back to sleep as it was.
      const pending = this.waking.findIndex((w) => w.record === record);
      if (pending >= 0) {
        this.waking[pending]!.mech.dispose();
        this.waking.splice(pending, 1);
        record.active = false;
        continue;
      }
      const mech = this.mechs.find((m) => this.records.get(m) === record);
      if (!mech || this.wingmen.has(mech)) continue;
      record.active = false;
      record.yaw = mech.state.legsYaw;
      record.health = mech.health;
      record.patrolIndex = mech.brain?.state.patrolIndex ?? record.patrolIndex;
      this.removeMech(mech);
      // Stragglers of a raid that is over have nowhere to belong: they are gone once out of sight.
      if (record.raidId !== undefined && !this.war.raids.some((r) => r.id === record.raidId)) this.population.splice(this.population.indexOf(record), 1);
      // The same goes for pilots left over from a mission that has ended.
      else if (record.mission && record.siteId !== this.missionRun) this.population.splice(this.population.indexOf(record), 1);
    }
    for (const record of wake) {
      // Never before the ground under it has a collider.
      if (!this.terrain.hasGround(record.x, record.z)) continue;
      perfMark("wake");
      // A pilot is as tough as the region its site is in, wherever it has wandered to.
      const danger = DANGER[this.dangerOf(record)];
      const mech = new MechEntity(this.scene, {
        name: record.mission?.name ?? `${FACTIONS[record.faction].name} ${record.member.loadout}`,
        frame: FRAMES[record.member.frame],
        faction: record.faction,
        position: World.groundPoint(this.model, record.x, record.z, 0.6),
        yaw: record.yaw,
        loadout: ENEMY_LOADOUTS[record.member.loadout],
        armorScale: ENEMY_TUNING.armorScale * danger.armorScale * (record.mission?.tough ?? 1),
        damageScale: ENEMY_TUNING.damageScale * danger.damageScale * (record.mission?.deadly ?? 1),
      });
      if (record.health) mech.adoptHealth(record.health);
      mech.brain = new AiController(record.patrol, record.home, record.patrolIndex, record.squadId, AI_ROLES[record.member.role]);
      if (record.mission?.alert) mech.brain.alert();
      mech.brain.passive = record.mission?.passive ?? false;
      mech.brain.oneWay = record.mission?.route ?? false;
      record.active = true;
      // Hidden until it has been made ready to draw and revealed a few meshes at a time (see
      // `warmWaking`), so its first render does not land in one frame.
      mech.visual.root.setEnabled(false);
      const entry: Waking = { mech, record, meshes: null, next: 0, revealing: false };
      this.waking.push(entry);
      // Imported parts replace their procedural stand-ins once loaded: warm what will be drawn.
      void mech.visual.ready.then(() => {
        entry.meshes = mech.visual.root.getChildMeshes(false).filter((m) => m.isEnabled(false) && m.isVisible && m.getTotalVertices() > 0);
      });
    }
  }

  /** Mechs built but not yet in the world, being made ready to draw over a few frames. */
  private readonly waking: Waking[] = [];

  /**
   * Bring woken mechs in without a hitch, one at a time. First each mesh's shaders and passes are
   * worked out within `STREAM.wakeWarmMs` per rendered frame; then its meshes are shown
   * `STREAM.wakeRevealPerFrame` at a time, which spreads the cost of their first draw (on the
   * reference machine a whole mech appearing at once was a 30 to 50 ms frame). At wake distance a
   * mech is a few pixels across, so its pieces appearing over a few frames is not seen. It joins
   * the world (AI, combat, HUD marker) once fully shown.
   */
  private warmWaking(): void {
    const w = this.waking[0];
    if (!w?.meshes) return;
    if (!w.revealing) {
      const start = performance.now();
      while (w.next < w.meshes.length && performance.now() - start < STREAM.wakeWarmMs) w.meshes[w.next++]!.isReady(true);
      if (w.next < w.meshes.length) return;
      for (const m of w.meshes) m.setEnabled(false);
      w.mech.visual.root.setEnabled(true);
      w.revealing = true;
      w.next = 0;
    }
    w.mech.renderUpdate(1, 0);
    for (const end = Math.min(w.meshes.length, w.next + STREAM.wakeRevealPerFrame); w.next < end; w.next++) w.meshes[w.next]!.setEnabled(true);
    if (w.next < w.meshes.length) return;
    this.waking.shift();
    this.records.set(w.mech, w.record);
    this.mechs.push(w.mech);
    this.hud.addMarker(w.mech.visual.markerNode, attitudeColor(this.attitudeOfMech(w.mech)));
  }

  /** Take an enemy mech out of the scene (destroyed, or gone back to sleep). */
  private removeMech(mech: MechEntity): void {
    this.hud.removeMarker(mech.visual.markerNode);
    this.records.delete(mech);
    this.attackers.delete(mech);
    this.wingmen.delete(mech);
    // A squad's grudge lasts while any of it is in sight.
    const squad = mech.brain?.squadId;
    if (squad && !this.mechs.some((m) => m !== mech && m.brain?.squadId === squad)) this.grievance.delete(squad);
    if (this.aimedMech === mech) this.aimedMech = null;
    for (const other of this.mechs) if (other.lock.target === mech) other.lock.target = null;
    mech.dispose();
    this.mechs.splice(this.mechs.indexOf(mech), 1);
  }

  /**
   * Set the time of day: a fraction of a day (0 midnight, 0.5 noon) or a name ("dusk"). The
   * clock only moves forward, so the weather is unchanged.
   */
  setTime(time: number | string): void {
    const t = parseTime(time);
    if (t === null) throw new Error(`Not a time of day: ${time}`);
    skipTo(this.save.sky, t);
    this.updateSky();
  }

  /**
   * Hold the weather at the player: "clear", "storm", "rain", "dust" or a strength from 0 to 1.
   * Null lets the fronts decide again.
   */
  setWeather(weather: string | number | null): void {
    if (weather === null) {
      this.weatherForced = null;
      return;
    }
    const forced = parseWeather(weather);
    if (!forced) throw new Error(`Not a weather: ${weather}`);
    this.weatherForced = forced;
  }

  /** The fronts move with play time; the player's weather eases toward the weather where they stand. */
  private updateWeather(frameDt: number): void {
    const def = this.model.def;
    const p = this.player.feet;
    this.fronts = frontsAt(def.seed, this.save.sky.seconds);
    const natural = weatherAt(def, this.fronts, p.x, p.z);
    const target = this.weatherForced ? forceWeather(def, natural, this.weatherForced, p.x, p.z) : natural;
    const k = Math.min(1, frameDt * FOG_RATE);
    const w = this.weather;
    const rain = lerp(w.rain, target.rain, k);
    const dust = lerp(w.dust, target.dust, k);
    this.weather = { storm: rain + dust, rain, dust, heading: target.wind > 0 ? target.heading : w.heading, wind: lerp(w.wind, target.wind, k) };
  }

  /** Lightning in heavy rain: a flash now, thunder later the further off it struck. */
  private updateLightning(frameDt: number): void {
    this.lightning = Math.max(0, this.lightning - frameDt * 7);
    const above = WEATHER.lightningAbove;
    const heavy = (this.weather.rain - above) / (1 - above);
    if (heavy <= 0 || Math.random() >= WEATHER.lightningRate * heavy * frameDt) return;
    const distance = 300 + Math.random() * 2200;
    this.lightning = Math.max(this.lightning, 1 - distance / 3500);
    this.sfx.thunder(distance / 343, Math.max(0.3, 1 - distance / 3000));
  }

  /** Tell the player once when a storm reaches them, and name it in the HUD while it lasts. */
  private weatherText(): string | null {
    const name = weatherName(this.weather);
    return name === "rain" ? "Rainstorm" : name === "dust" ? "Dust storm" : null;
  }

  private noticeStorm(): void {
    const storm = this.weather.storm;
    if (!this.stormNoticed && storm > WEATHER.hudAbove + 0.15) {
      this.stormNoticed = true;
      if (!this.message) this.notify(weatherName(this.weather) === "dust" ? "A dust storm is blowing in." : "A rainstorm is sweeping in.", 4);
    } else if (this.stormNoticed && storm < WEATHER.hudAbove) {
      this.stormNoticed = false;
    }
  }

  /** The headlights shine from the player's chest along the aim, while they are on. */
  private updateHeadlight(): void {
    const light = this.headlight;
    const p = this.player;
    const on = this.headlightsOn && p.alive;
    light.intensity = on ? LIGHTS.headlight.intensity : 0;
    if (!on) return;
    const h = LIGHTS.headlight;
    const s = p.state;
    const at = p.renderPosition;
    const ahead = p.frame.height * h.forward;
    const sy = Math.sin(s.torsoYaw);
    const cy = Math.cos(s.torsoYaw);
    light.position.set(at.x + sy * ahead, at.y + p.frame.height * h.height, at.z + cy * ahead);
    const pitch = s.torsoPitch * h.followPitch - h.dip;
    light.direction.set(sy * Math.cos(pitch), Math.sin(pitch), cy * Math.cos(pitch));
  }

  /** The lights follow the time of day. */
  private updateSky(): void {
    const s = (this.sky = skyAt(timeOfDay(this.save.sky)));
    const sun = this.sunLight;
    sun.direction.set(s.lightDir.x, s.lightDir.y, s.lightDir.z);
    const through = weatherLight(this.weather);
    sun.intensity = s.sun * through.sun;
    sun.diffuse.set(s.sunColor[0], s.sunColor[1], s.sunColor[2]);
    sun.specular.copyFrom(sun.diffuse);
    const sky = this.skyLight;
    sky.intensity = s.sky * through.sky + this.lightning * 1.6;
    sky.diffuse.set(s.skyColor[0], s.skyColor[1], s.skyColor[2]);
    sky.groundColor.set(GROUND_LIGHT[0] * s.ground, GROUND_LIGHT[1] * s.ground, GROUND_LIGHT[2] * s.ground);
  }

  /** Sky and fog follow the mix of biomes where the player stands, tinted by the time of day. */
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
    const w = this.weather;
    const thick = weatherFog(f.start, f.end, [f.r, f.g, f.b], w);
    const tint = this.sky.fogTint;
    // A flash of lightning lights up the murk.
    const flash = 1 + this.lightning * 1.2;
    const r2 = Math.min(1, thick.color[0] * tint[0] * flash);
    const g2 = Math.min(1, thick.color[1] * tint[1] * flash);
    const b2 = Math.min(1, thick.color[2] * tint[2] * flash);
    this.scene.fogColor.set(r2, g2, b2);
    this.scene.clearColor.set(r2, g2, b2, 1);
    const dome = this.graphics.level.skyDome;
    if (dome !== this.domeOn) this.skyDome.enabled = this.domeOn = dome;
    if (dome) {
      // Under a storm the sky is one flat murk, with no stars.
      const z = this.sky.zenith;
      const flat = Math.min(1, w.storm * 1.2);
      this.skyDome.update(this.scene.fogColor, [lerp(z[0], 1, flat), lerp(z[1], 1, flat), lerp(z[2], 1, flat)], this.sky.stars * (1 - flat));
    }
    this.scene.fogStart = thick.start;
    this.scene.fogEnd = thick.end;
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
      this.emit({ type: "playerDestroyed" });
      return;
    }
    const byPlayer = attacker === this.player;
    const faction = victim.faction;
    if (byPlayer) {
      this.kills++;
      // The crate floats just above the wreck. Only the player's kills leave one: the war's
      // own dead would otherwise litter every battlefield with free parts.
      const record = this.records.get(victim);
      const danger = record ? this.dangerOf(record) : regionAt(this.model.def, ground.x, ground.z).danger;
      const table = isWarFactionId(faction) ? lootTableFor(faction, danger) : undefined;
      this.salvage.spawn(new Vector3(ground.x, ground.y + 2.6, ground.z), rollLoot(victim.loadout, this.rng, table));
      if (isWarFactionId(faction)) this.changeStanding(() => recordKill(this.save.standing, faction));
    }
    const record = this.records.get(victim);
    const tag = record?.mission && record.siteId === this.missionRun ? record.mission.tag : null;
    this.emit({ type: "mechDestroyed", faction, site: record && record.raidId === undefined && !record.mission ? record.siteId : null, tag, byPlayer });
    if (!record) return;
    record.alive = false;
    record.active = false;
    // Raiders belong to no garrison; `watchRaids` notices when the last of them is gone. Nor do
    // pilots a mission brought in.
    if (record.raidId !== undefined || record.mission) return;
    const site = this.model.siteById.get(record.siteId)!;
    const owner = this.ownerOf(site.id);
    // A stray whose site has changed hands since it left: nothing more to settle.
    if (owner !== faction || !isWarFactionId(owner)) return;
    const left = this.defendersLeft(site.id);
    setTroops(this.war, site.id, left);
    if (left > 0) {
      if (byPlayer) this.notify(`${FACTIONS[owner].short} suit destroyed. ${left} remaining at ${site.name}.`, 4);
      return;
    }
    // Asked before the mission hears of it: by then it may have moved on.
    const awaited = this.awaited(site.id);
    const now = clearSite(this.war, this.warMap, site.id, byPlayer);
    this.emit({ type: "siteCleared", site: site.id, byPlayer });
    if (now === "player") this.emit({ type: "siteCaptured", site: site.id, by: "player" });
    if (!byPlayer) {
      this.store.write(this.save);
      return;
    }
    this.changeStanding(() => recordCapture(this.save.standing, owner));
    if (!this.save.cleared.includes(site.id)) this.save.cleared.push(site.id);
    if (awaited) {
      // The mission in progress says what happens next.
    } else if (now === "player") {
      this.holdBase(site);
    } else if (now === owner) {
      this.notify(`${site.name} cleared, but the ${FACTIONS[owner].short} will not give up their home.`, 6);
    } else {
      this.notify(`${site.name} cleared. It stands empty for whoever comes next.`, 5);
    }
    this.store.write(this.save);
  }

  /** The danger of the region a pilot's site is in. */
  private dangerOf(record: MechRecord): Danger {
    const site = this.model.siteById.get(record.siteId);
    return regionAt(this.model.def, site?.x ?? record.x, site?.z ?? record.z).danger;
  }

  /** Mission text names keys as `{key:jump}`: write in what the player has bound to them. */
  private withKeys(text: string): string {
    return text.replace(/\{key:(\w+)\}/g, (_, action: string) => (isActionId(action) ? this.input.keyName(action) : action));
  }

  notify(text: string, seconds = 3): void {
    text = this.withKeys(text);
    this.message = { text, time: seconds };
  }

  private respawnPlayer(): void {
    this.releaseWingmen();
    const base = this.nearestHeldBase(this.player.feet.x, this.player.feet.z);
    const bill = this.chargeRepair();
    this.player.restore();
    this.movePlayer(base.x, base.z, base.id === this.model.def.homeBase ? World.homeYaw(this.model) : 0);
    this.store.write(this.save);
    this.notify(`Suit restored at ${base.name}.${bill > 0 ? ` Repairs cost ${bill} scrap.` : ""}`, 5);
  }

  private collectSalvage(): void {
    const drops = this.salvage.collectNear(this.player.feet);
    if (drops.length === 0) return;
    const names: string[] = [];
    let scrap = 0;
    for (const { drop, site, tag } of drops) {
      // A site's cache is spent once its last crate is taken.
      if (site && this.salvage.countAt(site) === 0 && !this.save.looted.includes(site)) this.save.looted.push(site);
      this.emit({ type: "itemCollected", tag, count: 1 });
      if (tag) names.push(this.dropNames.get(tag) ?? tag);
      scrap += drop.scrap;
      for (const item of drop.items) {
        addItem(this.save.inventory, item);
        names.push(specName(item));
        this.itemsSalvaged++;
      }
    }
    this.save.scrap += scrap;
    this.store.write(this.save);
    this.sfx.pickup();
    this.notify(`Salvaged: ${[...names, ...(scrap > 0 || names.length === 0 ? [`${scrap} scrap`] : [])].join(", ")}`, 5);
  }

  /** Footfalls and landings: sound for every mech in earshot, dust, and a camera kick for the player. */
  private groundFeedback(mech: MechEntity): void {
    const s = mech.state;
    const isPlayer = mech === this.player;
    const at = isPlayer ? null : mech.feet;
    if (s.landImpact >= FEEL.landMinSpeed) {
      const strength = Math.min(1, s.landImpact / FEEL.landFullSpeed);
      this.sfx.land(strength, at);
      this.effects.dust(mech.feet, mech.frame.radius * (1.2 + 1.8 * strength));
      if (isPlayer) this.cameraRig.shake(FEEL.landShake * strength);
    } else if (s.footstep) {
      // Light frames clank higher, heavy ones lower: 0 for the lightest build, 1 for the heaviest.
      const mass = Math.min(1, Math.max(0, (mech.frame.look.bulk - 0.8) / 0.5));
      this.sfx.footstep(Math.min(1, mech.horizontalSpeed / mech.frame.sprintSpeed), mass, at);
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
        if (!this.message) this.notify(`Entering ${region.name}: ${DANGER[region.danger].name}`, 4);
      }
    }
    if (this.tick % POSITION_SAVE_TICKS === 0 && this.player.state.grounded) this.savePosition();
    if (this.tick % (WAR.tickSeconds * 60) === 0 && !this.warPaused) this.warTick();
    if (!this.skyPaused) this.save.sky.seconds += dt;
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
      const before = { grounded: this.player.state.grounded, jetting: this.player.state.jetting, boosting: this.player.state.boostTime > 0 };
      this.player.step(intent, dt);
      this.reportActs(intent, before, dt);
      // The rim mountains are the wall; this is the backstop for anyone who jets up them.
      if (this.player.confine(this.model.def.size / 2 - this.model.def.edgeMargin)) this.notify("The mountains are impassable. Turn back.", 2);
      this.groundFeedback(this.player);
      this.combat.stepMech(this.player, intent);
      this.heatFeedback();
      this.collectSalvage();
    } else {
      this.aimedMech = null;
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawnPlayer();
    }
    this.stepMissions(dt);

    perfEnd("step.player", t);
    t = perfStart();

    // Only a few of the pilots fighting the player may fire at once; see ENEMY_TUNING.maxAttackers.
    // Pilots fighting each other are not rationed.
    const fighting = this.mechs.filter((m) => m.brain && m.alive && m.brain.state.mode !== "patrol" && m.brain.target === this.player);
    this.attackers = pickAttackers(
      fighting.map((m) => ({ pilot: m, distance: m.brain!.targetDistance, holding: this.attackers.has(m) })),
      ENEMY_TUNING.maxAttackers,
    );

    // Wingmen join a fight as soon as an enemy near the player is hunting the player or one of
    // them, without waiting to see it themselves (ruins and ridges hide raiders until they are close).
    if (this.wingmen.size > 0) {
      const p = this.player.feet;
      const threatened = this.mechs.some((m) => {
        const t = m.brain?.target;
        return m.alive && t && m.brain!.state.mode !== "patrol" && (t === this.player || this.wingmen.has(t)) && Vector3.Distance(m.feet, p) < RALLY_RANGE;
      });
      for (const mech of this.wingmen) if (mech.brain) mech.brain.leaderThreatened = threatened;
    }

    for (const mech of this.mechs) {
      if (!mech.brain || !mech.alive) continue;
      const before = mech.brain.state.mode;
      // A suit under escort waits for the player to catch up.
      const waitFor = this.records.get(mech)?.mission?.waitFor;
      mech.brain.hold = waitFor !== undefined && (!this.player.alive || Vector3.Distance(mech.feet, this.player.feet) > waitFor);
      const weaponsFree = mech.brain.target !== this.player || this.attackers.has(mech);
      const intent = mech.brain.think(mech, this.mechs, this.scene, this.tick, dt, this.rng, weaponsFree, this.hostileRule);
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
    if (this.comms[0] && (this.comms[0].time -= dt) <= 0) this.comms.shift();
  }

  private readonly hostileRule = (a: MechEntity, b: MechEntity): boolean => this.hostile(a, b);

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
    const base = this.nearestOf(this.openBases, p.x, p.z);
    blips.push(rel(base.x, base.z, "base"));
    // Known sites held by a hostile faction, when they are near enough to matter.
    for (const site of this.model.sites) {
      const owner = this.ownerOf(site.id);
      if (!isWarFactionId(owner) || this.attitude(owner) !== "hostile" || this.defendersLeft(site.id) === 0) continue;
      const known = this.save.discovered.includes(site.id) || this.awaited(site.id);
      if (known && Math.hypot(site.x - p.x, site.z - p.z) < 1500) blips.push(rel(site.x, site.z, "outpost"));
    }
    for (const pos of this.salvage.positions) blips.push(rel(pos.x, pos.z, "salvage"));
    for (const mech of this.others) {
      const attitude = this.attitudeOfMech(mech);
      blips.push(rel(mech.feet.x, mech.feet.z, attitude === "hostile" ? "enemy" : attitude));
    }
    return blips;
  }

  /** True if a living enemy has a full missile lock on the player. */
  private get lockedOn(): boolean {
    return this.player.alive && this.mechs.some((m) => m !== this.player && m.alive && this.combat.lockedTarget(m) === this.player);
  }

  /** Who holds the ground the player is on, for the HUD. */
  private regionHolder(): string {
    const owner = regionControl(this.war, this.warMap)[this.region.id]?.owner ?? null;
    return owner === "player" ? "yours" : owner ? FACTIONS[owner].short : "unheld";
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
    const k = (action: ActionId): string => this.input.keyName(action);
    if (this.headlightsOn) lines.push(`Press ${k("lights")}: headlights off`);
    else if (this.sky.light < LIGHTS.hintBelow) lines.push(`Press ${k("lights")}: headlights`);
    lines.push(`Scrap ${this.save.scrap}`);
    const weather = this.weatherText();
    if (weather) lines.push(weather);
    lines.push(`${this.region.name} (${this.regionHolder()}) · ${k("map")}: map`);
    if (this.wingmen.size > 0) lines.push(`Wingmen: ${this.wingmen.size} · ${k("wing")}: release`);
    else if (this.alliesNear) lines.push(`Press ${k("wing")}: call wingmen`);
    if (this.atBase && this.player.alive) lines.push(`Press ${k("hangar")}: hangar (refit, repair)`);
    if (this.atBase && this.player.alive && this.offers) lines.push(`Press ${k("briefing")}: hear the offers`);
    else if (this.atBase && this.player.alive && this.offered) lines.push(`Press ${k("briefing")}: mission briefing`);
    if (this.atBase && this.player.alive) lines.push(`Press ${k("contracts")}: contracts`);
    return lines.join("\n");
  }

  /** A mech's name for the target readout, marked if it is not an enemy. */
  private targetName(mech: MechEntity): string {
    const attitude = this.attitudeOfMech(mech);
    return attitude === "hostile" ? mech.name : `${mech.name} (${attitude})`;
  }

  /** True if an allied pilot is close enough to call as a wingman. */
  private get alliesNear(): boolean {
    const p = this.player.feet;
    return this.mechs.some((m) => m.brain && m.alive && !m.brain.passive && Vector3.Distance(m.feet, p) < WINGMAN_RANGE && this.attitudeOfMech(m) === "allied");
  }

  /** Per-frame visual update. `alpha` is the fraction of a step since the last simulation step. */
  render(alpha: number, frameDt: number): void {
    this.input.pollGamepad(frameDt);
    const playing = this.mode === "playing";
    // Streaming runs every frame, menus included, so the world is ready when play resumes.
    this.terrain.update(this.player.feet.x, this.player.feet.z);
    this.warmWaking();
    this.updateWeather(playing ? frameDt : 0);
    if (playing) {
      this.updateLightning(frameDt);
      this.noticeStorm();
    }
    this.updateSky();
    this.updateFog(playing ? frameDt : 0);
    let t = perfStart();
    const lamps = lampsWanted(this.sky);
    for (const mech of this.mechs) {
      mech.lights = mech === this.player ? this.headlightsOn : lamps;
      mech.renderUpdate(playing ? alpha : 1, playing ? frameDt : 0);
      if (playing && mech.alive && mech.visual.thrust > 0.05) for (const at of mech.visual.jetPoints()) this.effects.particles.exhaust(at, mech.visual.thrust);
    }
    this.cameraRig.update(this.player, this.input.yaw, this.input.pitch, frameDt);
    this.updateHeadlight();
    if (playing) {
      this.effects.update(frameDt);
      this.salvage.update(frameDt);
      this.hitFlash = Math.max(0, this.hitFlash - frameDt * 6);
      this.damageFlash = Math.max(0, this.damageFlash - frameDt * 2.5);
      this.killFlash = Math.max(0, this.killFlash - frameDt * 1.6);
      const s = this.player.state;
      this.sfx.setThrust(!this.player.alive ? 0 : s.boostTime > 0 ? 1 : s.jetting ? 0.7 : 0);
      this.sfx.setServo(this.player.alive && s.grounded ? Math.min(1, this.player.horizontalSpeed / this.player.frame.sprintSpeed) : 0);
      this.sfx.setWeather(this.weather.rain, this.weather.dust);
      this.weatherEffects.update(this.cameraRig.camera.position, this.weather);
    } else {
      this.sfx.setServo(0);
      this.weatherEffects.idle();
    }
    const ears = this.cameraRig.camera.position;
    this.sfx.setListener(ears.x, ears.y, ears.z, this.input.yaw);

    perfEnd("visuals", t);
    t = perfStart();
    const s = this.player.state;
    const m = this.mission;
    const offered = m ? null : this.offered;
    // With a mission waiting, the compass points at the nearest base to take it from.
    const offers = m ? null : this.offers;
    const waypoint = m ? currentStage(m.def, m.state).waypoint : offers ? { place: BASE_PLACE, label: "OFFERS" } : offered ? { place: BASE_PLACE, label: "MISSION" } : undefined;
    const goal = !waypoint ? null : waypoint.place === BASE_PLACE ? this.nearestOf(this.heldBases, this.player.feet.x, this.player.feet.z) : this.placeOf(m?.def ?? offered!, waypoint.place);
    // A place that is only a spot on the ground, not a site, gets a beacon to walk to.
    const spot = m && waypoint ? m.def.places?.[waypoint.place] : undefined;
    if (spot) this.placeMarker.show(spot.x, this.heightAt(spot.x, spot.z), spot.z, spot.radius);
    else this.placeMarker.hide();
    const objective = m
      ? this.withKeys(objectiveText(m.def, m.state, this.missionFacts, this.salvage.count))
      : offers
        ? `${offers.length === 1 ? "An offer is" : `${offers.length} offers are`} waiting for you. Hear ${offers.length === 1 ? "it" : "them"} at any base you hold`
        : offered
        ? `New mission: ${offered.title}. Briefing at any base you hold`
        : `Explore the Marches: ${this.save.discovered.length} of ${this.model.sites.length} places found`;
    const hudState: HudState = {
      energy: s.energy / this.player.frame.energyMax,
      heat: s.heat / this.player.frame.heatCapacity,
      overheated: s.overheated,
      cockpit: this.cameraRig.mode === "cockpit",
      sections: this.sectionFractions(),
      target: this.aimedMech ? { name: this.targetName(this.aimedMech), health: healthFraction(this.aimedMech.health) } : null,
      objective,
      // Without the mouse captured there is no looking around; say how to get it back.
      message:
        this.message?.text ?? (this.lockedOn ? "MISSILE LOCK: break line of sight or dash" : this.input.needsPointer ? "Click the view to capture the mouse" : null),
      heading: this.input.yaw,
      comms: this.comms[0]?.line ?? null,
      waypoint:
        goal && waypoint
          ? { bearing: Math.atan2(goal.x - this.player.feet.x, goal.z - this.player.feet.z), distance: Math.hypot(goal.x - this.player.feet.x, goal.z - this.player.feet.z), label: waypoint.label }
          : null,
      heatWarnAt: FEEL.heatWarnFraction,
      hitFlash: this.hitFlash,
      killFlash: this.killFlash,
      damageFlash: this.damageFlash,
      info: this.infoText(),
      radar: this.radarBlips(),
    };
    this.hud.update(hudState);
    this.cockpit.setVisible(this.cameraRig.mode === "cockpit" && !this.cameraRig.showcase && this.player.alive);
    this.cockpit.setGlow(darkness(this.sky));
    this.cockpit.update(hudState, frameDt);
    perfEnd("hud", t);
    t = perfStart();
    this.graphics.update(this.player.renderPosition, this.mechs, frameDt);
    this.scene.render();
    perfEnd("scene.render", t);
  }
}
