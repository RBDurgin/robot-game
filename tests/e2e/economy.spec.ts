import { expect, test } from "@playwright/test";
import { boot, fitPart, SHOTS, startGame, waitTicks } from "./helpers";

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
  await expect(page.getByRole("heading", { name: "Your parts · 400 scrap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Repair and deploy · 18 scrap" })).toBeVisible();

  // Nothing fitted can be sold, and the seeker rack is out of reach after buying a cannon.
  await expect(page.getByRole("button", { name: /^Sell PR-2 Pulse Rifle/ })).toBeDisabled();
  await page.getByRole("button", { name: /^Buy SC-9 Slug Cannon/ }).click();
  await expect(page.getByRole("heading", { name: "Your parts · 220 scrap" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Buy .*Seeker/ })).toBeDisabled();
  await page.getByRole("button", { name: /^Buy SC-9 Slug Cannon/ }).click();
  await page.getByRole("button", { name: /^Sell SC-9 Slug Cannon/ }).click();
  await expect(page.getByRole("heading", { name: "Your parts · 112 scrap" })).toBeVisible();

  // The cannon bought is on offer in the arm slots; once fitted it cannot be sold.
  await fitPart(page, "Right arm", "slugCannon");
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

  // A salvaged part keeps its mark and modifiers: it shows in the hangar, tunes the weapon and
  // is worth more than a plain one.
  const tuned = await page.evaluate(() => {
    const w = window.__game!.world;
    w.save.inventory.push({ uid: 99, id: "pulseRifle", tier: 3, mods: ["cooled", "rapid"] });
    w.deploy("medium", { weapons: { armR: 99 }, plating: w.save.fit.plating });
    const def = w.player.weapons.armR!.def;
    return { damage: def.damage, heat: def.heat, cooldown: def.cooldown };
  });
  expect(tuned).toEqual({ damage: 9.3, heat: 2.21, cooldown: 0.099 });
  await page.keyboard.press("KeyH");
  await expect(page.getByRole("button", { name: "Sell PR-2 Pulse Rifle Mk III · Cooled, Rapid for 144 scrap" })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/21-tiered-part.png` });
  await page.getByRole("button", { name: /Repair and deploy/ }).click();
  await waitTicks(page, 5);

  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const reloaded = await page.evaluate(() => {
    const w = window.__game!.world;
    return { scrap: w.save.scrap, armR: w.player.weapons.armR?.def.id, version: w.save.version, parts: w.save.inventory.map((item) => item.id).sort() };
  });
  expect(reloaded).toEqual({ scrap: 0, armR: "pulseRifle", version: 2, parts: ["arcLauncher", "pulseRifle", "pulseRifle", "slugCannon", "standardPlating"] });
  expect(errors).toEqual([]);
});
