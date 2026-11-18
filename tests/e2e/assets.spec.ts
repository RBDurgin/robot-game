import { expect, test } from "@playwright/test";
import { approachOutpost, boot, SHOTS, startGame, waitTicks } from "./helpers";

/** Look at the player from the front-left, close up. */
async function showcase(page: import("@playwright/test").Page, yaw = 0.6): Promise<void> {
  await page.evaluate((a) => (window.__game!.world.cameraRig.showcase = { yaw: a, distance: 9, height: 1.5 }), yaw);
  await waitTicks(page, 3);
}

const ALL_PARTS = ["armL", "armR", "backpack", "head", "legs", "torso"];

test("imported and procedural parts share one mech, which animates and fights", async ({ page }) => {
  // Withhold the medium legs, so the player's mech mixes imported parts with procedural legs.
  await page.route("**/models/medium-legs.glb", (route) => route.fulfill({ status: 404, body: "missing" }));
  const errors = await boot(page);
  await startGame(page);
  await waitTicks(page, 30);

  const parts = await page.evaluate(() => window.__game!.world.player.visual.importedParts.sort());
  expect(parts).toEqual([...ALL_PARTS.filter((p) => p !== "legs"), "armR:weapon", "armL:weapon"].sort());
  await showcase(page);
  await page.screenshot({ path: `${SHOTS}/40-model-torso.png` });
  await showcase(page, Math.PI + 0.6);
  await page.screenshot({ path: `${SHOTS}/41-model-torso-back.png` });

  // Walking and aiming move the procedural legs and arms hung from the model's attachment points.
  await page.evaluate(() => (window.__game!.world.intentOverride = { moveZ: 1, aimPitch: 0.4 }));
  await waitTicks(page, 40);
  await showcase(page, 1.4);
  await page.screenshot({ path: `${SHOTS}/42-model-walking.png` });
  const arm = await page.evaluate(() => {
    const w = window.__game!.world;
    const torso = w.player.visual.root.getChildMeshes().find((m) => m.name.includes("torso") && m.isEnabled());
    const hand = w.player.visual.root.getChildTransformNodes().find((n) => n.name === "hand");
    return { torso: !!torso, handY: hand?.getAbsolutePosition().y ?? 0, feetY: w.player.feet.y };
  });
  expect(arm.torso).toBe(true);
  // The hand is carried up at shoulder height, not left at the origin.
  expect(arm.handY - arm.feetY).toBeGreaterThan(2);

  // Enemies built entirely from imported models fight too.
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.cameraRig.showcase = null;
    w.intentOverride = null;
  });
  await approachOutpost(page);
  const enemyParts = await page.evaluate(() =>
    window.__game!.world.enemies.filter((m) => m.frame.id !== "medium").map((m) => m.visual.importedParts.filter((p) => !p.includes(":")).sort().join(",")),
  );
  expect(enemyParts.length).toBeGreaterThan(0);
  for (const p of enemyParts) expect(p).toBe(ALL_PARTS.join(","));
  await page.evaluate(() => {
    const w = window.__game!.world;
    const heavy = w.enemies.find((m) => m.frame.id === "heavy")!;
    w.player.teleport({ x: heavy.feet.x + 6, y: heavy.feet.y + 1, z: heavy.feet.z + 10 }, Math.PI + 0.6);
  });
  await waitTicks(page, 20);
  await page.screenshot({ path: `${SHOTS}/44-model-enemies.png` });
  // The browser logs the withheld file's 404 itself.
  expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
});

test("a missing model falls back to the procedural part without errors", async ({ page }) => {
  await page.route("**/models/medium-torso.glb", (route) => route.fulfill({ status: 404, body: "missing" }));
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  const errors = await boot(page);
  await startGame(page);
  await waitTicks(page, 30);

  const parts = await page.evaluate(() => window.__game!.world.player.visual.importedParts);
  expect(parts).not.toContain("torso");
  expect(parts).toContain("legs");
  expect(warnings.some((w) => w.includes("medium-torso.glb did not load"))).toBe(true);
  await showcase(page);
  await page.screenshot({ path: `${SHOTS}/43-model-missing-fallback.png` });
  // The browser logs the failed fetch itself; nothing else may go wrong.
  expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
});
