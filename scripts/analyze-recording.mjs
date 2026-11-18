// Summarise a recording made by the game itself (open it with ?profile, play, press Esc).
// Called by analyze-trace.mjs when the file is a recording rather than a Chrome trace.
const SPANS = ["frame", "step", "step.world", "step.player", "step.ai", "step.projectiles", "step.physics", "stream", "visuals", "hud", "scene.render"];
const COUNTERS = ["gpu", "draws", "meshes", "effects", "particles", "chunks", "queued", "streamJobs"];
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "-").padStart(8);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
const mean = (list, get) => (list.length ? list.reduce((sum, f) => sum + (get(f) ?? 0), 0) / list.length : NaN);

export function report(data, file) {
  const frames = data.frames;
  console.log(`Recording: ${file}`);
  console.log(`  ${JSON.stringify(data.meta)}`);
  if (frames.length < 10) return console.log(`Only ${frames.length} frames recorded.`);

  // Interval to the next frame. A long gap is a menu, not a slow frame.
  for (let i = 0; i < frames.length; i++) {
    const gap = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : NaN;
    frames[i].interval = gap < 250 ? gap : NaN;
  }
  const timed = frames.filter((f) => Number.isFinite(f.interval));
  const intervals = timed.map((f) => f.interval).sort((a, b) => a - b);
  const median = pct(intervals, 50);
  const slowLimit = median * 1.5;
  const total = intervals.reduce((a, b) => a + b, 0) / 1000;
  const slow = timed.filter((f) => f.interval > slowLimit);
  const fight = timed.filter((f) => f.fighting > 0);
  const calm = timed.filter((f) => !(f.fighting > 0));
  const kills = frames.reduce((n, f) => n + (f.events?.filter((e) => e === "kill").length ?? 0), 0);

  console.log(`${timed.length} frames over ${total.toFixed(1)} s of play = ${(timed.length / total).toFixed(1)} fps average, ${kills} kills`);
  console.log(`Frame interval ms: median ${median.toFixed(1)}, p95 ${pct(intervals, 95).toFixed(1)}, p99 ${pct(intervals, 99).toFixed(1)}, worst ${intervals[intervals.length - 1].toFixed(1)}`);
  console.log(`Slow frames (interval > ${slowLimit.toFixed(1)} ms): ${slow.length} (${((100 * slow.length) / timed.length).toFixed(1)}%)`);
  const rate = (list) => (list.length ? `${((100 * list.filter((f) => f.interval > slowLimit).length) / list.length).toFixed(1)}% slow, ${(1000 / mean(list, (f) => f.interval)).toFixed(1)} fps` : "no frames");
  console.log(`  out of a fight: ${calm.length} frames, ${rate(calm)}`);
  console.log(`  in a fight:     ${fight.length} frames, ${rate(fight)}`);

  console.log(`\nPer frame (ms for spans and gpu, counts for the rest)`);
  console.log(`${"".padEnd(18)}${"calm".padStart(8)}${"fight".padStart(8)}${"slow".padStart(8)}${"max".padStart(8)}`);
  for (const name of [...SPANS, ...COUNTERS]) {
    const get = (f) => f[name];
    const max = timed.reduce((m, f) => Math.max(m, f[name] ?? 0), 0);
    const d = COUNTERS.includes(name) && name !== "gpu" ? 0 : 2;
    console.log(`${(name.startsWith("step.") ? "  " + name : name).padEnd(18)}${fmt(mean(calm, get), d)}${fmt(mean(fight, get), d)}${fmt(mean(slow, get), d)}${fmt(max, d)}`);
  }
  console.log(`("frame" is all game JavaScript; "gpu" is time on the GPU itself, 0 if the browser does not report it)`);

  const hist = {};
  for (const f of timed) hist[f.steps] = (hist[f.steps] ?? 0) + 1;
  console.log(`\nSimulation steps per frame: ${Object.entries(hist).map(([k, v]) => `${k}: ${((100 * v) / timed.length).toFixed(1)}%`).join(", ")}`);
  if (slow.length) {
    const jsHeavy = slow.filter((f) => f.frame > median * 0.75).length;
    const gpuHeavy = slow.filter((f) => f.frame <= median * 0.75 && f.gpu > median * 0.75).length;
    console.log(`Of ${slow.length} slow frames: ${jsHeavy} had heavy game JavaScript (> ${(median * 0.75).toFixed(1)} ms), ${gpuHeavy} had light JavaScript but heavy GPU time, ${slow.length - jsHeavy - gpuHeavy} had neither (cost is outside what the page can measure).`);
  }

  // Shader compiles and kills, and whether a slow frame came with them.
  console.log(`\nEvents`);
  const t0 = frames[0].t;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    const notes = [];
    if (f.shaders > frames[i - 1].shaders) notes.push(`${f.shaders - frames[i - 1].shaders} new shader(s)`);
    for (const e of f.events ?? []) notes.push(e);
    if (!notes.length) continue;
    const near = frames.slice(Math.max(0, i - 1), i + 4).reduce((m, g) => Math.max(m, g.interval || 0), 0);
    console.log(`  ${((f.t - t0) / 1000).toFixed(1).padStart(6)}s  ${notes.join(", ").padEnd(28)} worst interval nearby ${near.toFixed(1)} ms`);
  }

  console.log(`\nTimeline (per second of play): fps, JS ms, GPU ms, worst interval, slow frames, mechs fighting, draw calls`);
  const buckets = [];
  let clock = 0;
  for (const f of timed) {
    const b = (buckets[Math.floor(clock / 1000)] ??= { n: 0, js: 0, gpu: 0, worst: 0, slow: 0, fighting: 0, draws: 0, kills: 0 });
    b.n++;
    b.js += f.frame;
    b.gpu += f.gpu;
    b.worst = Math.max(b.worst, f.interval);
    b.fighting = Math.max(b.fighting, f.fighting);
    b.draws += f.draws;
    if (f.interval > slowLimit) b.slow++;
    b.kills += f.events?.filter((e) => e === "kill").length ?? 0;
    clock += f.interval;
  }
  buckets.forEach((b, i) => {
    console.log(`${String(i).padStart(4)}s ${String(b.n).padStart(3)} fps  js ${fmt(b.js / b.n)}  gpu ${fmt(b.gpu / b.n)}  worst ${fmt(b.worst, 1)}  slow ${String(b.slow).padStart(2)}  fighting ${b.fighting}  draws ${(b.draws / b.n).toFixed(0)}${b.kills ? `  kill x${b.kills}` : ""}`);
  });

  console.log(`\nThe 15 slowest frames`);
  for (const f of [...timed].sort((a, b) => b.interval - a.interval).slice(0, 15)) {
    console.log(`  ${((f.t - t0) / 1000).toFixed(1).padStart(6)}s interval ${f.interval.toFixed(1)}  js ${f.frame.toFixed(1)} (step ${(f.step ?? 0).toFixed(1)} x${f.steps}, render ${(f["scene.render"] ?? 0).toFixed(1)})  gpu ${f.gpu.toFixed(1)}  fighting ${f.fighting} effects ${f.effects} particles ${f.particles ?? "-"} stream ${(f.stream ?? 0).toFixed(1)} x${f.streamJobs ?? 0}${f.events ? "  " + f.events.join(",") : ""}`);
  }
}
