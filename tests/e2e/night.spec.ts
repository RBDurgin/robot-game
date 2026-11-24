import { expect, test, type Page } from "@playwright/test";
import { approachOutpost, boot, SHOTS, startGame, waitTicks } from "./helpers";

const night = (page: Page, time = "night") =>
  page.evaluate((t) => {
    const w = window.__game!.world;
    w.warPaused = true;
    w.setTime(t);
    w.skyPaused = true;
  }, time);

const headlight = (page: Page) => page.evaluate(() => window.__game!.world.scene.getLightByName("headlight")!.intensity);

/** Whether each awake AI mech's lamps are showing. */
const aiLamps = (page: Page) =>
  page.evaluate(() => {
    const w = window.__game!.world;
    return w.mechs
      .filter((m) => m !== w.player)
      .map((m) => m.lights && m.visual.root.getChildMeshes(false).some((mesh) => mesh.name === "lampGlow" && mesh.isEnabled()));
  });

test("night: the player's headlights switch on and off with their key", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);
  await night(page);
  await page.evaluate(() => (window.__game!.world.intentOverride = { aimYaw: 2.4, aimPitch: -0.05 }));
  await waitTicks(page, 20);
  expect(await headlight(page)).toBe(0);
  const hint = await page.evaluate(() => (window.__game!.world as unknown as { infoText(): string }).infoText());
  expect(hint).toContain("headlights");
  await page.screenshot({ path: `${SHOTS}/50-night-dark.png` });

  const materials = await page.evaluate(() => window.__game!.world.scene.materials.length);
  await page.keyboard.press("KeyT");
  await waitTicks(page, 20);
  expect(await page.evaluate(() => window.__game!.world.headlightsOn)).toBe(true);
  expect(await headlight(page)).toBeGreaterThan(1);
  // Switching on adds no materials (the light was there all along).
  expect(await page.evaluate(() => window.__game!.world.scene.materials.length)).toBe(materials);
  await page.screenshot({ path: `${SHOTS}/51-night-headlights.png` });

  await page.evaluate(() => (window.__game!.world.cameraRig.showcase = { yaw: 0.5, distance: 10, height: 1.2 }));
  await waitTicks(page, 10);
  await page.screenshot({ path: `${SHOTS}/52-night-lamps.png` });
  await page.evaluate(() => (window.__game!.world.cameraRig.showcase = null));

  await page.keyboard.press("KeyV");
  await waitTicks(page, 15);
  await page.screenshot({ path: `${SHOTS}/53-night-cockpit.png` });
  await page.keyboard.press("KeyV");

  await page.keyboard.press("KeyT");
  await waitTicks(page, 5);
  expect(await headlight(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("night: AI pilots run with their lamps on after dark, and off by day", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await approachOutpost(page);
  await waitTicks(page, 10);
  expect((await aiLamps(page)).some(Boolean)).toBe(false);

  await night(page, "dusk");
  await waitTicks(page, 10);
  const lit = await aiLamps(page);
  expect(lit.length).toBeGreaterThan(0);
  expect(lit.every(Boolean)).toBe(true);

  // From the cockpit, within sight of the nearest of them.
  await night(page);
  await page.evaluate(() => {
    const w = window.__game!.world;
    const p = w.player.feet;
    const near = w.enemies.reduce((a, b) => (Math.hypot(a.feet.x - p.x, a.feet.z - p.z) < Math.hypot(b.feet.x - p.x, b.feet.z - p.z) ? a : b));
    const dx = p.x - near.feet.x;
    const dz = p.z - near.feet.z;
    const k = 70 / Math.hypot(dx, dz);
    const x = near.feet.x + dx * k;
    const z = near.feet.z + dz * k;
    const yaw = Math.atan2(-dx, -dz);
    w.player.teleport({ x, y: w.heightAt(x, z) + 1, z }, yaw);
    w.cameraRig.mode = "cockpit";
    w.intentOverride = { aimYaw: yaw, aimPitch: -0.03 };
  });
  await waitTicks(page, 20);
  await page.screenshot({ path: `${SHOTS}/54-night-enemy-lamps.png` });
  expect(errors).toEqual([]);
});
