import { expect, test, type Page } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

const look = (page: Page) =>
  page.evaluate(() => {
    const w = window.__game!.world;
    const sun = w.scene.getLightByName("sun")!;
    const active = (name: string) => w.scene.particleSystems.find((p) => p.name === name)!.getActiveCount();
    return { ...w.weather, fogEnd: w.scene.fogEnd, sun: sun.intensity, rainDrops: active("rain"), dustPuffs: active("dust"), fronts: w.fronts.length };
  });

test("weather: a storm thickens the fog, dims the sun and fills the air", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.warPaused = true;
    w.intentOverride = { aimYaw: 2.4, aimPitch: 0.05 };
  });
  await waitTicks(page, 30);
  const clear = await look(page);
  expect(clear.storm).toBe(0);
  expect(clear.rainDrops).toBe(0);

  await page.evaluate(() => window.__game!.world.setWeather("rain"));
  await waitTicks(page, 360);
  const rain = await look(page);
  expect(rain.rain).toBeGreaterThan(0.8);
  expect(rain.fogEnd).toBeLessThan(clear.fogEnd * 0.6);
  expect(rain.sun).toBeLessThan(clear.sun * 0.6);
  expect(rain.rainDrops).toBeGreaterThan(100);
  await page.screenshot({ path: `${SHOTS}/50-weather-rain.png` });

  await page.evaluate(() => window.__game!.world.setWeather("dust"));
  await waitTicks(page, 360);
  const dust = await look(page);
  expect(dust.dust).toBeGreaterThan(0.8);
  expect(dust.fogEnd).toBeLessThan(clear.fogEnd * 0.6);
  expect(dust.dustPuffs).toBeGreaterThan(50);
  await page.screenshot({ path: `${SHOTS}/51-weather-dust.png` });

  await page.evaluate(() => {
    const w = window.__game!.world;
    w.setWeather("rain");
    w.setTime("night");
    w.headlightsOn = true;
  });
  await waitTicks(page, 240);
  await page.screenshot({ path: `${SHOTS}/52-weather-night-rain.png` });
  expect(errors).toEqual([]);
});

test("weather: fronts cross the map and bring storms of their own", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.warPaused = true;
    // Play time when a front stands over the home base, with the weather left to the fronts.
    w.save.sky.seconds = 3440;
    w.setWeather(null);
  });
  await waitTicks(page, 360);
  const s = await look(page);
  expect(s.fronts).toBeGreaterThan(0);
  expect(s.storm).toBeGreaterThan(0.6);
  // The basin gets rain.
  expect(s.rain).toBeGreaterThan(s.dust);
  // The HUD names it (the HUD is drawn on the canvas, so ask for its text).
  const info = await page.evaluate(() => (window.__game!.world as unknown as { infoText(): string }).infoText());
  expect(info).toContain("Rainstorm");

  await page.evaluate(() => window.__game!.world.openMap());
  await expect(page.getByText("Rainstorm overhead.", { exact: false })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/53-weather-map.png` });
  expect(errors).toEqual([]);
});
