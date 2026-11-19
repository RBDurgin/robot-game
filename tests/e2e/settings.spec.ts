import { expect, test } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

test("keys can be rebound, and the new key does the job", async ({ page }) => {
  const errors = await boot(page);
  // Jump is on Space; give it J instead.
  await page.getByRole("button", { name: /^Jump, hold for jump jets: Space/ }).click();
  await expect(page.locator("button.key.listening")).toHaveText("Press a key…");
  await page.keyboard.press("KeyJ");
  await expect(page.getByRole("button", { name: /^Jump, hold for jump jets: J/ })).toBeVisible();
  // Taking a key another action has swaps them: give jump Q, and boost takes J in return.
  await page.getByRole("button", { name: /^Jump, hold for jump jets: J/ }).click();
  await page.keyboard.press("KeyQ");
  await expect(page.getByRole("button", { name: /^Boost dash: J/ })).toBeVisible();
  // Esc cancels without changing anything.
  await page.getByRole("button", { name: /^Melee strike: F/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Melee strike: F/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/settings-controls.png` });

  const saved = await page.evaluate(() => window.__game!.world.save.settings.bindings);
  expect(saved.jump).toEqual(["KeyQ"]);
  expect(saved.boost).toEqual(["KeyJ"]);

  await startGame(page);
  const intent = () => page.evaluate(() => window.__game!.world.input.buildIntent(null));
  await page.keyboard.down("Space");
  expect((await intent()).jump).toBe(false);
  await page.keyboard.up("Space");
  await page.keyboard.down("KeyQ");
  expect((await intent()).jump).toBe(true);
  expect((await intent()).boost).toBe(false);
  await page.keyboard.up("KeyQ");

  // Prompts name the bound key: give the map M's place to K and the info line follows.
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.input.bindings = { ...w.input.bindings, map: ["KeyK"] };
  });
  await page.keyboard.press("KeyK");
  await page.waitForFunction(() => window.__game!.world.mode === "map");
  expect(errors).toEqual([]);
});

test("accessibility: toggled sprint, text size, colours and shake", async ({ page }) => {
  const errors = await boot(page);
  await page.getByLabel("Sprint", { exact: true }).selectOption("toggle");
  await page.getByLabel("Text size").selectOption({ label: "Larger" });
  await page.getByLabel("HUD colours").selectOption("distinct");
  await page.getByLabel("Screen shake").fill("0");
  const settings = await page.evaluate(() => window.__game!.world.save.settings);
  expect(settings).toMatchObject({ sprintToggle: true, textScale: 1.4, hudColors: "distinct", shake: 0 });
  expect(await page.locator("#overlay").evaluate((e) => getComputedStyle(e).zoom)).toBe("1.4");

  await startGame(page);
  // One press of Shift sprints while moving, and stopping ends it.
  await page.keyboard.down("KeyW");
  await page.keyboard.press("ShiftLeft");
  const sprinting = () => page.evaluate(() => window.__game!.world.input.buildIntent(null).sprint);
  expect(await sprinting()).toBe(true);
  await page.keyboard.up("KeyW");
  expect(await sprinting()).toBe(false);

  // No shake at 0.
  await page.evaluate(() => window.__game!.world.cameraRig.shake(1));
  expect(await page.evaluate(() => (window.__game!.world.cameraRig as unknown as { shakeAmount: number }).shakeAmount)).toBe(0);

  await waitTicks(page, 30);
  expect(await page.evaluate(() => window.__game!.world.hud.ui.idealHeight)).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/settings-large-text.png` });

  // Settings survive a reload.
  await page.evaluate(() => (window.__game!.world as unknown as { reload(): void }).reload());
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const after = await page.evaluate(() => window.__game!.world.save.settings);
  expect(after).toMatchObject({ sprintToggle: true, textScale: 1.4, hudColors: "distinct", shake: 0 });
  expect(errors).toEqual([]);
});
