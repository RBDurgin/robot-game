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
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ version: 5, cleared: ["kestrel-outpost"], missions: { done: ["first-outpost"], active: null } }));
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
  expect(await page.evaluate(() => window.__game!.world.save.missions)).toEqual({ done: ["first-outpost", "listening-post", "the-needle"], active: null, patron: null, contract: null });

  expect(errors).toEqual([]);
});

test("campaign: choosing a patron, then a salvage run against the clock", async ({ page }) => {
  test.setTimeout(300_000);
  // A pilot who has held the Needle, and made enemies of the Syndicate doing it.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      const missions = { done: ["first-outpost", "listening-post", "the-needle"], active: null, patron: null };
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ version: 5, cleared: ["kestrel-outpost"], missions, standing: { drifters: 55, wardens: 20, combine: -80, syndicate: -70 } }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await waitTicks(page, 5);

  // No mission is on offer until a patron is chosen; all three ask, the Syndicate's broker included.
  expect(await page.evaluate(() => ({ offered: window.__game!.world.offered, offers: window.__game!.world.offers?.map((p) => p.faction) }))).toEqual({ offered: null, offers: ["drifters", "wardens", "syndicate"] });
  await accept(page, "The offers");
  await page.screenshot({ path: `${SHOTS}/25-offers.png` });
  await page.getByRole("button", { name: "Decide later" }).click();
  expect(await page.evaluate(() => window.__game!.world.save.missions.patron)).toBeNull();
  await accept(page, "The offers");
  await page.getByRole("button", { name: "Fly for Sorrel" }).click();
  await waitTicks(page, 3);
  expect(await page.evaluate(() => ({ ...window.__game!.world.save.standing, patron: window.__game!.world.save.missions.patron, offers: window.__game!.world.offers, offered: window.__game!.world.offered?.id }))).toEqual({
    drifters: 45,
    wardens: 45,
    combine: -80,
    syndicate: -80,
    patron: "wardens",
    offers: null,
    offered: "dead-reckoning",
  });

  // The patron briefs the next mission.
  await accept(page, "Dead Reckoning");
  await expect(page.getByText("salvage mission · Captain Brenna Sorrel, Captain, Greywall Wardens")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await waitTicks(page, 3);
  expect(await stage(page)).toBe("travel");

  // Salvage run: search two parts of the wreck, then find the key in the third.
  await goTo(page, -1500, 1000);
  expect(await stage(page)).toBe("hull-1");
  await goTo(page, -1585, 1300);
  expect(await stage(page)).toBe("hull-2");
  await goTo(page, -1420, 1345);
  expect(await stage(page)).toBe("key");
  await goTo(page, -1455, 1125);
  await waitTicks(page, 20);
  await page.screenshot({ path: `${SHOTS}/26-command-key.png` });
  expect(await stage(page)).toBe("key");
  await goTo(page, -1455, 1165);
  expect(await stage(page)).toBe("escape");

  // The ring closes: staying too long fails the mission, and the key is gone with it.
  await page.evaluate(() => (window.__game!.world.mission!.state.time = 149));
  await page.waitForFunction(() => window.__game!.world.mission === null, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => ({ offered: window.__game!.world.offered?.id, crates: window.__game!.world.salvage.count }))).toEqual({ offered: "dead-reckoning", crates: 0 });

  // Second try, straight to the stern: the key is there again, and this time Magpie gets out.
  await accept(page, "Dead Reckoning");
  await page.getByRole("button", { name: "Accept" }).click();
  for (const [x, z] of [[-1500, 1000], [-1585, 1300], [-1420, 1345], [-1455, 1165]] as const) await goTo(page, x, z);
  expect(await stage(page)).toBe("escape");
  const before = await page.evaluate(() => ({ scrap: window.__game!.world.save.scrap, wardens: window.__game!.world.save.standing.wardens }));
  await page.evaluate(() => window.__game!.world.player.teleport({ x: -1500, y: window.__game!.world.heightAt(-1500, 700) + 2, z: 700 }, 0));
  await expect(page.getByRole("heading", { name: "Key recovered" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("350 scrap, +8 standing with the Wardens")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/27-salvage-debrief.png` });
  await page.getByRole("button", { name: "Continue" }).click();
  const after = await page.evaluate(() => ({ scrap: window.__game!.world.save.scrap, wardens: window.__game!.world.save.standing.wardens, done: window.__game!.world.save.missions.done.at(-1) }));
  expect(after).toEqual({ scrap: before.scrap + 350, wardens: before.wardens + 8, done: "dead-reckoning" });

  expect(errors).toEqual([]);
});

test("campaign: an escort that walks when the player is near, waits when not, and is lost if destroyed", async ({ page }) => {
  test.setTimeout(400_000);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      const missions = { done: ["first-outpost", "listening-post", "the-needle", "dead-reckoning"], active: null, patron: "drifters" };
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ version: 5, cleared: ["kestrel-outpost"], missions }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await waitTicks(page, 5);

  /** Where the suit under escort is, and whether it is in the scene. */
  const engineer = () =>
    page.evaluate(() => {
      const w = window.__game!.world;
      const r = w.population.find((x) => x.mission?.tag === "engineer" && x.alive);
      const mech = w.others.find((m) => m.brain?.passive);
      return r ? { x: mech?.feet.x ?? r.x, awake: r.active, count: w.population.filter((x) => x.mission?.tag === "engineer" && x.alive).length } : null;
    });
  /** Move the suit under escort, as the walk would in time. */
  const moveEngineer = (x: number, z: number) =>
    page.evaluate(([px, pz]) => {
      const w = window.__game!.world;
      const mech = w.others.find((m) => m.brain?.passive)!;
      mech.teleport({ x: px!, y: w.heightAt(px!, pz!) + 2, z: pz! }, 0);
    }, [x, z]);

  await accept(page, "Long Walk");
  await expect(page.getByText("escort mission · Ojo Brandt, Quartermaster, Drifter Compact")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await waitTicks(page, 3);
  expect(await stage(page)).toBe("meet");

  // The engineer is waiting at the Span, and sets off east once the player is there.
  await goTo(page, -1395, 1245);
  expect(await stage(page)).toBe("leg-1");
  await page.waitForFunction(() => window.__game!.world.others.some((m) => m.brain?.passive), undefined, { timeout: 60_000 });
  const start = (await engineer())!;
  expect(start.count).toBe(1);
  await waitTicks(page, 150);
  const walked = (await engineer())!;
  expect(walked.x).toBeGreaterThan(start.x + 5);
  await page.screenshot({ path: `${SHOTS}/28-escort.png` });
  // It is an ally, not a wingman, and Combine suits are its enemies.
  expect(await page.evaluate(() => {
    const w = window.__game!.world;
    const mech = w.others.find((m) => m.brain?.passive)!;
    return { attitude: w.attitudeOfMech(mech), enemy: w.enemies.includes(mech) };
  })).toEqual({ attitude: "allied", enemy: false });

  // Left behind, it stops and waits.
  await goTo(page, walked.x + 200, 1215);
  await waitTicks(page, 30);
  const waiting = (await engineer())!;
  await waitTicks(page, 90);
  expect(Math.abs((await engineer())!.x - waiting.x)).toBeLessThan(2);

  // Each picket it reaches is a checkpoint: a reload starts the leg again with the engineer there.
  await goTo(page, -640, 1215);
  await page.waitForFunction(() => window.__game!.world.enemies.length === 3, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    const w = window.__game!.world;
    for (const enemy of [...w.enemies]) w.combat.damage(enemy, "torso", 100_000, w.player);
  });
  await page.waitForFunction(() => !window.__game!.world.others.some((m) => m.brain?.passive), undefined, { timeout: 60_000 });
  await goTo(page, waiting.x + 20, 1215);
  await page.waitForFunction(() => window.__game!.world.others.some((m) => m.brain?.passive), undefined, { timeout: 60_000 });
  await moveEngineer(-620, 1220);
  await goTo(page, -640, 1215);
  await page.waitForFunction(() => window.__game!.world.mission?.state.stage === "leg-2", undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__game!.world.pause());
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  expect(await stage(page)).toBe("leg-2");
  await page.waitForFunction(() => window.__game!.world.others.some((m) => m.brain?.passive), undefined, { timeout: 60_000 });
  const resumed = (await engineer())!;
  expect(resumed.count).toBe(1);
  expect(Math.abs(resumed.x - -600)).toBeLessThan(40);

  // If the engineer is destroyed the mission fails, and can be taken again.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const mech = w.others.find((m) => m.brain?.passive)!;
    w.combat.damage(mech, "torso", 100_000, w.enemies[0] ?? mech);
  });
  await page.waitForFunction(() => window.__game!.world.mission === null, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__game!.world.offered?.id)).toBe("long-walk");

  // Second try: walked through to the hull, where the patron's pilots are fighting the Combine.
  await accept(page, "Long Walk");
  await page.getByRole("button", { name: "Accept" }).click();
  await goTo(page, -1440, 1215);
  for (const [x, next] of [[-600, "leg-2"], [350, "leg-3"]] as const) {
    await page.waitForFunction(() => window.__game!.world.others.some((m) => m.brain?.passive), undefined, { timeout: 60_000 });
    await moveEngineer(x - 20, 1220);
    await goTo(page, x - 40, 1215);
    await page.waitForFunction((s) => window.__game!.world.mission?.state.stage === s, next, { timeout: 60_000 });
  }
  await page.waitForFunction(() => window.__game!.world.others.some((m) => m.brain?.passive), undefined, { timeout: 60_000 });
  await moveEngineer(1240, 1150);
  // Arriving ends the mission, and the summary stops the clock.
  await page.evaluate(() => window.__game!.world.player.teleport({ x: 1215, y: window.__game!.world.heightAt(1215, 1150) + 2, z: 1150 }, 0));
  await expect(page.getByRole("heading", { name: "The long walk" })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/29-escort-debrief.png` });
  await page.getByRole("button", { name: "Continue" }).click();
  expect(await page.evaluate(() => window.__game!.world.save.missions.done.at(-1))).toBe("long-walk");

  expect(errors).toEqual([]);
});

test("campaign: the duel with Kestrel One, and the ending the patron chose", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      const missions = { done: ["first-outpost", "listening-post", "the-needle", "dead-reckoning", "long-walk"], active: null, patron: "syndicate" };
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ version: 5, cleared: ["kestrel-outpost"], missions, standing: { drifters: 35, wardens: 0, combine: -80, syndicate: 50 } }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await waitTicks(page, 5);

  await accept(page, "Kestrel One");
  await expect(page.getByText("duel mission · Lys, Broker, Emberline Syndicate")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await goTo(page, 1350, 1060);
  expect(await stage(page)).toBe("parley");
  // Varga speaks first, and is not there to be shot until she has.
  expect(await page.evaluate(() => window.__game!.world.population.filter((r) => r.mission).length)).toBe(0);
  await waitTicks(page, 40);
  await page.screenshot({ path: `${SHOTS}/30-parley.png` });
  await page.evaluate(() => (window.__game!.world.mission!.state.time = 19.5));
  await page.waitForFunction(() => window.__game!.world.mission?.state.stage === "duel", undefined, { timeout: 60_000 });

  // She comes alone, in her own build, and is much harder to put down than a line pilot.
  await page.waitForFunction(() => window.__game!.world.enemies.some((m) => m.name === "Kestrel One"), undefined, { timeout: 60_000 });
  const varga = await page.evaluate(() => {
    const w = window.__game!.world;
    const mech = w.enemies.find((m) => m.name === "Kestrel One")!;
    const armor = (m: typeof mech) => m.health.sections.torso.armor + m.health.sections.torso.structure;
    return { frame: mech.frame.id, weapons: mech.loadout.weapons, alone: w.population.filter((r) => r.mission && r.alive).length, armor: armor(mech), player: armor(w.player) };
  });
  expect(varga).toMatchObject({ frame: "medium", weapons: { armL: "lanceBeam", armR: "slugCannon" }, alone: 1 });
  expect(varga.armor).toBeGreaterThan(varga.player);
  await waitTicks(page, 60);
  await page.screenshot({ path: `${SHOTS}/31-duel.png` });

  const before = await page.evaluate(() => ({ scrap: window.__game!.world.save.scrap, parts: window.__game!.world.save.inventory.length }));
  await page.evaluate(() => {
    const w = window.__game!.world;
    w.combat.damage(w.enemies.find((m) => m.name === "Kestrel One")!, "torso", 100_000, w.player);
  });
  await expect(page.getByRole("heading", { name: "The Carrier opens" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Hale did not speak to you on the walk home.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/32-ending.png` });
  await page.getByRole("button", { name: "Continue" }).click();
  const after = await page.evaluate(() => {
    const w = window.__game!.world;
    return { scrap: w.save.scrap, parts: w.save.inventory.length, gift: w.save.inventory.some((i) => i.id === "scatterGun" && i.tier === 3), done: w.save.missions.done.length, offered: w.offered, offers: w.offers };
  });
  // Lys pays more scrap than the others; the campaign is over and the world carries on.
  expect(after).toEqual({ scrap: before.scrap + 960, parts: before.parts + 1, gift: true, done: 6, offered: null, offers: null });

  expect(errors).toEqual([]);
});

test("contracts: work from the war's state, taken from the board at a base; and the mission log", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ version: 5, cleared: ["kestrel-outpost"], missions: { done: ["first-outpost"], active: null } }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const errors = await boot(page);
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  await waitTicks(page, 5);

  // The board: only the Drifters and the Wardens will deal with a new pilot.
  const board = await page.evaluate(() => window.__game!.world.contracts);
  expect(board.length).toBeGreaterThan(0);
  for (const spec of board) expect(["drifters", "wardens"]).toContain(spec.giver);
  await page.keyboard.press("KeyC");
  await expect(page.getByRole("heading", { name: "Contracts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(board.length);
  await page.screenshot({ path: `${SHOTS}/33-contracts.png` });

  // Take the first. It is a mission like any other, and the campaign's own stays on offer behind it.
  await page.getByRole("button", { name: "Accept" }).first().click();
  await waitTicks(page, 3);
  const taken = await page.evaluate(() => ({ id: window.__game!.world.mission?.def.id, spec: window.__game!.world.save.missions.contract }));
  expect(taken).toMatchObject({ id: `contract:${board[0]!.kind}:${board[0]!.site}`, spec: board[0] });
  // With a mission in hand the board still opens, but says why nothing can be taken.
  await page.keyboard.press("KeyC");
  await expect(page.getByText("Finish it, or fail it, before taking a contract.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Close" }).click();
  // Away from a base it does not open at all, and says so.
  await page.evaluate(() => window.__game!.world.player.teleport({ x: 0, y: window.__game!.world.heightAt(0, -900) + 2, z: -900 }, 0));
  await waitTicks(page, 4);
  await page.keyboard.press("KeyC");
  await expect(page.getByRole("heading", { name: "Contracts", exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.__game!.world.mode)).toBe("playing");

  // The log says what is in hand and what has been done.
  await page.keyboard.press("KeyL");
  await expect(page.getByRole("heading", { name: "Mission log" })).toBeVisible();
  await expect(page.getByText("1. Clear Signal (assault)")).toBeVisible();
  await expect(page.getByText("The Signal · 1 of 6")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/34-log.png` });
  await page.getByRole("button", { name: "Close" }).click();

  // A contract in progress survives a reload.
  await page.evaluate(() => window.__game!.world.pause());
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await startGame(page);
  await page.evaluate(() => (window.__game!.world.warPaused = true));
  expect(await page.evaluate(() => window.__game!.world.mission?.def.id)).toBe(taken.id);

  // Do the work: go to the site and destroy whoever the contract is against, until it pays.
  const before = await page.evaluate(() => ({ scrap: window.__game!.world.save.scrap, standing: { ...window.__game!.world.save.standing }, done: window.__game!.world.save.missions.done.length }));
  const pays = await page.evaluate(() => window.__game!.world.mission!.def.reward);
  await page.evaluate(() => {
    const w = window.__game!.world;
    const site = w.model.siteById.get(w.save.missions.contract!.site)!;
    w.player.teleport({ x: site.x - 30, y: w.heightAt(site.x - 30, site.z - 70) + 2, z: site.z - 70 }, 0);
  });
  await page.waitForFunction(
    () => {
      const w = window.__game!.world;
      if (w.mode === "complete") return true;
      const enemy = w.save.missions.contract?.enemy;
      for (const m of w.enemies) if (m.faction === enemy) w.combat.damage(m, "torso", 100_000, w.player);
      return false;
    },
    undefined,
    { timeout: 200_000, polling: 500 },
  );
  await expect(page.getByRole("heading", { name: "Contract complete" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/35-contract-paid.png` });
  await page.getByRole("button", { name: "Continue" }).click();
  const after = await page.evaluate(() => ({ scrap: window.__game!.world.save.scrap, standing: window.__game!.world.save.standing, missions: window.__game!.world.save.missions, offered: window.__game!.world.offered?.id }));
  // Paid in scrap (salvage aside) and in standing with the giver; it does not count toward the campaign.
  expect(after.scrap).toBeGreaterThanOrEqual(before.scrap + pays.scrap);
  expect(after.standing[board[0]!.giver]).toBeGreaterThan(before.standing[board[0]!.giver]);
  expect(after.missions).toMatchObject({ done: ["first-outpost"], active: null, contract: null });
  expect(after.offered).toBe("listening-post");

  expect(errors).toEqual([]);
});
