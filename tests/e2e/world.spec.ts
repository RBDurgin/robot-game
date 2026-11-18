import { expect, test, type Page } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

/** Put the player down at a point and let the game settle there. */
async function goTo(page: Page, x: number, z: number, yaw = 0): Promise<void> {
  await page.evaluate(
    ([x, z, yaw]) => {
      const w = window.__game!.world;
      w.player.teleport({ x: x!, y: w.heightAt(x!, z!) + 1, z: z! }, yaw!);
      w.intentOverride = { aimYaw: yaw!, aimPitch: -0.05 };
    },
    [x, z, yaw],
  );
  await waitTicks(page, 40);
}

const worldState = (page: Page) =>
  page.evaluate(() => {
    const w = window.__game!.world;
    const p = w.player.feet;
    return {
      x: p.x,
      z: p.z,
      aboveGround: p.y - w.heightAt(p.x, p.z),
      grounded: w.player.state.grounded,
      region: w.region.name,
      stream: w.terrain.stats,
      meshes: w.scene.meshes.length,
      materials: w.scene.materials.length,
      bodies: (w.scene.getPhysicsEngine() as unknown as { getBodies(): unknown[] }).getBodies().length,
      enemies: w.enemies.length,
      worst: { ...w.terrain.worst },
    };
  });

test("open world: terrain streams in and out across biomes, and the edge is walled", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);
  await waitTicks(page, 60);

  const start = await worldState(page);
  expect(start.region).toBe("Ashfall Basin");
  expect(start.grounded).toBe(true);
  expect(start.stream.chunks).toBeGreaterThan(60);
  expect(start.stream.queued).toBe(0);
  // Only the chunks near the player carry colliders and structures.
  expect(start.stream.colliders).toBeLessThan(start.stream.detail);
  expect(start.stream.detail).toBeLessThan(start.stream.chunks);
  expect(start.enemies).toBe(0);

  // Walk: sprint north-east across at least one chunk border, streaming as we go.
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.terrain.worst.jobMs = w.terrain.worst.updateMs = 0;
    w.intentOverride = { moveZ: 1, sprint: true, aimYaw: 0.8, aimPitch: -0.05 };
  });
  await waitTicks(page, 900);
  const walked = await worldState(page);
  const distance = Math.hypot(walked.x - start.x, walked.z - start.z);
  expect(distance).toBeGreaterThan(200);
  expect(walked.aboveGround).toBeGreaterThan(-0.5);
  expect(walked.aboveGround).toBeLessThan(6);
  // Streaming keeps to its per-frame budget: no single job is a hitch, even on this slow machine.
  console.log(`walked ${distance.toFixed(0)} m; worst streaming job ${walked.worst.jobMs.toFixed(1)} ms, worst frame of streaming ${walked.worst.updateMs.toFixed(1)} ms; start-up load ${start.worst.loadAllMs.toFixed(0)} ms`);
  expect(walked.worst.jobMs).toBeLessThan(25);
  await page.screenshot({ path: `${SHOTS}/14-walked-basin.png` });

  // Tour: one stop in each kind of country, kilometres apart.
  const stops: [string, string, number, number, number][] = [
    ["15-salt-flats", "Mirror Pan", -2400, -2450, 0.6],
    ["16-ruins", "Sunken Quarter", 60, -2500, 0.4],
    ["17-highlands", "Greywall Highlands", -2600, 150, 1.2],
    ["18-highlands-outpost", "Kestrel Rise", 2450, 2250, 0.2],
    ["19-fallen-carrier", "Ashfall Basin", 1290, 1040, 0.5],
  ];
  let most = start.stream.chunks;
  for (const [shot, region, x, z, yaw] of stops) {
    await goTo(page, x, z, yaw);
    const s = await worldState(page);
    expect(s.region, shot).toBe(region);
    // Standing on the ground, not fallen through it.
    expect(s.aboveGround, shot).toBeGreaterThan(-0.8);
    expect(s.aboveGround, shot).toBeLessThan(3);
    most = Math.max(most, s.stream.chunks);
    await waitTicks(page, 60);
    await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  }
  // The home chunks were unloaded long ago.
  const home = await page.evaluate(() => {
    const w = window.__game!.world;
    return w.terrain.hasGround(w.homeBase.x, w.homeBase.z);
  });
  expect(home).toBe(false);

  // What is loaded stays bounded however far we travel: nothing leaks.
  const end = await worldState(page);
  expect(most).toBeLessThanOrEqual(121);
  expect(end.stream.chunks).toBeLessThanOrEqual(121);
  // New materials only come with each new faction met: six part materials per colour scheme.
  expect(end.materials).toBeLessThanOrEqual(start.materials + 18);
  expect(end.meshes).toBeLessThan(start.meshes * 2 + 200);
  expect(end.bodies).toBeLessThan(start.bodies * 2 + 100);

  // The edge: mountains, and a hard stop for anyone who climbs them.
  await goTo(page, 4050, 300, Math.PI / 2);
  const edge = await page.evaluate(() => {
    const w = window.__game!.world;
    return { x: w.player.feet.x, limit: w.model.def.size / 2 - w.model.def.edgeMargin, height: w.heightAt(w.player.feet.x, 300), inland: w.heightAt(3000, 300) };
  });
  expect(edge.x).toBeLessThanOrEqual(edge.limit + 0.01);
  expect(edge.height).toBeGreaterThan(edge.inland + 100);
  await goTo(page, 3200, 300, Math.PI / 2);
  await page.screenshot({ path: `${SHOTS}/20-rim-mountains.png` });

  expect(errors).toEqual([]);
});

test("open world: discovery, taking a base, the map, fast travel and saved progress", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);
  await waitTicks(page, 30);

  // The map starts with only the home base on it.
  await page.keyboard.press("KeyM");
  await expect(page.getByRole("heading", { name: "The Ashfall Marches" })).toBeVisible();
  await expect(page.getByText(/Places found · 1 of \d+/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Travel to Drifters' Rest" })).toBeDisabled(); // already here
  await page.keyboard.press("KeyM");
  expect(await page.evaluate(() => window.__game!.world.mode)).toBe("playing");

  // The war is held still so that who holds what does not change under the test.
  await page.evaluate(() => (window.__game!.world.warPaused = true));

  // A base of the Drifter Compact, far to the north-west. They count the player an ally, so
  // it is open to them without being theirs.
  await goTo(page, -2050, 2350);
  const taken = await page.evaluate(() => {
    const w = window.__game!.world;
    return { discovered: w.save.discovered, held: w.save.held, atBase: w.atBase, bases: w.heldBases.map((b) => b.id), owner: w.ownerOf("tarn-lookout"), enemies: w.enemies.length };
  });
  expect(taken.discovered).toContain("tarn-lookout");
  expect(taken).toMatchObject({ held: [], atBase: true, bases: ["drifters-rest"], owner: "drifters", enemies: 0 });
  // An ally's base has a working hangar.
  await page.keyboard.press("KeyH");
  await expect(page.getByRole("heading", { name: /Hangar/ })).toBeVisible();
  await page.getByRole("button", { name: "Repair and deploy" }).click();

  // A depot's cache: two crates, there until taken, then gone for good.
  const depot = await page.evaluate(() => {
    const s = window.__game!.world.model.sites.find((s) => s.kind === "depot")!;
    return { id: s.id, x: s.x, z: s.z, name: s.name };
  });
  await goTo(page, depot.x, depot.z - 40);
  expect(await page.evaluate((id) => window.__game!.world.salvage.countAt(id), depot.id)).toBe(2);
  await page.screenshot({ path: `${SHOTS}/21-depot.png` });
  const scrapBefore = await page.evaluate(() => window.__game!.world.save.scrap);
  for (let i = 0; i < 2; i++) {
    await page.evaluate((id) => {
      const w = window.__game!.world;
      const p = w.salvage.positionsAt(id)[0]!;
      w.player.teleport({ x: p.x, y: p.y, z: p.z }, 0);
    }, depot.id);
    await waitTicks(page, 4);
  }
  const lootedNow = await page.evaluate(() => ({ scrap: window.__game!.world.save.scrap, looted: window.__game!.world.save.looted }));
  expect(lootedNow.scrap).toBeGreaterThanOrEqual(scrapBefore + 40);
  expect(lootedNow.looted).toEqual([depot.id]);

  // Enemies wake as the player nears a camp, keep their damage while asleep, and stay dead.
  const camp = await page.evaluate(() => {
    const w = window.__game!.world;
    const s = w.model.sites.find((s) => s.kind === "camp" && w.ownerOf(s.id) === "combine")!;
    return { id: s.id, x: s.x, z: s.z };
  });
  await goTo(page, camp.x - 80, camp.z);
  await page.waitForFunction(() => window.__game!.world.enemies.length === 2, undefined, { timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/22-camp.png` });
  // Wound one and destroy the other. Travel is refused while the survivor hunts the player.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const [a, b] = w.enemies;
    w.combat.damage(a!, "legs", 25, w.player);
    w.combat.damage(b!, "torso", 100_000, w.player);
  });
  await waitTicks(page, 5);
  const fight = await page.evaluate(() => {
    const w = window.__game!.world;
    const legs = w.enemies[0]?.health.sections.legs;
    return { enemies: w.enemies.length, inCombat: w.inCombat, travelled: w.travelTo("drifters-rest"), legArmor: legs ? legs.armor + legs.structure : -1 };
  });
  expect(fight).toEqual({ enemies: 1, inCombat: true, travelled: false, legArmor: fight.legArmor });
  await goTo(page, camp.x - 1500, camp.z);
  expect(await page.evaluate(() => window.__game!.world.enemies.length)).toBe(0);
  await goTo(page, camp.x - 80, camp.z);
  await page.waitForFunction(() => window.__game!.world.enemies.length === 1, undefined, { timeout: 60_000 });
  const back = await page.evaluate(() => {
    const w = window.__game!.world;
    const m = w.enemies[0]!;
    const legs = m.health.sections.legs;
    const legArmor = legs.armor + legs.structure;
    w.combat.damage(m, "torso", 100_000, w.player);
    return { legArmor, wounded: legs.armor < legs.maxArmor };
  });
  // The same wounded pilot came back, not a fresh one.
  expect(back).toEqual({ legArmor: fight.legArmor, wounded: true });
  await waitTicks(page, 5);
  expect(await page.evaluate(() => window.__game!.world.save.cleared)).toEqual([camp.id]);

  // The map now shows what has been found, and fast travel goes to the player's base or an ally's.
  await page.keyboard.press("KeyM");
  await expect(page.getByText(/Places found · [4-9] of \d+/)).toBeVisible();
  await expect(page.locator(".places")).toContainText("Tarn Lookout (Drifters)");
  await expect(page.locator(".places")).toContainText(depot.name);
  await page.screenshot({ path: `${SHOTS}/23-world-map.png` });
  await expect(page.locator(".factions")).toContainText("Drifter Compact: allied");
  await expect(page.locator(".factions")).toContainText("Kestrel Combine: hostile");
  await page.getByRole("button", { name: "Travel to Tarn Lookout (Drifters)" }).click();
  await waitTicks(page, 30);
  const arrived = await page.evaluate(() => {
    const w = window.__game!.world;
    return { mode: w.mode, base: w.currentBase?.id ?? null, grounded: w.player.state.grounded, region: w.region.name };
  });
  expect(arrived).toEqual({ mode: "playing", base: "tarn-lookout", grounded: true, region: "Tarn Heights" });
  await page.screenshot({ path: `${SHOTS}/24-fast-travel.png` });

  // Everything survives a reload: where the player is and what they have found, taken and looted.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const reloaded = await page.evaluate(() => {
    const w = window.__game!.world;
    return {
      base: w.currentBase?.id ?? null,
      held: w.save.held,
      looted: w.save.looted,
      cleared: w.save.cleared,
      discovered: w.save.discovered.length,
      campLeft: w.population.filter((r) => r.siteId === w.save.cleared[0]).length,
      campOwner: w.ownerOf(w.save.cleared[0]!),
    };
  });
  expect(reloaded).toEqual({ base: "tarn-lookout", held: [], looted: [depot.id], cleared: [camp.id], discovered: reloaded.discovered, campLeft: 0, campOwner: null });
  expect(reloaded.discovered).toBeGreaterThanOrEqual(4);

  expect(errors).toEqual([]);
});
