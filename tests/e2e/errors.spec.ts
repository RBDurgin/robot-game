import { expect, test } from "@playwright/test";
import { boot, startGame } from "./helpers";

test("a browser without WebGL 2 is told so instead of getting a blank page", async ({ page }) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind === "webgl2" ? null : (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof real;
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "This browser cannot run the game" })).toBeVisible();
  await expect(page.getByText(/needs WebGL 2/)).toBeVisible();
});

test("an unreadable save is kept aside, and the player is told", async ({ page }) => {
  await boot(page);
  // Spoil slot 1 behind the game's back, then load it.
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("robot-game", 1);
        open.onsuccess = () => {
          const tx = open.result.transaction("saves", "readwrite");
          tx.objectStore("saves").put("{not a save", 1);
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
  );
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await expect(page.getByText("could not be read, so this is a new game")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the old save" }).click();
  expect((await download).suggestedFilename()).toBe("robot-game-slot-1-damaged.json");
});

test("a crash in play stops the game with a way out", async ({ page }) => {
  await boot(page);
  await startGame(page);
  await page.evaluate(() => {
    window.__game!.world.render = () => {
      throw new Error("test crash");
    };
  });
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download this save" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start this slot over" })).toBeVisible();
  await page.getByText("Technical details").click();
  await expect(page.getByText("test crash").first()).toBeVisible();
});
