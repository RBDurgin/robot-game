// Collect the licences of the third-party code the build ships into public/THIRD-PARTY-LICENSES.txt.
// Run by `npm run build`; the file is served next to the game and linked from its credits.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Packages whose code ends up in the built game. */
const SHIPPED = ["@babylonjs/core", "@babylonjs/gui", "@babylonjs/loaders", "@babylonjs/havok"];
const FILES = ["LICENSE", "LICENSE.md", "license.md", "LICENSE.txt", "NOTICE", "NOTICE.md"];

const parts = [
  "Third-party software in this game, and its licences.",
  "The game's own code, models and sounds are made in its repository and are not covered here.",
  "",
];
for (const name of SHIPPED) {
  const dir = join("node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  parts.push("=".repeat(78), `${name} ${pkg.version} (${pkg.license})`, pkg.homepage ?? "", "=".repeat(78), "");
  const found = FILES.filter((f) => existsSync(join(dir, f)));
  if (found.length === 0) throw new Error(`No licence file found for ${name}`);
  for (const f of found) parts.push(readFileSync(join(dir, f), "utf8").trim(), "");
}
writeFileSync(join("public", "THIRD-PARTY-LICENSES.txt"), parts.join("\n"));
console.log(`Wrote public/THIRD-PARTY-LICENSES.txt (${SHIPPED.length} packages)`);
