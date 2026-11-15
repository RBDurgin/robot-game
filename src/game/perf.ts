/**
 * Frame profiling, off unless the page URL has `?profile`, so normal play pays nothing.
 *
 * - `?profile`: the game records its own per-frame timings and counters and the dev server
 *   saves them to `perf/` each time a menu opens (see `vite.config.ts`). No DevTools needed.
 * - `?profile=devtools`: also emits the spans to Chrome's Performance panel ("Timings" track).
 *
 * `npm run trace -- perf/<file>` summarises either kind of file.
 */
const param = typeof location !== "undefined" ? new URLSearchParams(location.search).get("profile") : null;
export const PROFILING = param !== null;
const DEVTOOLS = param === "devtools";

/** Frames kept before the oldest are dropped (about 15 minutes at 60 fps). */
const MAX_FRAMES = 54_000;

/** One recorded frame: span name -> milliseconds, plus whatever counters the caller adds. */
export type PerfFrame = Record<string, number | string[]>;

let spans: Record<string, number> = {};
let events: string[] = [];
let steps = 0;
let frames: PerfFrame[] = [];

/** Start of a span. Pass the result to `perfEnd`. */
export function perfStart(): number {
  return PROFILING ? performance.now() : 0;
}

/** End a span. Spans with the same name in one frame add up. */
export function perfEnd(name: string, start: number): void {
  if (!PROFILING) return;
  const end = performance.now();
  spans[name] = (spans[name] ?? 0) + (end - start);
  if (name === "step") steps++;
  if (DEVTOOLS) performance.measure(name, { start, end });
}

/** A point event (a kill, a respawn), to line hitches up with what happened in the game. */
export function perfMark(name: string): void {
  if (!PROFILING) return;
  events.push(name);
  if (DEVTOOLS) performance.mark(name);
}

/** Close the current frame. `counters` is stored with it; pass null to discard a menu frame. */
export function perfFrame(counters: Record<string, number> | null): void {
  if (!PROFILING) return;
  if (counters) {
    const frame: PerfFrame = { ...counters, ...spans, steps };
    if (events.length) frame.events = events;
    frames.push(frame);
    if (frames.length > MAX_FRAMES) frames.shift();
  }
  spans = {};
  events = [];
  steps = 0;
  if (DEVTOOLS) {
    // The browser keeps every span until told to drop them.
    performance.clearMeasures();
    performance.clearMarks();
  }
}

export function perfFrameCount(): number {
  return frames.length;
}

/** Hand over everything recorded so far and start afresh. */
export function perfTake(): PerfFrame[] {
  const taken = frames;
  frames = [];
  return taken;
}
