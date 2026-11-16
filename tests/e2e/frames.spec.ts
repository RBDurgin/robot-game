import { expect, test } from "@playwright/test";
import { approachOutpost, boot, fitPart, SHOTS, startGame, waitTicks } from "./helpers";

test("frames: three silhouettes, switch frame in the hangar, abilities and shoulder weapons work", async ({ page }) => {
  // ?arsenal stocks the hangar with every weapon.
  const errors = await boot(page, "/?arsenal");
  await startGame(page);
  await waitTicks(page, 60);

  // Enemies are only in the scene near the player: visit the outpost to wake its garrison,
  // then bring one of each frame back to the base with their pilots switched off.
  const spawn = await page.evaluate(() => {
    const p = window.__game!.world.player;
    return { x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.state.torsoYaw };
  });
  await approachOutpost(page);
  const lineup = await page.evaluate((spawn) => {
    const w = window.__game!.world;
    w.player.teleport({ x: spawn.x, y: spawn.y + 0.2, z: spawn.z }, spawn.yaw);
    w.intentOverride = { aimYaw: spawn.yaw };
    const p = w.player.feet;
    const yaw = spawn.yaw;
    const picked = ["light", "medium", "heavy"].map((id) => w.enemies.find((m) => m.frame.id === id)!);
    picked.forEach((mech, i) => {
      mech.brain = null;
      const side = (i - 1) * 7;
      const x = p.x + Math.sin(yaw) * 16 + Math.cos(yaw) * side + Math.cos(yaw) * 2.2;
      const z = p.z + Math.cos(yaw) * 16 - Math.sin(yaw) * side - Math.sin(yaw) * 2.2;
      mech.teleport({ x, y: p.y, z }, yaw + Math.PI);
    });
    w.intentOverride = { aimYaw: spawn.yaw, aimPitch: -0.12 };
    return picked.map((m) => ({ frame: m.frame.id, height: m.frame.height, shoulders: m.mounted.filter((x) => x.hardpoint.mount === "shoulder").length }));
  }, spawn);
  expect(lineup.map((m) => m.frame)).toEqual(["light", "medium", "heavy"]);
  expect(lineup[2]!.shoulders).toBe(2);
  await waitTicks(page, 10);
  // The two left behind at the outpost are asleep again; the three brought along stay awake.
  expect(await page.evaluate(() => window.__game!.world.enemies.length)).toBe(3);
  await page.screenshot({ path: `${SHOTS}/11-three-frames.png` });

  // Hangar: the medium frame has two arm mounts and no shoulders.
  await page.evaluate(() => (window.__game!.world.intentOverride = null));
  await page.keyboard.press("KeyH");
  await expect(page.getByRole("heading", { name: "Hangar · Warden frame" })).toBeVisible();
  await expect(page.getByLabel("Right shoulder")).toHaveCount(0);

  // Choose the heavy frame: shoulder mounts appear, and they only offer weapons that fit them.
  await page.getByLabel("Frame").selectOption("heavy");
  await expect(page.getByRole("heading", { name: "Hangar · Bastion frame" })).toBeVisible();
  const shoulderOptions = await page.getByLabel("Right shoulder").locator("option").allTextContents();
  expect(shoulderOptions.some((o) => o.includes("Seeker Rack"))).toBe(true);
  expect(shoulderOptions.some((o) => o.includes("Pulse Rifle"))).toBe(false);
  await fitPart(page, "Right shoulder", "seekerRack");
  await fitPart(page, "Left shoulder", "seekerRack");
  await fitPart(page, "Right arm", "lanceBeam");
  await fitPart(page, "Left arm", "scatterGun");
  // Bulwark plating on top of all that is half a tonne too much, even for this frame.
  await fitPart(page, "Plating", "heavyPlating");
  await expect(page.getByText(/Over capacity by 0.5 t/)).toBeVisible();
  await fitPart(page, "Plating", "standardPlating");
  await expect(page.getByRole("button", { name: "Repair and deploy" })).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/12-hangar-heavy.png` });
  await page.getByRole("button", { name: "Repair and deploy" }).click();
  await waitTicks(page, 90);

  const heavy = await page.evaluate(() => {
    const w = window.__game!.world;
    const p = w.player;
    return {
      mode: w.mode,
      frame: p.frame.id,
      weapons: Object.fromEntries(Object.entries(p.weapons).map(([k, v]) => [k, v?.def.id ?? null])),
      grounded: p.state.grounded,
      braced: p.state.braced,
      inMechs: w.mechs.includes(p),
    };
  });
  expect(heavy).toEqual({
    mode: "playing",
    frame: "heavy",
    weapons: { armR: "lanceBeam", armL: "scatterGun", shoulderR: "seekerRack", shoulderL: "seekerRack" },
    grounded: true,
    braced: true, // it has been standing still since it deployed
    inMechs: true,
  });

  // Hold the crosshair on the parked heavy enemy: the seekers lock, then every weapon fires.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const enemy = w.enemies.find((m) => m.frame.id === "heavy" && !m.brain)!;
    (window as unknown as { __enemy: unknown }).__enemy = enemy;
    const track = (fire: boolean) => () => {
      const cam = w.cameraRig.camera.position;
      const c = enemy.center;
      const dx = c.x - cam.x;
      const dy = c.y - cam.y;
      const dz = c.z - cam.z;
      w.intentOverride = { aimYaw: Math.atan2(dx, dz), aimPitch: Math.atan2(dy, Math.hypot(dx, dz)), firePrimary: fire, fireSecondary: fire, fireTertiary: fire };
    };
    (window as unknown as { __aim: number }).__aim = window.setInterval(track(false), 16);
    (window as unknown as { __track: typeof track }).__track = track;
  });
  await page.waitForFunction(() => {
    const w = window.__game!.world;
    return w.combat.lockedTarget(w.player) !== null;
  }, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    const g = window as unknown as { __aim: number; __track: (fire: boolean) => () => void };
    window.clearInterval(g.__aim);
    g.__aim = window.setInterval(g.__track(true), 16);
  });
  await waitTicks(page, 50);
  await page.screenshot({ path: `${SHOTS}/13-heavy-firing.png` });
  await waitTicks(page, 70);
  const fired = await page.evaluate(() => {
    const g = window as unknown as { __aim: number; __enemy: { alive: boolean; health: { sections: Record<string, { armor: number; maxArmor: number }> } } };
    window.clearInterval(g.__aim);
    const w = window.__game!.world;
    w.intentOverride = null;
    const hurt = !g.__enemy.alive || Object.values(g.__enemy.health.sections).some((s) => s.armor < s.maxArmor);
    return { hurt, heat: w.player.state.heat, braced: w.player.state.braced };
  });
  expect(fired.hurt).toBe(true);
  expect(fired.heat).toBeGreaterThan(20);
  expect(fired.braced).toBe(true); // firing does not break the stance

  // Back to the hangar for the light frame: the shoulder weapons come off with the mounts.
  await page.evaluate(() => {
    const w = window.__game!.world;
    const b = w.homeBase;
    w.player.teleport({ x: b.x, y: w.player.feet.y + 1, z: b.z }, 0);
  });
  await waitTicks(page, 30);
  await page.keyboard.press("KeyH");
  await page.getByLabel("Frame").selectOption("light");
  await expect(page.getByRole("heading", { name: "Hangar · Kite frame" })).toBeVisible();
  await expect(page.getByLabel("Right shoulder")).toHaveCount(0);
  // The heavy build is too much for a scout.
  await expect(page.getByText(/Over capacity/)).toBeVisible();
  await fitPart(page, "Plating", "lightPlating");
  await fitPart(page, "Left arm", "");
  await expect(page.getByRole("button", { name: "Repair and deploy" })).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/14-hangar-light.png` });
  await page.getByRole("button", { name: "Repair and deploy" }).click();
  await waitTicks(page, 60);

  // Two dashes back to back, which the other frames cannot do.
  const before = await page.evaluate(() => {
    const p = window.__game!.world.player;
    return { frame: p.frame.id, charges: p.state.boostCharges, x: p.feet.x, z: p.feet.z };
  });
  expect(before).toMatchObject({ frame: "light", charges: 2 });
  await page.evaluate(() => (window.__game!.world.intentOverride = { moveZ: 1, boost: true }));
  await page.waitForFunction(() => window.__game!.world.player.state.boostCharges === 0, undefined, { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/15-light-dash.png` });
  await page.evaluate(() => (window.__game!.world.intentOverride = null));

  // The frame and its loadout survive a reload.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const reloaded = await page.evaluate(() => {
    const p = window.__game!.world.player;
    return { frame: p.frame.id, armR: p.weapons.armR?.def.id ?? null, armL: p.weapons.armL?.def.id ?? null, shoulderR: p.weapons.shoulderR?.def.id ?? null };
  });
  expect(reloaded).toEqual({ frame: "light", armR: "lanceBeam", armL: null, shoulderR: null });

  expect(errors).toEqual([]);
});

test("a save from before phase 2 still loads", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("robot-game-save-v1")) {
      localStorage.setItem(
        "robot-game-save-v1",
        JSON.stringify({
          loadout: { armL: "pulseRifle", armR: "slugCannon", plating: "lightPlating" },
          inventory: { slugCannon: 1, pulseRifle: 1, arcLauncher: 1, lightPlating: 1, standardPlating: 1 },
          scrap: 41,
          settings: { sensitivity: 0.0022, volume: 0.6, defaultView: "third" },
        }),
      );
    }
  });
  const errors = await boot(page);
  const loaded = await page.evaluate(() => {
    const w = window.__game!.world;
    return { frame: w.player.frame.id, armR: w.player.weapons.armR?.def.id, armL: w.player.weapons.armL?.def.id, plating: w.player.loadout.plating, scrap: w.save.scrap };
  });
  expect(loaded).toEqual({ frame: "medium", armR: "slugCannon", armL: "pulseRifle", plating: "lightPlating", scrap: 41 });
  expect(errors).toEqual([]);
});
