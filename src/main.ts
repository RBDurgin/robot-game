import { Engine } from "@babylonjs/core";
import { FixedStepClock, SIM_DT } from "./sim/clock";
import { FrameStats } from "./game/frameStats";
import { World } from "./game/world";
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

  const debug: GameDebug = { ready: true, tick: 0, world };
  window.__game = debug;

  engine.runRenderLoop(() => {
    const frameDt = engine.getDeltaTime() / 1000;
    stats.add(frameDt);
    const steps = clock.advance(frameDt);
    for (let i = 0; i < steps; i++) world.step(SIM_DT);
    debug.tick = world.tick;
    world.render(clock.alpha, frameDt);

    const p = world.player.feet;
    const s = world.player.state;
    debugEl.textContent =
      `fps   ${stats.summary()}\n` +
      `pos   ${p.x.toFixed(0)} ${p.y.toFixed(1)} ${p.z.toFixed(0)}\n` +
      `speed ${world.player.horizontalSpeed.toFixed(1)} m/s ${s.grounded ? "ground" : "air"}\n` +
      `view  ${world.cameraRig.mode}`;
  });

  window.addEventListener("resize", () => engine.resize());

  // Backquote (`) toggles the developer overlay: stats and live handling sliders.
  const tweaksEl = document.getElementById("tweaks") as HTMLDivElement;
  buildTweakPanel(tweaksEl, world.player.frame);
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
