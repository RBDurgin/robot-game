/**
 * How the world streams in around the player. Distances are in chunks, measured from the player
 * to a chunk's centre along the longer axis, so a chunk the player stands in is at most 0.5 away.
 * Each pair is [load when nearer than, unload when farther than]; the gap stops a player who
 * paces across a border from loading and unloading the same chunks over and over.
 */
export const STREAM = {
  /** Terrain mesh. (view[0] - 0.5) chunks must stay beyond every biome's fog end. */
  view: [4.6, 5.0],
  /** Structures and scatter objects, with their colliders. */
  detail: [3.6, 4.0],
  /** Terrain collider. (collider[0] - 0.5) chunks must stay beyond `mechSleep`. */
  collider: [2.75, 3.1],
  /** Terrain mesh detail steps: cells per side are divided by 1, 2 or 4. */
  lodDivisors: [1, 2, 4],
  /** A chunk uses detail step i while nearer than lodDistance[i]; the last step beyond that. */
  lodDistance: [1.6, 2.7],
  /** A chunk keeps its detail step until it is this far past a threshold. */
  lodMargin: 0.15,
  /** Milliseconds of streaming work allowed per rendered frame (one job always runs). */
  frameBudgetMs: 3,
  /** Sleeping mechs wake when the player is nearer than this many metres. */
  mechWake: 450,
  /** Active mechs go back to sleep when the player is farther than this many metres. */
  mechSleep: 540,
  /** Mechs woken per simulation step at most, so a garrison does not all build in one step. */
  wakesPerStep: 1,
  /** A site is discovered when the player comes within this many metres of its edge. */
  discoverMargin: 60,
};

export type StreamConfig = typeof STREAM;
