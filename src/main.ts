import { Engine, EngineInstrumentation } from "@babylonjs/core";
import { FixedStepClock, SIM_DT } from "./sim/clock";
import { FrameStats } from "./game/frameStats";
import { PROFILING, perfEnd, perfFrame, perfFrameCount, perfStart, perfTake } from "./game/perf";
import { World } from "./game/world";
import { modelsEnabled } from "./view/parts/GltfPartVisual";
import { buildTweakPanel } from "./view/tweakPanel";

/** Debug handle used by the e2e tests and for poking at the game from the browser console. */
export interface GameDebug {
  ready: boolean;
  tick: number;
  world: World;
}

declare global {
  interface Window {
    __game?: GameDebug;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const debugEl = document.getElementById("debug") as HTMLDivElement;

  const engine = new Engine(canvas, true, {
    stencil: true,
    // Laptops with two GPUs give a web page the integrated one unless it asks for the fast one.
    powerPreference: "high-performance",
  });
  const overlay = document.getElementById("overlay") as HTMLDivElement;
  const world = await World.create(engine, canvas, overlay);
  const clock = new FixedStepClock();

  const stats = new FrameStats();

  // With ?profile in the URL the game records its own frame timings; see src/game/perf.ts.
  const gpuTimer = PROFILING ? new EngineInstrumentation(engine) : null;
  if (gpuTimer) gpuTimer.captureGPUFrameTime = true;
  let perfStatus = "";
  let drawsSoFar = 0;
  const savePerf = (): void => {
    const gl = engine.getGlInfo();
    const body = JSON.stringify({
      meta: {
        savedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        gpu: gl.renderer,
        width: engine.getRenderWidth(),
        height: engine.getRenderHeight(),
        devicePixelRatio: window.devicePixelRatio,
        gpuTimer: engine.getCaps().timerQuery !== undefined,
        // What was being drawn: the graphics preset, and imported models or procedural parts.
        quality: world.save.settings.quality,
        models: modelsEnabled,
      },
      frames: perfTake(),
    });
    fetch("/__perf", { method: "POST", body })
      .then((r) => r.text())
      .then((name) => {
        perfStatus = `saved ${name}`;
        world.notify(`Profile saved: ${name}`, 5);
      })
      .catch((err) => {
        perfStatus = `save failed: ${String(err)}`;
      });
  };

  let debugAge = 1;
  const debug: GameDebug = { ready: true, tick: 0, world };
  window.__game = debug;

  engine.runRenderLoop(() => {
    const frameDt = engine.getDeltaTime() / 1000;
    stats.add(frameDt);
    const frameStart = perfStart();
    const steps = clock.advance(frameDt);
    for (let i = 0; i < steps; i++) {
      const stepStart = perfStart();
      world.step(SIM_DT);
      perfEnd("step", stepStart);
    }
    debug.tick = world.tick;
    world.render(clock.alpha, frameDt);

    // Only while the overlay is showing, and a few times a second: every write leaves the
    // browser a discarded text node to collect, which adds up to longer garbage-collection pauses.
    debugAge += frameDt;
    if (!debugEl.hidden && debugAge >= 0.2) {
      debugAge = 0;
      const p = world.player.feet;
      const s = world.player.state;
      const stream = world.terrain.stats;
      debugEl.textContent =
        `fps   ${stats.summary()}\n` +
        `pos   ${p.x.toFixed(0)} ${p.y.toFixed(1)} ${p.z.toFixed(0)}\n` +
        `speed ${world.player.horizontalSpeed.toFixed(1)} m/s ${s.grounded ? "ground" : "air"}\n` +
        `view  ${world.cameraRig.mode}\n` +
        `world ${world.region.name} · ${stream.chunks} chunks (${stream.colliders} solid, ${stream.queued} queued) · ${world.enemies.length}/${world.population.filter((r) => r.alive).length} mechs awake` +
        (PROFILING ? `\nperf  ${perfFrameCount()} frames recorded${perfStatus ? ` · ${perfStatus}` : ""}` : "");
    }
    if (PROFILING) {
      // Menu frames get their own name, and are not recorded, so they do not dilute the numbers.
      const playing = world.mode === "playing";
      // The engine's draw-call counter only ever grows; record this frame's share.
      const draws = engine._drawCalls.current - drawsSoFar;
      drawsSoFar = engine._drawCalls.current;
      perfEnd(playing ? "frame" : "frame.menu", frameStart);
      perfFrame(
        playing
          ? {
              t: frameStart,
              // GPU time for a recent frame in ms (the query result arrives a few frames late).
              gpu: (gpuTimer?.gpuFrameTimeCounter.current ?? 0) / 1e6,
              draws,
              meshes: world.scene.getActiveMeshes().length,
              shaders: Object.keys((engine as unknown as { _compiledEffects: object })._compiledEffects).length,
              enemies: world.enemies.length,
              fighting: world.enemies.filter((m) => m.brain?.state.mode !== "patrol").length,
              effects: world.effects.activeCount,
              particles: world.effects.particles.activeCount,
              // Streaming: what is loaded, what is waiting, and how many jobs ran this frame.
              chunks: world.terrain.stats.chunks,
              queued: world.terrain.stats.queued,
              streamJobs: world.terrain.lastJobs,
            }
          : null,
      );
      // Opening any menu (Esc) saves what has been recorded since the last one.
      if (!playing && perfFrameCount() >= 120) savePerf();
    }
  });

  window.addEventListener("resize", () => engine.resize());

  // Backquote (`) toggles the developer overlay: stats and live handling sliders.
  const tweaksEl = document.getElementById("tweaks") as HTMLDivElement;
  buildTweakPanel(tweaksEl, world.player.frame);
  world.onPlayerFrameChanged = () => {
    tweaksEl.replaceChildren();
    buildTweakPanel(tweaksEl, world.player.frame);
  };
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Backquote") return;
    debugEl.hidden = !debugEl.hidden;
    tweaksEl.hidden = debugEl.hidden;
    // Free the mouse for the sliders without pausing, so values can be felt while playing.
    // Click the view to capture the mouse again.
    if (!tweaksEl.hidden) world.input.releasePointer(true);
  });
}

boot().catch((err) => {
  console.error(err);
  const debugEl = document.getElementById("debug");
  if (debugEl) debugEl.textContent = `Failed to start: ${String(err)}`;
});
