import type { Page } from "@playwright/test";

export const SHOTS = "tests/e2e/screenshots";

/** Load the game and wait until it is running. Returns a live list of console/page errors. */
export async function boot(page: Page, url = "/"): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  return errors;
}

/** Dismiss the start screen so the simulation runs. */
export async function startGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Deploy" }).click();
  await page.waitForFunction(() => window.__game!.world.mode === "playing");
}

/** Wait for a number of simulation ticks (software rendering makes wall-clock time unreliable). */
export async function waitTicks(page: Page, ticks: number): Promise<void> {
  const start = await page.evaluate(() => window.__game!.tick);
  await page.waitForFunction((t) => window.__game!.tick >= t, start + ticks, { timeout: 110_000 });
}

export const playerState = (page: Page) =>
  page.evaluate(() => {
    const p = window.__game!.world.player;
    return {
      x: p.feet.x,
      y: p.feet.y,
      z: p.feet.z,
      energy: p.state.energy,
      heat: p.state.heat,
      grounded: p.state.grounded,
      alive: p.alive,
      torso: p.health.sections.torso.armor + p.health.sections.torso.structure,
    };
  });

/**
 * Put the player down a short way south of the first outpost and wait for its garrison to wake:
 * enemies are only in the scene while the player is near them.
 */
export async function approachOutpost(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window.__game!.world;
    const post = w.missionOutpost;
    const x = post.x - 60;
    const z = post.z - 150;
    w.player.teleport({ x, y: w.heightAt(x, z) + 2, z }, 0);
  });
  await page.waitForFunction(() => window.__game!.world.enemies.length === 5, undefined, { timeout: 60_000 });
}
