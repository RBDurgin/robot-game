// Summarise a profile of the game: either a recording the game saved itself (`?profile` in the
// URL, see src/game/perf.ts) or a Chrome Performance trace recorded with `?profile=devtools`.
//
//   node scripts/analyze-trace.mjs perf/<file>
//
// For a Chrome trace:
// It reads the named spans from src/game/perf.ts ("frame", "step", "hud", "scene.render", ...),
// the sampled CPU profile, garbage collections and GPU-process activity, and reports where the
// time goes in ordinary frames and in the slow ones.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/analyze-trace.mjs <trace.json|trace.json.gz>");
  process.exit(1);
}

let raw = readFileSync(file);
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);
const parsed = JSON.parse(raw.toString("utf8"));
if (!Array.isArray(parsed) && parsed.frames) {
  // Not a Chrome trace: a recording made by the game itself (?profile).
  (await import("./analyze-recording.mjs")).report(parsed, file);
  process.exit(0);
}
const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;

const ms = (us) => us / 1000;
const fmt = (n, d = 2) => n.toFixed(d).padStart(7);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];

// --- Named spans (performance.measure) ---

const SPAN_NAMES = new Set([
  "frame", "step", "step.player", "step.ai", "step.projectiles", "step.physics", "visuals", "hud", "scene.render",
]);
const open = new Map();
const spans = []; // { name, start, end } in microseconds
const marks = [];
let mainPid = null;
let mainTid = null;
for (const e of events) {
  if (!e.cat || !e.cat.includes("blink.user_timing")) continue;
  if (e.name === "kill") marks.push(e.ts);
  if (!SPAN_NAMES.has(e.name)) continue;
  const key = `${e.name}|${e.id ?? e.id2?.local ?? e.id2?.global ?? ""}`;
  if (e.ph === "b") open.set(key, e.ts);
  else if (e.ph === "e" && open.has(key)) {
    spans.push({ name: e.name, start: open.get(key), end: e.ts });
    open.delete(key);
    if (e.name === "frame") {
      mainPid = e.pid;
      mainTid = e.tid;
    }
  }
}

const frames = spans.filter((s) => s.name === "frame").sort((a, b) => a.start - b.start);
if (frames.length < 10) {
  console.error(`Only ${frames.length} "frame" spans in this trace. Was the page opened with ?profile=devtools in the URL?`);
  process.exit(1);
}

// Attach the other spans to the frame that contains them.
const others = spans.filter((s) => s.name !== "frame").sort((a, b) => a.start - b.start);
let oi = 0;
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  f.parts = {};
  f.steps = 0;
  f.js = ms(f.end - f.start);
  f.interval = i + 1 < frames.length ? ms(frames[i + 1].start - f.start) : NaN;
  while (oi < others.length && others[oi].start < f.start) oi++;
  let j = oi;
  for (; j < others.length && others[j].start <= f.end; j++) {
    const s = others[j];
    f.parts[s.name] = (f.parts[s.name] ?? 0) + ms(s.end - s.start);
    if (s.name === "step") f.steps++;
  }
  oi = j;
}
frames.pop(); // the last one has no interval

const intervals = frames.map((f) => f.interval).sort((a, b) => a - b);
const median = pct(intervals, 50);
const slowLimit = median * 1.5;
const slow = frames.filter((f) => f.interval > slowLimit);
const seconds = (frames[frames.length - 1].start - frames[0].start) / 1e6;

console.log(`Trace: ${file}`);
console.log(`${frames.length} frames over ${seconds.toFixed(1)} s = ${(frames.length / seconds).toFixed(1)} fps average`);
console.log(
  `Frame interval ms: median ${median.toFixed(1)}, p95 ${pct(intervals, 95).toFixed(1)}, p99 ${pct(intervals, 99).toFixed(1)}, worst ${intervals[intervals.length - 1].toFixed(1)}`,
);
console.log(`Slow frames (interval > ${slowLimit.toFixed(1)} ms): ${slow.length} (${((100 * slow.length) / frames.length).toFixed(1)}%), ${marks.length} kills in the recording`);

// --- Where JavaScript time goes per frame ---

const ROWS = ["frame", "step", "step.player", "step.ai", "step.projectiles", "step.physics", "visuals", "hud", "scene.render"];
const mean = (list, get) => (list.length ? list.reduce((sum, f) => sum + get(f), 0) / list.length : 0);
const value = (name) => (f) => (name === "frame" ? f.js : (f.parts[name] ?? 0));
const worst10 = [...frames].sort((a, b) => b.js - a.js).slice(0, Math.max(1, Math.ceil(frames.length / 100)));

console.log(`\nMain-thread JavaScript per frame, ms (a 60 Hz frame has 16.7 ms for everything)`);
console.log(`${"span".padEnd(18)}${"all".padStart(7)}${"slow".padStart(8)}${"top 1%".padStart(8)}${"max".padStart(8)}`);
for (const name of ROWS) {
  const get = value(name);
  const max = frames.reduce((m, f) => Math.max(m, get(f)), 0);
  console.log(`${(name.startsWith("step.") ? "  " + name : name).padEnd(18)}${fmt(mean(frames, get))} ${fmt(mean(slow, get))} ${fmt(mean(worst10, get))} ${fmt(max)}`);
}
console.log(`("slow" = frames before a long interval; "top 1%" = frames with the most JavaScript time)`);

const stepHist = {};
for (const f of frames) stepHist[f.steps] = (stepHist[f.steps] ?? 0) + 1;
console.log(`\nSimulation steps per frame: ${Object.entries(stepHist).map(([k, v]) => `${k} steps: ${((100 * v) / frames.length).toFixed(1)}%`).join(", ")}`);
if (slow.length) {
  const jsBound = slow.filter((f) => f.js > median * 0.75).length;
  console.log(
    `Of ${slow.length} slow frames, ${jsBound} spent more than ${(median * 0.75).toFixed(1)} ms in game JavaScript; the other ${slow.length - jsBound} were slow outside it (GPU, compositor, GC, other tasks).`,
  );
  console.log(`Mean steps in a slow frame: ${mean(slow, (f) => f.steps).toFixed(2)} (all frames: ${mean(frames, (f) => f.steps).toFixed(2)})`);
}

// --- Per-second timeline ---

console.log(`\nTimeline (per second): fps, mean JS ms, worst interval ms, slow frames, kills`);
const t0 = frames[0].start;
const buckets = [];
for (const f of frames) {
  const b = Math.floor((f.start - t0) / 1e6);
  (buckets[b] ??= { n: 0, js: 0, worst: 0, slow: 0, kills: 0 }).n++;
  buckets[b].js += f.js;
  buckets[b].worst = Math.max(buckets[b].worst, f.interval);
  if (f.interval > slowLimit) buckets[b].slow++;
}
for (const m of marks) {
  const b = buckets[Math.floor((m - t0) / 1e6)];
  if (b) b.kills++;
}
buckets.forEach((b, i) => {
  if (!b) return;
  console.log(`${String(i).padStart(4)}s ${String(b.n).padStart(4)} fps  js ${fmt(b.js / b.n)}  worst ${fmt(b.worst, 1)}  slow ${String(b.slow).padStart(2)}${b.kills ? `  kill x${b.kills}` : ""}`);
});

// --- Garbage collection and other main-thread work ---

const inRanges = (ranges) => {
  // ranges sorted by start, non-overlapping; returns a function ts -> index or -1
  return (ts) => {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ts < ranges[mid][0]) hi = mid - 1;
      else if (ts > ranges[mid][1]) lo = mid + 1;
      else return mid;
    }
    return -1;
  };
};
const slowWindows = slow.map((f) => [f.start, f.start + f.interval * 1000]);
const inSlow = inRanges(slowWindows);

const gc = { MinorGC: { n: 0, total: 0, max: 0, slow: 0 }, MajorGC: { n: 0, total: 0, max: 0, slow: 0 } };
for (const e of events) {
  if (e.pid !== mainPid || e.tid !== mainTid || e.ph !== "X" || !(e.name in gc)) continue;
  const g = gc[e.name];
  g.n++;
  g.total += ms(e.dur ?? 0);
  g.max = Math.max(g.max, ms(e.dur ?? 0));
  if (inSlow(e.ts) >= 0) g.slow++;
}
console.log(`\nGarbage collection on the main thread`);
for (const [name, g] of Object.entries(gc)) {
  console.log(`  ${name}: ${g.n} (${(g.n / seconds).toFixed(1)}/s), total ${g.total.toFixed(1)} ms, longest ${g.max.toFixed(1)} ms, ${g.slow} inside slow frames`);
}

// --- GPU process ---

const gpuPids = new Set(events.filter((e) => e.ph === "M" && e.name === "process_name" && /GPU/i.test(e.args?.name ?? "")).map((e) => e.pid));
const gpuMain = new Set(
  events.filter((e) => e.ph === "M" && e.name === "thread_name" && gpuPids.has(e.pid) && /CrGpuMain/.test(e.args?.name ?? "")).map((e) => `${e.pid}:${e.tid}`),
);
if (gpuMain.size) {
  const tasks = events
    .filter((e) => e.ph === "X" && gpuMain.has(`${e.pid}:${e.tid}`) && e.ts >= frames[0].start && e.ts <= frames[frames.length - 1].end)
    .sort((a, b) => a.ts - b.ts);
  // Count top-level tasks only (nested events would double count).
  let busy = 0;
  let busySlow = 0;
  let until = 0;
  let longest = 0;
  for (const e of tasks) {
    if (e.ts < until) continue;
    until = e.ts + (e.dur ?? 0);
    busy += e.dur ?? 0;
    longest = Math.max(longest, e.dur ?? 0);
    if (inSlow(e.ts) >= 0) busySlow += e.dur ?? 0;
  }
  const slowTotal = slow.reduce((sum, f) => sum + f.interval * 1000, 0);
  console.log(`\nGPU process main thread (CPU time spent issuing draw work, not time on the GPU itself)`);
  console.log(`  busy ${(100 * busy / (seconds * 1e6)).toFixed(0)}% overall${slowTotal ? `, ${(100 * busySlow / slowTotal).toFixed(0)}% during slow frames` : ""}, longest task ${ms(longest).toFixed(1)} ms`);
}

// --- Sampled CPU profile: which functions ---

const profiles = new Map(); // id -> { pid, tid, startTime, nodes: Map, samples: [], deltas: [] }
for (const e of events) {
  if (e.name === "Profile") {
    profiles.set(`${e.pid}:${e.id}`, { pid: e.pid, tid: e.tid, start: e.args.data.startTime, nodes: new Map(), samples: [], deltas: [] });
  }
}
for (const e of events) {
  if (e.name !== "ProfileChunk") continue;
  const p = profiles.get(`${e.pid}:${e.id}`);
  if (!p) continue;
  const d = e.args.data;
  for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
  for (const s of d.cpuProfile?.samples ?? []) p.samples.push(s);
  for (const t of d.timeDeltas ?? []) p.deltas.push(t);
}
const profile = [...profiles.values()].filter((p) => p.pid === mainPid).sort((a, b) => b.samples.length - a.samples.length)[0];

if (profile && profile.samples.length) {
  const label = (n) => {
    const c = n.callFrame;
    const where = c.url ? ` (${c.url.replace(/^.*\/(src|node_modules)\//, "$1/").replace(/\?.*$/, "")}:${(c.lineNumber ?? 0) + 1})` : "";
    return `${c.functionName || "(anonymous)"}${where}`;
  };
  const IGNORE = new Set(["(root)", "(program)", "(idle)"]);
  const frameWindows = frames.map((f) => [f.start, f.end]);
  const inFrame = inRanges(frameWindows);

  const tally = () => ({ self: new Map(), incl: new Map(), total: 0 });
  const all = tally();
  const slowT = tally();
  let ts = profile.start;
  for (let i = 0; i < profile.samples.length; i++) {
    ts += profile.deltas[i] ?? 0;
    const dt = profile.deltas[i + 1] ?? 0; // a sample covers the time until the next one
    const fi = inFrame(ts);
    if (fi < 0) continue;
    const node = profile.nodes.get(profile.samples[i]);
    if (!node) continue;
    const targets = frames[fi].interval > slowLimit ? [all, slowT] : [all];
    const seen = new Set();
    for (let n = node; n; n = profile.nodes.get(n.parent)) {
      const name = label(n);
      if (IGNORE.has(n.callFrame.functionName)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      for (const t of targets) t.incl.set(name, (t.incl.get(name) ?? 0) + dt);
    }
    const self = label(node);
    for (const t of targets) {
      t.total += dt;
      t.self.set(self, (t.self.get(self) ?? 0) + dt);
    }
  }
  const show = (title, map, total, count, n) => {
    console.log(`\n${title}`);
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    for (const [name, us] of rows) console.log(`  ${fmt(ms(us) / count, 3)} ms/frame ${((100 * us) / total).toFixed(1).padStart(5)}%  ${name}`);
  };
  show(`Functions by self time, all frames (sampled; ${ms(all.total / frames.length).toFixed(2)} ms/frame sampled inside "frame")`, all.self, all.total, frames.length, 30);
  show(`Functions by inclusive time, all frames`, all.incl, all.total, frames.length, 45);
  if (slow.length && slowT.total > 0) {
    show(`Functions by self time, slow frames only`, slowT.self, slowT.total, slow.length, 20);
    show(`Functions by inclusive time, slow frames only`, slowT.incl, slowT.total, slow.length, 30);
  }
} else {
  console.log(`\nNo CPU profile samples found for the game's thread in this trace.`);
}
