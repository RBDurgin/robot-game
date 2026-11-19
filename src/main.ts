import { Engine, EngineInstrumentation } from "./babylon";
import { FixedStepClock, SIM_DT } from "./sim/clock";
import { FrameStats } from "./game/frameStats";
import { PROFILING, perfEnd, perfFrame, perfFrameCount, perfStart, perfTake } from "./game/perf";
import { World } from "./game/world";
import { modelsEnabled } from "./view/parts/GltfPartVisual";
import { buildTweakPanel } from "./view/tweakPanel";
import { missingFeatures, showFatal } from "./view/fatal";
import { downloadText, slotAsSaveFile } from "./view/download";
import { openSaveStore, type SaveStore } from "./game/saveStore";

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

/** The world's save store once there is one, so a crash can offer the save in use. */
let liveStore: SaveStore | null = null;

async function boot(): Promise<void> {
  const missing = missingFeatures();
  if (missing.length > 0) {
    showFatal("This browser cannot run the game", [
      `The game needs ${missing.join(" and ")}, and this browser does not offer ${missing.length > 1 ? "them" : "it"}.`,
      "Use a recent Chrome, Edge, Firefox or Safari on a desktop or laptop computer. If you already are, check that hardware (graphics) acceleration is turned on in the browser's settings, then reload.",
    ], [{ label: "Reload", primary: true, run: () => location.reload() }]);
    return;
  }
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const debugEl = document.getElementById("debug") as HTMLDivElement;

  const engine = new Engine(canvas, true, {
    stencil: true,
    // Laptops with two GPUs give a web page the integrated one unless it asks for the fast one.
    powerPreference: "high-performance",
  });
  const overlay = document.getElementById("overlay") as HTMLDivElement;
  const world = await World.create(engine, canvas, overlay);
  liveStore = world.store;
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
    try {
      frame();
    } catch (err) {
      engine.stopRenderLoop();
      crashed(err);
    }
  });
  const frame = (): void => {
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
  };

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

/** The game failed while starting or playing: say so, and offer a way out that keeps the save. */
function crashed(err: unknown): void {
  console.error(err);
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  const store = (): Promise<SaveStore> => (liveStore ? Promise.resolve(liveStore) : openSaveStore());
  showFatal(
    "Something went wrong",
    [
      "The game hit an error it could not recover from. Your progress up to the last save is kept.",
      "Reload to carry on. If this happens again as soon as the game starts, the save in use may be the cause: download a copy of it, then start this slot over. The copy can be imported again later from the pause menu.",
    ],
    [
      { label: "Reload", primary: true, run: () => void store().then((s) => s.close()).then(() => location.reload()) },
      {
        label: "Download this save",
        run: async () => {
          const s = await store();
          const raw = await s.rawSlot();
          if (raw) downloadText(`robot-game-slot-${s.slot}.json`, slotAsSaveFile(raw));
        },
      },
      {
        label: "Start this slot over",
        run: async () => {
          if (!window.confirm("Start this slot over? Download the save first if you want to keep it.")) return;
          const s = await store();
          await s.startOver();
          location.reload();
        },
      },
    ],
    detail,
  );
}

boot().catch(crashed);
