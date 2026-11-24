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

/**
 * Dismiss the start screen so the simulation runs. A new pilot's first mission opens with
 * training stages; they are skipped unless `training` is set. The time of day is held at noon
 * unless `sky` is false.
 */
export async function startGame(page: Page, { training = false, sky = true } = {}): Promise<void> {
  await page.getByRole("button", { name: "Deploy", exact: true }).click();
  await page.waitForFunction(() => window.__game!.world.mode === "playing");
  if (!training) await page.evaluate(() => window.__game!.world.skipTraining());
  // A clear noon that stays put, so what the AI sees and what screenshots show does not drift.
  if (sky) await page.evaluate(() => {
    const w = window.__game!.world;
    w.setTime("noon");
    w.skyPaused = true;
  });
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

/**
 * In the hangar, fit a part of the given kind to a slot ("" empties it). Slots list the player's
 * individual items, so this picks one of that kind which no other slot is using.
 */
export async function fitPart(page: Page, slot: string, itemId: string): Promise<void> {
  const select = page.locator("select").and(page.getByLabel(slot));
  if (itemId === "") {
    await select.selectOption("");
    return;
  }
  const value = await select.evaluate((el, id) => {
    const self = el as HTMLSelectElement;
    const taken = new Set([...document.querySelectorAll("select")].filter((s) => s !== self).map((s) => s.value));
    const options = [...self.options].filter((o) => o.dataset.item === id);
    return (options.find((o) => !taken.has(o.value)) ?? options[0])?.value ?? `no ${id} on offer`;
  }, itemId);
  await select.selectOption(value);
}
