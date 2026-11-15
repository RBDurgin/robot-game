import { expect, test } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

test("mission loop: clear outpost, salvage, return, refit in hangar, progress is saved", async ({ page }) => {
  const errors = await boot(page);

  // Start screen: briefing, controls and settings; the simulation is paused behind it.
  await expect(page.getByRole("heading", { name: "Ashfall Basin" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-start-screen.png` });
  expect(await page.evaluate(() => window.__game!.world.tick)).toBe(0);
  await startGame(page);
  await waitTicks(page, 30);

  // Pause and resume.
  await page.keyboard.press("KeyP");
  await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
  const pausedTick = await page.evaluate(() => window.__game!.world.tick);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__game!.world.tick)).toBe(pausedTick);
  await page.getByRole("button", { name: "Resume" }).click();
  await waitTicks(page, 5);

  // The hangar is only available at base: walk away first and H does nothing.
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.player.teleport({ x: -150, y: 60, z: -150 }, 0);
  });
  await waitTicks(page, 5);
  await page.keyboard.press("KeyH");
  expect(await page.evaluate(() => window.__game!.world.mode)).toBe("playing");

  // Destroy the garrison (through the real damage path) and check each leaves salvage.
  await page.evaluate(() => {
    const w = window.__game!.world;
    for (const enemy of w.enemies) w.combat.damage(enemy, "torso", 100_000, w.player);
  });
  await waitTicks(page, 3);
  const cleared = await page.evaluate(() => {
    const w = window.__game!.world;
    return { phase: w.phase, kills: w.kills, crates: w.salvage.count, mechs: w.mechs.length };
  });
  expect(cleared).toEqual({ phase: "return", kills: 5, crates: 5, mechs: 1 });

  // Walk over every crate to collect it.
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const w = window.__game!.world;
      const p = w.salvage.positions[0]!;
      w.player.teleport({ x: p.x, y: p.y, z: p.z }, 0);
    });
    await waitTicks(page, 3);
  }
  const looted = await page.evaluate(() => {
    const w = window.__game!.world;
    return { crates: w.salvage.count, scrap: w.save.scrap, items: w.itemsSalvaged, inventory: w.save.inventory };
  });
  expect(looted.crates).toBe(0);
  expect(looted.scrap).toBeGreaterThanOrEqual(5 * 12);
  expect(looted.items).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/08-salvaged.png` });

  // Returning to base completes the mission.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const b = w.zone.playerBase;
    w.player.teleport({ x: b.x + 8, y: w.player.feet.y + 40, z: b.z + 8 }, 0);
  });
  await expect(page.getByRole("heading", { name: "Outpost cleared" })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/09-mission-complete.png` });
  await page.getByRole("button", { name: "Keep exploring" }).click();
  await waitTicks(page, 120);

  // Hangar: fit a salvaged weapon in place of the rifle.
  await page.keyboard.press("KeyH");
  await expect(page.getByRole("heading", { name: /Hangar/ })).toBeVisible();
  const salvagedWeapon = Object.keys(looted.inventory).find((id) => ["slugCannon", "swarmPod"].includes(id));
  if (salvagedWeapon) {
    await page.getByLabel("Right arm").selectOption(salvagedWeapon);
  }
  // An unarmed build is refused.
  await page.getByLabel("Right arm").selectOption("");
  await page.getByLabel("Left arm").selectOption("");
  await expect(page.getByText("No weapon fitted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Repair and deploy" })).toBeDisabled();
  await page.getByLabel("Right arm").selectOption("arcLauncher");
  await expect(page.getByRole("button", { name: "Repair and deploy" })).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/10-hangar.png` });
  await page.getByRole("button", { name: "Repair and deploy" }).click();
  await waitTicks(page, 5);
  const fitted = await page.evaluate(() => {
    const w = window.__game!.world;
    return { mode: w.mode, armR: w.player.weapons.armR?.def.id ?? null, armL: w.player.weapons.armL?.def.id ?? null };
  });
  expect(fitted).toEqual({ mode: "playing", armR: "arcLauncher", armL: null });

  // Progress survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const reloaded = await page.evaluate(() => {
    const w = window.__game!.world;
    return { scrap: w.save.scrap, armR: w.player.weapons.armR?.def.id ?? null, armL: w.player.weapons.armL?.def.id ?? null };
  });
  expect(reloaded).toEqual({ scrap: looted.scrap, armR: "arcLauncher", armL: null });

  expect(errors).toEqual([]);
});
