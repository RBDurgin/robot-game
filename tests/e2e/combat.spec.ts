import { expect, test } from "@playwright/test";
import { approachOutpost, boot, playerState, SHOTS, startGame, waitTicks } from "./helpers";

test("player can shoot and destroy an enemy; enemies fight back", async ({ page }) => {
  const errors = await boot(page);
  await startGame(page);
  await waitTicks(page, 30);

  // Enemies far from the player are asleep: at the base, nobody else is in the scene.
  expect(await page.evaluate(() => window.__game!.world.mechs.length)).toBe(1);
  await approachOutpost(page);

  // Drop the player 70 m from the first picket mech and keep the crosshair on it.
  const setup = await page.evaluate(() => {
    const w = window.__game!.world;
    const enemy = w.mechs.find((m) => m.name.includes("skirmisher"))!;
    const px = enemy.feet.x - 50;
    const pz = enemy.feet.z - 50;
    w.player.teleport({ x: px, y: enemy.feet.y + 6, z: pz }, 0);
    const track = () => {
      const target = w.mechs.find((m) => m === enemy && m.alive) ?? w.enemies[0];
      if (!target) {
        w.intentOverride = null;
        return;
      }
      const cam = w.cameraRig.camera.position;
      const c = target.center;
      const dx = c.x - cam.x;
      const dy = c.y - cam.y;
      const dz = c.z - cam.z;
      w.intentOverride = {
        aimYaw: Math.atan2(dx, dz),
        aimPitch: Math.atan2(dy, Math.hypot(dx, dz)),
        firePrimary: true,
        fireSecondary: true,
      };
    };
    (window as unknown as { __track: number }).__track = window.setInterval(track, 16);
    return { enemies: w.enemies.length, name: enemy.name, frames: [...new Set(w.enemies.map((m) => m.frame.id))].sort() };
  });
  expect(setup.enemies).toBe(5);
  // The squads are mixed: scouts, line suits and a siege suit.
  expect(setup.frames).toEqual(["heavy", "light", "medium"]);

  await waitTicks(page, 90);
  await page.screenshot({ path: `${SHOTS}/05-firefight.png` });
  const mid = await page.evaluate(() => {
    const w = window.__game!.world;
    return { aimed: w.aimedMech?.name ?? null, heat: w.player.state.heat, modes: w.enemies.map((m) => m.brain!.state.mode) };
  });
  expect(mid.heat).toBeGreaterThan(0);
  // Being shot alerts the squad.
  expect(mid.modes.filter((m) => m !== "patrol").length).toBeGreaterThanOrEqual(2);

  // Keep fighting until at least one enemy is destroyed.
  await page.waitForFunction(() => window.__game!.world.kills >= 1, undefined, { timeout: 110_000 });
  await page.screenshot({ path: `${SHOTS}/06-after-kill.png` });
  const after = await page.evaluate(() => {
    const w = window.__game!.world;
    return { enemies: w.enemies.length, kills: w.kills, deaths: w.deaths, wrecks: w.wrecks.count };
  });
  expect(after.enemies).toBe(5 - after.kills);
  // Every destroyed mech leaves a wreck behind.
  expect(after.wrecks).toBe(after.kills + after.deaths);

  // The enemies shoot back: the player has taken damage (or been destroyed and respawned).
  const p = await playerState(page);
  const took = await page.evaluate(() => {
    const w = window.__game!.world;
    const t = w.player.health.sections;
    return Object.values(t).some((s) => s.armor < s.maxArmor);
  });
  expect(took || !p.alive).toBe(true);

  expect(errors).toEqual([]);
});
