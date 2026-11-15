export interface AttackCandidate<T> {
  pilot: T;
  /** Distance to the pilot's target, metres. */
  distance: number;
  /** True if the pilot was allowed to fire last step. */
  holding: boolean;
}

/**
 * Choose which engaged pilots may fire this step. Limiting the number of simultaneous
 * attackers is what keeps a fight against a group survivable: the rest hold fire and hang
 * back until a slot opens. The closest pilots win, and a pilot that already has a slot keeps
 * it unless another is closer by more than `stickiness` metres, so slots do not flicker.
 */
export function pickAttackers<T>(candidates: AttackCandidate<T>[], max: number, stickiness = 15): Set<T> {
  const ranked = candidates
    .map((c, i) => ({ c, i, score: c.distance - (c.holding ? stickiness : 0) }))
    .sort((a, b) => a.score - b.score || a.i - b.i);
  return new Set(ranked.slice(0, Math.max(0, max)).map((r) => r.c.pilot));
}
