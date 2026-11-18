import { expect, test, type Page } from "@playwright/test";
import { boot, playerState, SHOTS, waitTicks } from "./helpers";

/**
 * A pretend standard-mapping gamepad: the page reads `navigator.getGamepads()`, which returns
 * this pad, whose sticks and buttons the test sets through `window.__pad`.
 */
async function plugInPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = {
      id: "test pad",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = () => [pad as unknown as Gamepad];
  });
}

const setPad = (page: Page, change: { axes?: number[]; down?: number[]; up?: number[] }) =>
  page.evaluate((c) => {
    const pad = (window as unknown as { __pad: { axes: number[]; buttons: { pressed: boolean; value: number }[] } }).__pad;
    if (c.axes) pad.axes = c.axes;
    for (const i of c.down ?? []) pad.buttons[i] = { ...pad.buttons[i]!, pressed: true, value: 1 };
    for (const i of c.up ?? []) pad.buttons[i] = { ...pad.buttons[i]!, pressed: false, value: 0 };
  }, change);

/** Wait for a few rendered frames (the pad is read once a frame, menus included). */
const frames = (page: Page, n = 3) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let left = count;
        const next = (): void => {
          if (--left <= 0) done();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    n,
  );

/** Press and release a button, a few frames apart so the game sees both. */
async function tap(page: Page, button: number): Promise<void> {
  await setPad(page, { down: [button] });
  await frames(page);
  await setPad(page, { up: [button] });
  await frames(page);
}

test("a gamepad drives the mech and the menus", async ({ page }) => {
  await plugInPad(page);
  const errors = await boot(page);

  // On the start screen, Start takes the main choice: deploy.
  await tap(page, 9);
  await page.waitForFunction(() => window.__game!.world.mode === "playing", undefined, { timeout: 10_000 });
  await waitTicks(page, 30);
  const start = await playerState(page);
  const yaw0 = await page.evaluate(() => window.__game!.world.input.yaw);

  // Left stick forward walks. (Turning is per real second and the headless sim runs slower than
  // real time, so walking and turning are checked apart.)
  await setPad(page, { axes: [0, -1, 0, 0] });
  await waitTicks(page, 90);
  await setPad(page, { axes: [0, 0, 0, 0] });
  const walked = await playerState(page);
  expect(Math.hypot(walked.x - start.x, walked.z - start.z)).toBeGreaterThan(6);
  // Right stick turns.
  await setPad(page, { axes: [0, 0, 0.8, 0] });
  await frames(page, 5);
  await setPad(page, { axes: [0, 0, 0, 0] });
  expect(Math.abs((await page.evaluate(() => window.__game!.world.input.yaw)) - yaw0)).toBeGreaterThan(0.1);
  // No "click to capture the mouse" nag while a pad is in use.
  expect(await page.evaluate(() => window.__game!.world.input.needsPointer)).toBe(false);

  // Right trigger fires the right arm: heat rises.
  await setPad(page, { down: [7] });
  await waitTicks(page, 40);
  await setPad(page, { up: [7] });
  expect((await playerState(page)).heat).toBeGreaterThan(0);

  // A jumps.
  await setPad(page, { down: [0] });
  await waitTicks(page, 30);
  expect((await playerState(page)).grounded).toBe(false);
  await setPad(page, { up: [0] });

  // Y switches to the cockpit view.
  await tap(page, 3);
  expect(await page.evaluate(() => window.__game!.world.cameraRig.mode)).toBe("cockpit");
  await tap(page, 3);

  // Start pauses. In the menu the d-pad moves focus to a control and A uses it.
  await tap(page, 9);
  await page.waitForFunction(() => window.__game!.world.mode === "paused");
  await tap(page, 13);
  await tap(page, 13);
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(["BUTTON", "SELECT", "INPUT"]).toContain(focused);
  await page.screenshot({ path: `${SHOTS}/45-gamepad-menu.png` });

  // B goes back: resumes play.
  await tap(page, 1);
  await page.waitForFunction(() => window.__game!.world.mode === "playing");

  // Back opens the map, and B closes it again.
  await tap(page, 8);
  await page.waitForFunction(() => window.__game!.world.mode === "map");
  await tap(page, 1);
  await page.waitForFunction(() => window.__game!.world.mode === "playing");
  expect(errors).toEqual([]);
});
