import { idleIntent, type Intent } from "../intent";
import { add, distanceXZ, forwardFromYawPitch, scale, sub, yawFromDir, type Vec3 } from "../math";

export type AiMode = "patrol" | "engage" | "retreat";

export interface AiConfig {
  detectRange: number;
  /** Give up the chase beyond this distance once the target has been out of sight for a while. */
  loseRange: number;
  /** Preferred fighting band. */
  minRange: number;
  maxRange: number;
  /** Fall back toward home once below this health fraction (once per fight). */
  retreatHealth: number;
  /** Aim error in radians; higher is a worse shot. */
  aimJitter: number;
  /** Seconds between spotting a target and reacting. */
  reaction: number;
  /** How hard the pilot strafes while fighting, 0 (plants its feet) to 1. */
  strafe: number;
  /** Evasive dashes per second while a target is in sight. */
  dashRate: number;
  /** Hold fire beyond this distance (short-ranged weapons would only build heat). */
  fireRange: number;
}

export const DEFAULT_AI: AiConfig = {
  detectRange: 120,
  loseRange: 280,
  minRange: 45,
  maxRange: 110,
  retreatHealth: 0.3,
  aimJitter: 0.035,
  reaction: 0.5,
  strafe: 0.8,
  dashRate: 0.25,
  fireRange: 400,
};

/** How a pilot fights. Squads mix roles so that a fight has more than one problem in it. */
export const AI_ROLES = {
  /** Holds the middle distance and trades fire. */
  line: DEFAULT_AI,
  /** Never stops moving: closes in, circles hard, dashes often. */
  skirmisher: { ...DEFAULT_AI, minRange: 18, maxRange: 50, strafe: 1, dashRate: 0.7, retreatHealth: 0.4, aimJitter: 0.045, fireRange: 120 },
  /** Stays back and stands its ground, which lets a heavy frame brace. */
  support: { ...DEFAULT_AI, detectRange: 150, minRange: 80, maxRange: 170, strafe: 0, dashRate: 0.05, retreatHealth: 0.15, reaction: 0.8 },
} satisfies Record<string, AiConfig>;

export type AiRole = keyof typeof AI_ROLES;

export interface AiState {
  mode: AiMode;
  /** Set by the game when the mech is shot or a squadmate raises the alarm. */
  alerted: boolean;
  patrolIndex: number;
  strafeDir: -1 | 1;
  strafeTimer: number;
  burstTimer: number;
  firing: boolean;
  reactionTimer: number;
  unseenTimer: number;
  retreatTimer: number;
  hasRetreated: boolean;
  stuckTimer: number;
  jumpTimer: number;
  jitterTimer: number;
  jitterYaw: number;
  jitterPitch: number;
  lastSeen: Vec3 | null;
}

export function createAiState(patrolIndex = 0): AiState {
  return {
    mode: "patrol",
    alerted: false,
    patrolIndex,
    strafeDir: 1,
    strafeTimer: 0,
    burstTimer: 0,
    firing: false,
    reactionTimer: 0,
    unseenTimer: 0,
    retreatTimer: 0,
    hasRetreated: false,
    stuckTimer: 0,
    jumpTimer: 0,
    jitterTimer: 0,
    jitterYaw: 0,
    jitterPitch: 0,
    lastSeen: null,
  };
}

/** Everything the brain is allowed to know this step, gathered by the game layer. */
export interface AiView {
  feet: Vec3;
  /** Weapon height, where aim is measured from. */
  eye: Vec3;
  speed: number;
  healthFrac: number;
  heatFrac: number;
  energyFrac: number;
  /** Nearest hostile, or null if none is alive. */
  target: { center: Vec3; vel: Vec3; visible: boolean } | null;
  /** False while other pilots hold the attack slots: hold fire and hang back. */
  weaponsFree: boolean;
  /** True if static geometry is close in front of the legs. */
  blockedAhead: boolean;
  patrol: Vec3[];
  home: Vec3;
}

/** Convert a desired world-space travel direction into strafe/forward input relative to the aim yaw. */
function moveInput(dirX: number, dirZ: number, aimYaw: number, strength = 1): { moveX: number; moveZ: number } {
  const l = Math.hypot(dirX, dirZ);
  if (l < 1e-6) return { moveX: 0, moveZ: 0 };
  const x = dirX / l;
  const z = dirZ / l;
  const sin = Math.sin(aimYaw);
  const cos = Math.cos(aimYaw);
  return { moveX: (x * cos - z * sin) * strength, moveZ: (x * sin + z * cos) * strength };
}

function aimAt(intent: Intent, eye: Vec3, point: Vec3, jitterYaw = 0, jitterPitch = 0): number {
  const to = sub(point, eye);
  const flat = Math.hypot(to.x, to.z);
  const dist = Math.hypot(flat, to.y);
  intent.aimYaw = yawFromDir(to.x, to.z) + jitterYaw;
  intent.aimPitch = Math.atan2(to.y, Math.max(flat, 0.001)) + jitterPitch;
  intent.aimPoint = add(eye, scale(forwardFromYawPitch(intent.aimYaw, intent.aimPitch), dist));
  return dist;
}

/**
 * Decide what one AI pilot does this step. Pure: all world knowledge comes in through
 * `view`, all randomness through `rng`, so behaviour is reproducible and unit-testable.
 */
export function thinkAi(ai: AiState, view: AiView, cfg: AiConfig, dt: number, rng: () => number, currentYaw: number): Intent {
  const intent = idleIntent(currentYaw);
  const target = view.target;
  const targetDist = target ? Math.hypot(target.center.x - view.eye.x, target.center.y - view.eye.y, target.center.z - view.eye.z) : Infinity;

  // --- Mode transitions ---
  if (ai.mode === "patrol") {
    const spotted = target !== null && target.visible && targetDist < cfg.detectRange;
    if (target && (spotted || ai.alerted)) {
      ai.reactionTimer += dt;
      if (ai.reactionTimer >= cfg.reaction || ai.alerted) {
        ai.mode = "engage";
        ai.unseenTimer = 0;
        ai.burstTimer = 0.3 + rng() * 0.5;
        ai.firing = false;
      }
    } else {
      ai.reactionTimer = 0;
    }
  } else if (!target) {
    ai.mode = "patrol";
    ai.alerted = false;
  } else if (ai.mode === "engage") {
    if (target.visible) {
      ai.unseenTimer = 0;
      ai.lastSeen = target.center;
    } else {
      ai.unseenTimer += dt;
    }
    if (ai.unseenTimer > 10 && targetDist > cfg.loseRange) {
      ai.mode = "patrol";
      ai.alerted = false;
      ai.reactionTimer = 0;
    } else if (!ai.hasRetreated && view.healthFrac < cfg.retreatHealth) {
      ai.mode = "retreat";
      ai.hasRetreated = true;
      ai.retreatTimer = 7;
    }
  } else if (ai.mode === "retreat") {
    ai.retreatTimer -= dt;
    if (ai.retreatTimer <= 0 || distanceXZ(view.feet, view.home) < 12) ai.mode = "engage";
  }

  // --- Unsticking: if we want to move but are not, hop with the jets and change direction ---
  if (ai.jumpTimer > 0) ai.jumpTimer -= dt;

  // --- Behaviour ---
  if (ai.mode === "patrol" || !target) {
    const goal = view.patrol[ai.patrolIndex % Math.max(1, view.patrol.length)] ?? view.home;
    if (distanceXZ(view.feet, goal) < 7) ai.patrolIndex = (ai.patrolIndex + 1) % Math.max(1, view.patrol.length);
    aimAt(intent, view.eye, { x: goal.x, y: view.eye.y, z: goal.z });
    intent.aimPoint = null;
    intent.moveZ = 0.6;
    trackStuck(ai, view, true, dt);
  } else {
    // Refresh aim error a few times a second so shots scatter around the target.
    ai.jitterTimer -= dt;
    if (ai.jitterTimer <= 0) {
      ai.jitterTimer = 0.25 + rng() * 0.3;
      ai.jitterYaw = (rng() * 2 - 1) * cfg.aimJitter;
      ai.jitterPitch = (rng() * 2 - 1) * cfg.aimJitter * 0.6;
    }
    const focus = target.visible ? target.center : (ai.lastSeen ?? target.center);
    aimAt(intent, view.eye, focus, ai.jitterYaw, ai.jitterPitch);

    ai.strafeTimer -= dt;
    if (ai.strafeTimer <= 0 || (view.blockedAhead && ai.strafeTimer < 1)) {
      ai.strafeTimer = 1.4 + rng() * 2.2;
      ai.strafeDir = ai.strafeDir === 1 ? -1 : 1;
    }

    if (ai.mode === "retreat") {
      const move = moveInput(view.home.x - view.feet.x, view.home.z - view.feet.z, intent.aimYaw);
      intent.moveX = move.moveX;
      intent.moveZ = move.moveZ;
    } else {
      // Pilots waiting for an attack slot circle at the outer edge of the fighting band.
      const near = view.weaponsFree ? cfg.minRange : cfg.maxRange;
      const far = view.weaponsFree ? cfg.maxRange : cfg.maxRange * 1.3;
      const radial = !target.visible || targetDist > far ? 1 : targetDist < near ? -1 : 0;
      intent.moveZ = radial;
      intent.moveX = target.visible ? ai.strafeDir * cfg.strafe : 0;
      intent.sprint = radial === 1 && targetDist > cfg.maxRange * 1.5;
    }
    trackStuck(ai, view, intent.moveX !== 0 || intent.moveZ !== 0, dt);

    // Fire in bursts, easing off as heat builds.
    ai.burstTimer -= dt;
    if (ai.burstTimer <= 0) {
      ai.firing = !ai.firing;
      ai.burstTimer = ai.firing ? 0.9 + rng() * 0.9 : 0.6 + rng() * 0.8;
    }
    if (target.visible && view.weaponsFree) {
      const inReach = targetDist < cfg.fireRange;
      intent.firePrimary = inReach && ai.firing && view.heatFrac < 0.85;
      intent.fireSecondary = inReach && targetDist > 25 && view.heatFrac < 0.6;
      intent.fireTertiary = intent.fireSecondary;
      intent.melee = targetDist < 6;
    }
    // Occasional evasive dash.
    if (target.visible) intent.boost = view.energyFrac > 0.5 && rng() < dt * cfg.dashRate;
  }

  intent.jump = ai.jumpTimer > 0;
  return intent;
}

function trackStuck(ai: AiState, view: AiView, wantsToMove: boolean, dt: number): void {
  if (wantsToMove && (view.speed < 1.2 || view.blockedAhead)) {
    ai.stuckTimer += dt;
    if (ai.stuckTimer > 0.7) {
      ai.stuckTimer = 0;
      ai.jumpTimer = 0.9;
      ai.strafeDir = ai.strafeDir === 1 ? -1 : 1;
    }
  } else {
    ai.stuckTimer = Math.max(0, ai.stuckTimer - dt);
  }
}
