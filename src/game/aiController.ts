import { Scene, Vector3 } from "../babylon";
import { blocksFire, createAiState, DEFAULT_AI, thinkAi, type AiConfig, type AiState } from "../sim/ai/brain";
import { healthFraction } from "../sim/damage";
import type { Intent } from "../sim/intent";
import type { Vec3 } from "../sim/math";
import type { MechEntity } from "./mechEntity";
import { raycastWorld } from "./physics";

/** How often (in ticks) each AI refreshes its line-of-sight and obstacle checks. */
const SENSE_INTERVAL = 6;
let nextPhase = 0;

/**
 * Gathers what an AI pilot can perceive and asks the pure brain (sim/ai/brain.ts) for an Intent.
 */
export class AiController {
  readonly state: AiState;
  private readonly phase = nextPhase++ % SENSE_INTERVAL;
  private targetVisible = false;
  private blockedAhead = false;
  private fireBlocked = false;
  /** The hostile this pilot is fighting or watching: the nearest one alive, as of the last think. */
  target: MechEntity | null = null;
  /** Wingmen: the mech to stay close to when there is nothing to fight. */
  follow: MechEntity | null = null;
  /** Set for suits a mission has under escort: see `AiView`. */
  passive = false;
  oneWay = false;
  hold = false;

  constructor(
    private readonly patrol: Vec3[],
    private readonly home: Vec3,
    patrolIndex: number,
    /** Pilots in the same squad share alarms. */
    public squadId: string,
    private readonly cfg: AiConfig = DEFAULT_AI,
  ) {
    this.state = createAiState(patrolIndex);
  }

  alert(): void {
    this.state.alerted = true;
  }

  /** Distance to the nearest living hostile, as of the last think. */
  targetDistance = Infinity;

  think(
    self: MechEntity,
    mechs: readonly MechEntity[],
    scene: Scene,
    tick: number,
    dt: number,
    rng: () => number,
    weaponsFree: boolean,
    /** Who attacks whom on sight; with three or more sides this is not just "everyone else". */
    hostile: (a: MechEntity, b: MechEntity) => boolean,
  ): Intent {
    let target: MechEntity | null = null;
    let best = Infinity;
    for (const other of mechs) {
      if (other === self || !other.alive || !hostile(self, other)) continue;
      const d = Vector3.DistanceSquared(other.feet, self.feet);
      if (d < best) {
        best = d;
        target = other;
      }
    }

    this.targetDistance = Math.sqrt(best);
    this.target = target;

    const eye = new Vector3(self.feet.x, self.feet.y + self.frame.height * 0.7, self.feet.z);
    if (tick % SENSE_INTERVAL === this.phase) {
      this.targetVisible = target !== null && raycastWorld(scene, eye, target.center) === null;
      // Shots pass through friends (there is no friendly fire between AI pilots), but a pilot
      // who fires through them looks wrong and wastes heat on a target it cannot see properly.
      this.fireBlocked = false;
      if (target) {
        for (const other of mechs) {
          if (other === self || other === target || !other.alive || hostile(self, other)) continue;
          if (blocksFire(eye, target.center, other.center, other.frame.radius + 1.2)) {
            this.fireBlocked = true;
            break;
          }
        }
      }
      const s = self.state;
      const moving = self.horizontalSpeed > 1;
      const dirX = moving ? s.vel.x / self.horizontalSpeed : Math.sin(s.legsYaw);
      const dirZ = moving ? s.vel.z / self.horizontalSpeed : Math.cos(s.legsYaw);
      const knee = new Vector3(self.feet.x, self.feet.y + 1.6, self.feet.z);
      this.blockedAhead = raycastWorld(scene, knee, knee.add(new Vector3(dirX * 6, 0.8, dirZ * 6))) !== null;
    }

    return thinkAi(
      this.state,
      {
        feet: self.feet,
        eye,
        speed: self.horizontalSpeed,
        healthFrac: healthFraction(self.health),
        heatFrac: self.state.heat / self.frame.heatCapacity,
        energyFrac: self.state.energy / self.frame.energyMax,
        target: target ? { center: target.center, vel: target.state.vel, visible: this.targetVisible } : null,
        weaponsFree,
        blockedAhead: this.blockedAhead,
        fireBlocked: this.fireBlocked,
        follow: this.follow?.alive ? this.follow.feet : null,
        patrol: this.patrol,
        home: this.home,
        passive: this.passive,
        oneWay: this.oneWay,
        hold: this.hold,
      },
      this.cfg,
      dt,
      rng,
      self.state.torsoYaw,
    );
  }
}
