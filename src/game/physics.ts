import {
  HavokPlugin,
  PhysicsAggregate,
  PhysicsRaycastResult,
  PhysicsShapeType,
  Scene,
  Vector3,
  type Mesh,
  type PhysicsShape,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { SIM_DT } from "../sim/clock";
import { GRAVITY_ACCEL } from "../sim/mech";

export const GRAVITY = new Vector3(0, -GRAVITY_ACCEL, 0);

/**
 * Collision layers. Mech character controllers own a physics body, so without layers a
 * "world" ray would stop on a mech's capsule instead of reaching its per-section hit volumes.
 */
export const LAYER_WORLD = 1;
export const LAYER_MECH = 2;

/** Give a mesh a static collider on the world layer (terrain, buildings, rocks). */
export function addStaticCollider(scene: Scene, mesh: Mesh, type: PhysicsShapeType, friction = 0.8): void {
  const aggregate = new PhysicsAggregate(mesh, type, { mass: 0, friction }, scene);
  aggregate.shape.filterMembershipMask = LAYER_WORLD;
  aggregate.shape.filterCollideMask = LAYER_WORLD | LAYER_MECH;
}

/** Put a mech's collision shape on the mech layer: it collides with the world and other mechs. */
export function markMechShape(shape: PhysicsShape): void {
  shape.filterMembershipMask = LAYER_MECH;
  shape.filterCollideMask = LAYER_WORLD | LAYER_MECH;
}

const plugins = new WeakMap<Scene, HavokPlugin>();

/**
 * Loads the Havok WASM module and enables physics on the scene.
 * Physics is stepped manually from the fixed-step game loop, not by Babylon's render loop.
 */
export async function enablePhysics(scene: Scene): Promise<HavokPlugin> {
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  const plugin = new HavokPlugin(false, havok);
  scene.enablePhysics(GRAVITY, plugin);
  plugin.setTimeStep(SIM_DT);
  scene.physicsEnabled = false; // we call stepPhysics() ourselves
  plugins.set(scene, plugin);
  return plugin;
}

/** Advance physics by exactly one fixed simulation step. */
export function stepPhysics(scene: Scene): void {
  scene.getPhysicsEngine()?._step(SIM_DT);
}

export interface WorldHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
}

const rayResult = new PhysicsRaycastResult();

/** Ray test against static world geometry (terrain, structures, rocks). Mechs are not included. */
export function raycastWorld(scene: Scene, from: Vector3, to: Vector3): WorldHit | null {
  const plugin = plugins.get(scene);
  if (!plugin) return null;
  rayResult.reset(from, to);
  plugin.raycast(from, to, rayResult, { membership: LAYER_WORLD, collideWith: LAYER_WORLD });
  if (!rayResult.hasHit) return null;
  return {
    point: rayResult.hitPointWorld.clone(),
    normal: rayResult.hitNormalWorld.clone(),
    distance: Vector3.Distance(from, rayResult.hitPointWorld),
  };
}
