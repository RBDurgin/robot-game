import { expect, test, type Page } from "@playwright/test";
import { boot, SHOTS, startGame, waitTicks } from "./helpers";

/** Put the player down at an offset from a site and let the game settle there. */
async function goNear(page: Page, siteId: string, dx: number, dz: number, yaw = 0): Promise<void> {
  await page.evaluate(
    ([siteId, dx, dz, yaw]) => {
      const w = window.__game!.world;
      const site = w.model.siteById.get(siteId as string)!;
      const x = site.x + (dx as number);
      const z = site.z + (dz as number);
      w.player.teleport({ x, y: w.heightAt(x, z) + 1, z }, yaw as number);
      w.intentOverride = { aimYaw: yaw as number, aimPitch: -0.05 };
    },
    [siteId, dx, dz, yaw],
  );
  await waitTicks(page, 40);
}

/** Send a raid that arrives on the next tick of the war. */
async function sendRaid(page: Page, faction: string, from: string, to: string, troops: number): Promise<void> {
  await page.evaluate(
    ([faction, from, to, troops]) => {
      const w = window.__game!.world;
      w.war.raids.push({ id: w.war.nextRaid++, faction: faction as "combine", from: from as string, to: to as string, troops: troops as number, eta: 1, staged: false });
      w.warPaused = false;
    },
    [faction, from, to, troops],
  );
}

const WAR_TICK = 300;

test("faction war: a three-sided fight, and an outpost changes hands on the map", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await waitTicks(page, 20);

  // Pan Relay is held by the Drifters, who count the player an ally: nobody there is an enemy.
  await goNear(page, "pan-relay", 0, -120);
  await page.waitForFunction(() => window.__game!.world.others.length === 3, undefined, { timeout: 60_000 });
  const before = await page.evaluate(() => {
    const w = window.__game!.world;
    return { owner: w.ownerOf("pan-relay"), enemies: w.enemies.length, attitudes: w.others.map((m) => w.attitudeOfMech(m)), modes: w.others.map((m) => m.brain!.state.mode) };
  });
  expect(before).toEqual({ owner: "drifters", enemies: 0, attitudes: ["allied", "allied", "allied"], modes: ["patrol", "patrol", "patrol"] });

  // Allied pilots can be called to the player's wing, and follow.
  await page.evaluate(() => window.__game!.world.toggleWingmen());
  expect(await page.evaluate(() => window.__game!.world.wingmen.size)).toBe(2);
  await goNear(page, "pan-relay", -40, -260);
  // They have a compound wall to hop and a hundred metres to cover.
  await page.waitForFunction(
    () => {
      const w = window.__game!.world;
      return [...w.wingmen].every((m) => Math.hypot(m.feet.x - w.player.feet.x, m.feet.z - w.player.feet.z) < 40);
    },
    undefined,
    { timeout: 100_000 },
  );
  await page.screenshot({ path: `${SHOTS}/25-wingmen.png` });
  await page.evaluate(() => window.__game!.world.toggleWingmen());
  expect(await page.evaluate(() => window.__game!.world.wingmen.size)).toBe(0);

  // A Combine raid arrives. With the player watching, it is real mechs that walk in.
  await sendRaid(page, "combine", "citadel", "pan-relay", 3);
  await page.waitForFunction(() => window.__game!.world.war.raids.some((r) => r.staged), undefined, { timeout: 60_000 });
  // They start out of sight on the far side and march in; they wake as they come near.
  await page.waitForFunction(() => window.__game!.world.enemies.length === 3, undefined, { timeout: 100_000 });
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  // Skip the rest of the march: put the raiders at the gate and the player beside the fight.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const site = w.model.siteById.get("pan-relay")!;
    w.enemies.forEach((m, i) => {
      const x = site.x - 20 + i * 20;
      const z = site.z - 95;
      m.teleport({ x, y: w.heightAt(x, z) + 1, z }, 0);
    });
  });
  await goNear(page, "pan-relay", -170, -230, 0.7);
  // Three sides in one fight: Drifters and Combine engage each other, and the Combine the player.
  await page.waitForFunction(
    () => {
      const w = window.__game!.world;
      const fighting = w.others.filter((m) => m.brain!.state.mode !== "patrol");
      return fighting.some((m) => m.faction === "drifters") && fighting.some((m) => m.faction === "combine");
    },
    undefined,
    { timeout: 100_000 },
  );
  // Both sides draw blood (or lose a suit).
  await page.waitForFunction(
    () => {
      const w = window.__game!.world;
      const hurt = (faction: string) => {
        const ms = w.others.filter((m) => m.faction === faction);
        return ms.length < 3 || ms.some((m) => Object.values(m.health.sections).some((s) => s.armor < s.maxArmor));
      };
      return hurt("drifters") && hurt("combine");
    },
    undefined,
    { timeout: 100_000 },
  );
  await page.screenshot({ path: `${SHOTS}/26-three-sided-fight.png` });
  const fight = await page.evaluate(() => {
    const w = window.__game!.world;
    const drifters = w.others.filter((m) => m.faction === "drifters");
    const combine = w.others.filter((m) => m.faction === "combine");
    const hurt = (ms: typeof drifters) => ms.some((m) => Object.values(m.health.sections).some((s) => s.armor < s.maxArmor)) || ms.length < 3;
    return {
      // Nobody ever targets a friend, and the allies never target the player.
      targets: w.others.every((m) => !m.brain!.target || w.hostile(m, m.brain!.target)),
      alliesOnPlayer: drifters.some((m) => m.brain!.target === w.player),
      driftersHurt: hurt(drifters),
      combineHurt: hurt(combine),
      kills: w.kills,
    };
  });
  expect(fight).toEqual({ targets: true, alliesOnPlayer: false, driftersHurt: true, combineHurt: true, kills: 0 });

  // The raiders win (the garrison is destroyed by one of them) and the outpost is theirs.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const raider = w.others.find((m) => m.faction === "combine")!;
    const site = w.model.siteById.get("pan-relay")!;
    for (const m of w.others.filter((m) => m.faction === "drifters")) w.combat.damage(m, "torso", 100_000, raider);
    raider.teleport({ x: site.x, y: w.heightAt(site.x, site.z - 30) + 1, z: site.z - 30 }, 0);
    w.warPaused = false;
  });
  await page.waitForFunction(() => window.__game!.world.ownerOf("pan-relay") === "combine", undefined, { timeout: 100_000 });
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  const taken = await page.evaluate(() => {
    const w = window.__game!.world;
    return { troops: w.war.sites["pan-relay"]!.troops, raids: w.war.raids.length, garrison: w.population.filter((r) => r.siteId === "pan-relay" && r.alive).map((r) => `${r.faction}${r.raidId === undefined ? "" : " raid"}`), kills: w.kills, crates: w.salvage.countAt(null) };
  });
  expect(taken.raids).toBe(0);
  expect(taken.troops).toBeGreaterThanOrEqual(1);
  expect(taken.garrison).toEqual(Array(taken.troops).fill("combine"));
  // The war's own dead are not the player's kills and leave no salvage.
  expect(taken).toMatchObject({ kills: 0, crates: 0 });

  // The map shows the change: White Reach is now split between the Drifters and the Combine.
  await page.keyboard.press("KeyM");
  await expect(page.locator(".places")).toContainText("Pan Relay (Combine, hostile)");
  await expect(page.locator(".factions")).toContainText("Drifter Compact: allied");
  await page.screenshot({ path: `${SHOTS}/27-war-map.png` });
  await page.keyboard.press("KeyM");

  // The war goes on by itself: run it well ahead and sites have changed hands unseen.
  const later = await page.evaluate(() => {
    const w = window.__game!.world;
    const owners = () => Object.fromEntries(Object.entries(w.war.sites).map(([id, s]) => [id, s.owner]));
    const was = owners();
    const step = (w as unknown as { warTick(): void }).warTick.bind(w);
    for (let i = 0; i < 1440; i++) step();
    const now = owners();
    return { changed: Object.keys(now).filter((id) => now[id] !== was[id]).length, sleeping: w.population.filter((r) => !r.active && r.alive).every((r) => r.raidId !== undefined || w.ownerOf(r.siteId) === r.faction) };
  });
  expect(later.changed).toBeGreaterThan(0);
  // Sleeping garrisons were rebuilt to match: every pilot belongs to whoever holds its site.
  expect(later.sleeping).toBe(true);
  await page.keyboard.press("KeyM");
  await page.screenshot({ path: `${SHOTS}/28-war-map-two-hours-on.png` });
  expect(errors).toEqual([]);
});

test("faction war: standing changes who is hostile, and a base is taken and lost", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await waitTicks(page, 20);

  // The Wardens are neutral: their pilots ignore the player, and are not enemies.
  await goNear(page, "saltwatch", 0, -120);
  await page.waitForFunction(() => window.__game!.world.others.length === 3, undefined, { timeout: 60_000 });
  await waitTicks(page, 200);
  const neutral = await page.evaluate(() => {
    const w = window.__game!.world;
    return { attitude: w.attitude("wardens"), enemies: w.enemies.length, modes: w.others.map((m) => m.brain!.state.mode), atBase: w.atBase };
  });
  expect(neutral).toEqual({ attitude: "neutral", enemies: 0, modes: ["patrol", "patrol", "patrol"], atBase: false });
  await page.screenshot({ path: `${SHOTS}/29-neutral-wardens.png` });

  // Shooting them costs standing; destroying them makes the faction hostile and pleases its enemies.
  const shot = await page.evaluate(() => {
    const w = window.__game!.world;
    const before = { ...w.save.standing };
    w.combat.damage(w.others[0]!, "legs", 20, w.player);
    const nicked = w.save.standing.wardens;
    for (const m of w.others.slice(0, 2)) w.combat.damage(m, "torso", 100_000, w.player);
    return { before, nicked, after: { ...w.save.standing }, attitude: w.attitude("wardens") };
  });
  expect(shot.nicked).toBeLessThan(shot.before.wardens);
  expect(shot.nicked).toBeGreaterThan(-25);
  expect(shot.attitude).toBe("hostile");
  expect(shot.after.combine).toBeGreaterThan(shot.before.combine);
  expect(shot.after.syndicate).toBeGreaterThan(shot.before.syndicate);
  expect(shot.after.drifters).toBe(shot.before.drifters);
  await waitTicks(page, 5);
  // The survivor now fights the player.
  await page.waitForFunction(() => window.__game!.world.enemies.length === 1 && window.__game!.world.inCombat, undefined, { timeout: 60_000 });

  // Destroying the last guard takes the base: hangar and fast travel.
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.combat.damage(w.enemies[0]!, "torso", 100_000, w.player);
  });
  await waitTicks(page, 5);
  await goNear(page, "saltwatch", 0, 0);
  const held = await page.evaluate(() => {
    const w = window.__game!.world;
    return { owner: w.ownerOf("saltwatch"), held: w.save.held, atBase: w.atBase, cleared: w.save.cleared };
  });
  expect(held).toEqual({ owner: "player", held: ["saltwatch"], atBase: true, cleared: ["saltwatch"] });

  // The Wardens come to take it back. Standing in the base and destroying the raid holds it.
  await sendRaid(page, "wardens", "quarry-post", "saltwatch", 2);
  await page.waitForFunction(() => window.__game!.world.enemies.length === 2, undefined, { timeout: 100_000 });
  await page.screenshot({ path: `${SHOTS}/30-counterattack.png` });
  await page.evaluate(() => {
    const w = window.__game!.world;
    for (const m of w.enemies) w.combat.damage(m, "torso", 100_000, w.player);
  });
  await waitTicks(page, WAR_TICK + 20);
  const defended = await page.evaluate(() => {
    const w = window.__game!.world;
    return { owner: w.ownerOf("saltwatch"), raids: w.war.raids.length };
  });
  expect(defended).toEqual({ owner: "player", raids: 0 });

  // A second raid finds nobody home: the base falls, and stops being the player's.
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await page.evaluate(() => window.__game!.world.travelTo("drifters-rest"));
  await waitTicks(page, 20);
  await sendRaid(page, "wardens", "quarry-post", "saltwatch", 2);
  await page.waitForFunction(() => window.__game!.world.ownerOf("saltwatch") === "wardens", undefined, { timeout: 100_000 });
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  const lost = await page.evaluate(() => {
    const w = window.__game!.world;
    return { held: w.save.held, troops: w.war.sites["saltwatch"]!.troops, garrison: w.population.filter((r) => r.siteId === "saltwatch").map((r) => r.faction), travel: w.travelTo("saltwatch") };
  });
  expect(lost).toEqual({ held: [], troops: 2, garrison: ["wardens", "wardens"], travel: false });

  // All of it survives a reload.
  const saved = await page.evaluate(() => ({ standing: { ...window.__game!.world.save.standing }, tick: window.__game!.world.war.tick }));
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const reloaded = await page.evaluate(() => {
    const w = window.__game!.world;
    return { standing: { ...w.save.standing }, tick: w.war.tick, owner: w.ownerOf("saltwatch"), attitude: w.attitude("wardens") };
  });
  expect(reloaded).toEqual({ standing: saved.standing, tick: saved.tick, owner: "wardens", attitude: "hostile" });
  expect(errors).toEqual([]);
});
