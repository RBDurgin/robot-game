import { expect, test, type Page } from "@playwright/test";
import { boot, SHOTS } from "./helpers";

const ready = (page: Page) => page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
/** Choose a file in the hidden import field, as the file picker would. */
const importFile = (page: Page, name: string, text: string) =>
  page.getByLabel("Save file to import").evaluate(
    (input, file) => {
      const data = new DataTransfer();
      data.items.add(new File([file.text], file.name, { type: "application/json" }));
      (input as HTMLInputElement).files = data.files;
      input.dispatchEvent(new Event("change"));
    },
    { name, text },
  );
const scrap = (page: Page) => page.evaluate(() => window.__game!.world.save.scrap);

test("saves: an old save moves into slot 1; slots, export, import and reset work", async ({ page }) => {
  // A save as the first version of the game wrote it, where every version before slots kept it.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("robot-game-save-v1", JSON.stringify({ loadout: { armL: "arcLauncher", armR: "pulseRifle", plating: "standardPlating" }, inventory: { pulseRifle: 1, arcLauncher: 1, standardPlating: 1 }, scrap: 400 }));
    }
  });
  const errors = await boot(page);
  expect(await scrap(page)).toBe(400);
  await expect(page.getByText(/^Slot 1 \(in use\): Warden frame · 400 scrap · 3 parts/)).toBeVisible();
  await expect(page.getByText("Slot 2: Empty")).toBeVisible();
  await page.getByRole("heading", { name: "Saved games" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/24-save-slots.png` });
  // It lives in IndexedDB now, and the old copy is gone.
  const stored = await page.evaluate(async () => ({ legacy: localStorage.getItem("robot-game-save-v1"), databases: (await indexedDB.databases()).map((d) => d.name) }));
  expect(stored).toEqual({ legacy: null, databases: ["robot-game"] });

  // Export the game in progress.
  await page.evaluate(() => {
    // Keep what is handed to the browser for download, so the test can read it.
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      void blob.text().then((text) => ((window as unknown as { exported: string }).exported = text));
      return make(blob);
    };
  });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export save" }).click()]);
  expect(download.suggestedFilename()).toBe("robot-game-slot-1.json");
  await page.waitForFunction(() => "exported" in window);
  const file = await page.evaluate(() => (window as unknown as { exported: string }).exported);
  expect(JSON.parse(file)).toMatchObject({ version: 4, scrap: 400 });

  // A new game in slot 2 starts from nothing.
  await page.getByRole("button", { name: "New game in slot 2" }).click();
  await page.waitForFunction(() => window.__game?.ready === true && window.__game.world.save.scrap === 0, undefined, { timeout: 60_000 });
  await expect(page.getByText("Slot 2 (in use): Empty")).toBeVisible();

  // A file that is not a save is refused and nothing changes.
  await importFile(page, "notes.json", '{"hello": 1}');
  await expect(page.getByText("That file is not a save from this game.")).toBeVisible();
  expect(await scrap(page)).toBe(0);

  // Importing the exported file puts that game in slot 2 as well.
  await importFile(page, "robot-game-slot-1.json", file);
  await page.waitForFunction(() => window.__game?.ready === true && window.__game.world.save.scrap === 400, undefined, { timeout: 60_000 });
  await expect(page.getByText(/^Slot 2 \(in use\): Warden frame · 400 scrap/)).toBeVisible();

  // Resetting empties only the slot in use.
  await page.getByRole("button", { name: "Reset this slot" }).click();
  await page.waitForFunction(() => window.__game?.ready === true && window.__game.world.save.scrap === 0, undefined, { timeout: 60_000 });
  await expect(page.getByText("Slot 2 (in use): Empty")).toBeVisible();
  await page.getByRole("button", { name: "Load slot 1" }).click();
  await page.waitForFunction(() => window.__game?.ready === true && window.__game.world.save.scrap === 400, undefined, { timeout: 60_000 });
  await ready(page);
  expect(errors).toEqual([]);
});
