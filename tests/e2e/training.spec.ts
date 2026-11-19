import { expect, test, type Page } from "@playwright/test";
import { boot, SHOTS, startGame } from "./helpers";

const stage = (page: Page) => page.evaluate(() => window.__game!.world.save.missions.active?.stage ?? null);
const drive = (page: Page, intent: Record<string, number | boolean> | null) =>
  page.evaluate((i) => (window.__game!.world.intentOverride = i), intent);
const reach = (page: Page, id: string) =>
  page.waitForFunction((s) => window.__game!.world.save.missions.active?.stage === s, id, { timeout: 110_000 });

test("a new pilot is taught the controls in the first mission", async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByRole("button", { name: "Deploy and skip training" })).toBeVisible();
  await startGame(page, { training: true });
  expect(await stage(page)).toBe("t-move");
  // Prompts name the keys as bound.
  await page.waitForFunction(() => {
    const t = window.__game!.world.hud.ui.getControlByName("objective") as unknown as { text: string } | null;
    return t?.text.includes("W A S D to move") ?? false;
  });
  await page.screenshot({ path: `${SHOTS}/training-move.png` });

  await drive(page, { moveZ: 1 });
  await reach(page, "t-sprint");
  await drive(page, { moveZ: 1, sprint: true });
  await reach(page, "t-jets");
  await drive(page, { jump: true });
  await reach(page, "t-boost");
  await drive(page, { moveX: 1, boost: true });
  await reach(page, "t-fire");
  await drive(page, { firePrimary: true, fireSecondary: true });
  await reach(page, "t-heat");
  await reach(page, "t-hangar");
  await drive(page, null);
  // Training has carried the suit off across the yard; the waypoint leads back to base, where
  // the hangar opens. Go straight there.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const b = w.heldBases[0]!;
    w.player.teleport({ x: b.x + 8, y: w.heightAt(b.x + 8, b.z + 8) + 2, z: b.z + 8 }, 0);
  });
  await page.waitForFunction(() => window.__game!.world.atBase);
  await page.keyboard.press("KeyH");
  await page.waitForFunction(() => window.__game!.world.mode === "hangar");
  await page.getByRole("button", { name: /Repair and deploy/ }).click();
  await reach(page, "assault");
  expect(errors).toEqual([]);
});

test("training can be skipped from the pause menu, and replays start at the fight", async ({ page }) => {
  await boot(page);
  await startGame(page, { training: true });
  expect(await stage(page)).toBe("t-move");
  await page.keyboard.press("KeyP");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.waitForFunction(() => window.__game!.world.mode === "playing");
  expect(await stage(page)).toBe("assault");
  // Nothing to skip any more.
  await page.keyboard.press("KeyP");
  await expect(page.getByRole("button", { name: "Skip training" })).toHaveCount(0);
});
