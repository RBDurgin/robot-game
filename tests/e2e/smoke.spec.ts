import { expect, test } from "@playwright/test";
import { boot, playerState, SHOTS, startGame, waitTicks } from "./helpers";

test("mech settles on the ground, walks, jumps and switches view", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);

  await waitTicks(page, 60);
  const start = await playerState(page);
  expect(start.grounded).toBe(true);
  await page.screenshot({ path: `${SHOTS}/01-spawn-third-person.png` });

  // Walk forward for two seconds of game time: about 18 m at walk speed.
  await page.evaluate(() => (window.__game!.world.intentOverride = { moveZ: 1 }));
  await waitTicks(page, 120);
  const walked = await playerState(page);
  const dist = Math.hypot(walked.x - start.x, walked.z - start.z);
  expect(dist).toBeGreaterThan(12);
  expect(dist).toBeLessThan(22);
  await page.screenshot({ path: `${SHOTS}/02-walking.png` });

  // Hold jump: leaves the ground, climbs on jets, spends energy.
  await page.evaluate(() => (window.__game!.world.intentOverride = { jump: true }));
  await waitTicks(page, 45);
  const air = await playerState(page);
  expect(air.grounded).toBe(false);
  expect(air.y).toBeGreaterThan(walked.y + 3);
  expect(air.energy).toBeLessThan(90);
  await page.screenshot({ path: `${SHOTS}/03-jump-jets.png` });

  // Release: falls back to the ground and energy recharges.
  await page.evaluate(() => (window.__game!.world.intentOverride = null));
  await waitTicks(page, 200);
  const landed = await playerState(page);
  expect(landed.grounded).toBe(true);
  expect(landed.energy).toBeGreaterThan(air.energy);

  // Cockpit view.
  const mode = await page.evaluate(() => window.__game!.world.cameraRig.toggle());
  expect(mode).toBe("cockpit");
  await waitTicks(page, 5);
  await page.screenshot({ path: `${SHOTS}/04-cockpit.png` });

  expect(errors).toEqual([]);
});
