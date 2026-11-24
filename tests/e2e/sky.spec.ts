import { expect, test } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

const light = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const w = window.__game!.world;
    const sun = w.scene.getLightByName("sun")!;
    return { t: w.sky.t, phase: w.sky.phase, sun: sun.intensity, fog: w.scene.fogColor.r + w.scene.fogColor.g + w.scene.fogColor.b, clock: w.save.sky.seconds };
  });

test("sky: the day passes, the light follows it, and night is dark", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page, { sky: false });
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.warPaused = true;
    w.intentOverride = { aimYaw: 2.4, aimPitch: 0.12 };
  });

  // The clock runs with play: a new game starts in the morning.
  const morning = await light(page);
  expect(morning.phase).toBe("day");
  await waitTicks(page, 120);
  const later = await light(page);
  expect(later.clock).toBeGreaterThan(morning.clock + 1.5);
  expect(later.t).toBeGreaterThan(morning.t);

  const shots: [string, string][] = [
    ["noon", "46-sky-noon"],
    ["dusk", "47-sky-dusk"],
    ["night", "48-sky-night"],
    ["dawn", "49-sky-dawn"],
  ];
  const seen: Record<string, Awaited<ReturnType<typeof light>>> = {};
  for (const [time, shot] of shots) {
    await page.evaluate((t) => {
      const w = window.__game!.world;
      w.setTime(t);
      w.skyPaused = true;
    }, time);
    await waitTicks(page, 20);
    seen[time] = await light(page);
    await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  }
  expect(seen.night!.phase).toBe("night");
  expect(seen.night!.sun).toBeLessThan(seen.noon!.sun / 3);
  expect(seen.night!.fog).toBeLessThan(seen.noon!.fog / 3);
  expect(seen.dusk!.phase).toBe("dusk");

  // The time of day is saved with the game.
  const saved = await page.evaluate(() => window.__game!.world.save.sky);
  expect(saved.offset).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("sky: ?time= sets the time of day and holds it", async ({ page }) => {
  const errors = await boot(page, "/?time=night");
  await startGame(page, { sky: false });
  await waitTicks(page, 60);
  const s = await light(page);
  expect(s.phase).toBe("night");
  expect(Math.min(s.t, 1 - s.t)).toBeLessThan(0.001);
  expect(errors).toEqual([]);
});
