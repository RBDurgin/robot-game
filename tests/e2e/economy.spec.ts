import { expect, test } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

test("economy: repairs are billed, parts are bought, fitted and sold, and it all persists", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("robot-game-save-v1")) {
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ scrap: 400 }));
    }
  });
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.warPaused = true;
    // 150 points of armor gone: an 18 scrap repair.
    w.player.health.sections.legs.armor -= 90;
    w.player.health.sections.armL.armor -= 60;
  });

  await page.keyboard.press("KeyH");
  await expect(page.getByRole("heading", { name: /Hangar/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Parts store · 400 scrap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Repair and deploy · 18 scrap" })).toBeVisible();

  // Nothing fitted can be sold, and the seeker rack is out of reach after buying a cannon.
  await expect(page.getByRole("button", { name: /^Sell PR-2 Pulse Rifle/ })).toBeDisabled();
  await page.getByRole("button", { name: /^Buy SC-9 Slug Cannon/ }).click();
  await expect(page.getByRole("heading", { name: "Parts store · 220 scrap" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Buy .*Seeker/ })).toBeDisabled();
  await page.getByRole("button", { name: /^Buy SC-9 Slug Cannon/ }).click();
  await page.getByRole("button", { name: /^Sell SC-9 Slug Cannon/ }).click();
  await expect(page.getByRole("heading", { name: "Parts store · 112 scrap" })).toBeVisible();

  // The cannon bought is on offer in the arm slots; once fitted it cannot be sold.
  await page.getByLabel("Right arm").selectOption("slugCannon");
  await expect(page.getByRole("button", { name: /^Sell SC-9 Slug Cannon/ })).toBeDisabled();
  // The rifle is off the bench build but still on the suit outside, so it stays unsellable.
  await expect(page.getByRole("button", { name: /^Sell PR-2 Pulse Rifle/ })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/20-shop.png` });
  await page.getByRole("button", { name: /Repair and deploy/ }).click();
  await waitTicks(page, 5);
  const deployed = await page.evaluate(() => {
    const w = window.__game!.world;
    const s = w.player.health.sections;
    return { scrap: w.save.scrap, armR: w.player.weapons.armR?.def.id, legs: s.legs.armor === s.legs.maxArmor };
  });
  expect(deployed).toEqual({ scrap: 94, armR: "slugCannon", legs: true });

  // Losing the suit costs a repair too, capped and never more than the player has.
  const died = await page.evaluate(() => {
    const w = window.__game!.world;
    for (const s of Object.values(w.player.health.sections)) s.armor = s.structure = 0;
    (w as unknown as { respawnPlayer(): void }).respawnPlayer();
    const first = w.save.scrap;
    for (const s of Object.values(w.player.health.sections)) s.armor = s.structure = 0;
    (w as unknown as { respawnPlayer(): void }).respawnPlayer();
    return { first, second: w.save.scrap, alive: w.player.alive };
  });
  // A whole medium suit is 610 points: 74 scrap the first time, then all of the 20 that is left.
  expect(died).toEqual({ first: 20, second: 0, alive: true });

  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const reloaded = await page.evaluate(() => {
    const w = window.__game!.world;
    return { scrap: w.save.scrap, armR: w.player.weapons.armR?.def.id, cannons: w.save.inventory.slugCannon, rifles: w.save.inventory.pulseRifle };
  });
  expect(reloaded).toEqual({ scrap: 0, armR: "slugCannon", cannons: 1, rifles: 1 });
  expect(errors).toEqual([]);
});
