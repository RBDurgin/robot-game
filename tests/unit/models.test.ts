import { describe, expect, it } from "vitest";
import { MODELS, WEAPON_MODELS } from "../../src/data/models";
import attribution from "../../public/models/ATTRIBUTION.md?raw";

/** Every model file in the folder, by name, read as text (enough to check the header). */
const files = Object.fromEntries(
  Object.entries(import.meta.glob("../../public/models/*.glb", { query: "?raw", import: "default", eager: true })).map(
    ([path, text]) => [path.split("/").pop()!, text as string],
  ),
);

/** File names in the first column of the attribution table. */
const credited = new Set(
  attribution
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]!.trim())
    .filter((cell) => cell && cell !== "File" && !cell.startsWith("---")),
);

describe("model manifest", () => {
  const entries = Object.entries(MODELS)
    .flatMap(([frame, parts]) => Object.entries(parts ?? {}).map(([slot, entry]) => ({ frame, slot, entry })))
    .concat(Object.entries(WEAPON_MODELS).map(([shape, entry]) => ({ frame: "weapon", slot: shape, entry })));

  it.each(entries)("$frame $slot: file exists, is a glTF binary and is credited", ({ entry }) => {
    expect(files[entry.file]?.slice(0, 4)).toBe("glTF");
    expect(credited.has(entry.file)).toBe(true);
  });

  it("every model file in the folder is credited", () => {
    expect(Object.keys(files).filter((f) => !credited.has(f))).toEqual([]);
  });
});
