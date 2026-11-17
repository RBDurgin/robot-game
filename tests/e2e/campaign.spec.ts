import { expect, test, type Page } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

/** Put the player down at a point, a little above the ground. */
async function goTo(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(([px, pz]) => {
    const w = window.__game!.world;
    w.player.teleport({ x: px!, y: w.heightAt(px!, pz!) + 2, z: pz! }, 0);
  }, [x, z]);
  await waitTicks(page, 4);
}

const stage = (page: Page) => page.evaluate(() => window.__game!.world.mission?.state.stage ?? null);

/** Take the mission on offer from its briefing at the home base. */
async function accept(page: Page, title: string): Promise<void> {
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.player.teleport({ x: w.homeBase.x + 8, y: w.heightAt(w.homeBase.x + 8, w.homeBase.z + 8) + 2, z: w.homeBase.z + 8 }, 0);
  });
  await waitTicks(page, 4);
  await page.keyboard.press("KeyB");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** Destroy every pilot of the squad a mission has brought in, once all `count` of them are in the scene. */
async function destroySquad(page: Page, count: number, last = false): Promise<void> {
  await page.waitForFunction((n) => window.__game!.world.enemies.length >= n, count, { timeout: 60_000 });
  await page.evaluate(() => {
    const w = window.__game!.world;
    for (const enemy of w.enemies) w.combat.damage(enemy, "torso", 100_000, w.player);
  });
  // The last squad ends the mission, and the summary stops the clock.
  if (!last) await waitTicks(page, 4);
}

test("campaign: a recon and a defence, taken from briefings at base", async ({ page }) => {
  test.setTimeout(300_000);
  // A pilot who has already flown the first mission.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ version: 4, cleared: ["kestrel-outpost"], missions: { done: ["first-outpost"], active: null } }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await waitTicks(page, 5);

  // The next mission is on offer, not under way: it is taken at a base.
  expect(await page.evaluate(() => ({ active: window.__game!.world.mission, offered: window.__game!.world.offered?.id }))).toEqual({ active: null, offered: "listening-post" });
  await accept(page, "Listening Post");
  await page.screenshot({ path: `${SHOTS}/20-briefing.png` });
  await page.getByRole("button", { name: "Not now" }).click();
  expect(await stage(page)).toBeNull();
  await accept(page, "Listening Post");
  await page.getByRole("button", { name: "Accept" }).click();
  await waitTicks(page, 3);
  expect(await stage(page)).toBe("travel");

  // Recon: reach the Dish, where a Combine team is working, and visit the three masts.
  await goTo(page, -1250, -1700);
  expect(await stage(page)).toBe("mast-1");
  await page.waitForFunction(() => window.__game!.world.enemies.length === 3, undefined, { timeout: 60_000 });
  await waitTicks(page, 20);
  await page.screenshot({ path: `${SHOTS}/21-recon.png` });
  for (const [x, z, next] of [[-1140, -1450, "mast-2"], [-1330, -1400, "mast-3"], [-1290, -1620, "withdraw"]] as const) {
    await goTo(page, x, z);
    expect(await stage(page)).toBe(next);
  }
  const before = await page.evaluate(() => ({ scrap: window.__game!.world.save.scrap, drifters: window.__game!.world.save.standing.drifters }));
  // Leaving ends the mission, and the summary stops the clock.
  await page.evaluate(() => window.__game!.world.player.teleport({ x: -1250, y: window.__game!.world.heightAt(-1250, -900) + 2, z: -900 }, 0));
  await expect(page.getByRole("heading", { name: "Listening Post" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("150 scrap, +5 standing with the Drifters")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/22-recon-debrief.png` });
  await page.getByRole("button", { name: "Continue" }).click();
  const paid = await page.evaluate(() => {
    const w = window.__game!.world;
    return { scrap: w.save.scrap, drifters: w.save.standing.drifters, done: w.save.missions.done, offered: w.offered?.id, squads: w.population.filter((r) => r.mission && !r.active).length };
  });
  expect(paid).toEqual({ scrap: before.scrap + 150, drifters: before.drifters + 5, done: ["first-outpost", "listening-post"], offered: "the-needle", squads: 0 });

  // Defence: leaving the ground being held fails the mission, and it can be taken again.
  await accept(page, "The Needle");
  await page.getByRole("button", { name: "Accept" }).click();
  await goTo(page, 150, -2520);
  expect(await stage(page)).toBe("wave-1");
  await goTo(page, 150, -2000);
  expect(await page.evaluate(() => ({ active: window.__game!.world.mission, offered: window.__game!.world.offered?.id }))).toEqual({ active: null, offered: "the-needle" });

  await accept(page, "The Needle");
  await page.getByRole("button", { name: "Accept" }).click();
  await goTo(page, 150, -2520);
  expect(await stage(page)).toBe("wave-1");

  // A mission in progress survives a reload: the stage starts again with its squad.
  await page.evaluate(() => window.__game!.world.pause());
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  expect(await stage(page)).toBe("wave-1");

  // Three waves come at the spire; each must be destroyed.
  for (const [count, next] of [[3, "wave-2"], [4, "wave-3"]] as const) {
    await destroySquad(page, count);
    expect(await stage(page)).toBe(next);
    if (next === "wave-2") await page.screenshot({ path: `${SHOTS}/23-defend.png` });
  }
  // The waves hunt the player whatever their standing, and say so on the radar.
  expect(await page.evaluate(() => window.__game!.world.enemies.every((m) => m.brain!.state.mode !== "patrol" || m.brain!.state.alerted))).toBe(true);
  await destroySquad(page, 4, true);
  await expect(page.getByRole("heading", { name: "The Needle held" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await waitTicks(page, 10);
  await page.screenshot({ path: `${SHOTS}/24-harbor-speaks.png` });
  expect(await page.evaluate(() => window.__game!.world.save.missions)).toEqual({ done: ["first-outpost", "listening-post", "the-needle"], active: null });

  expect(errors).toEqual([]);
});
