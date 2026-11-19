import { defineConfig } from "vitest/config";
import { perfRecorder } from "./scripts/perf-recorder.mjs";
import pkg from "./package.json";

export default defineConfig({
  // Relative asset paths, so the build runs from any folder of any static host (GitHub Pages
  // serves a project from /<repo>/).
  base: "./",
  plugins: [perfRecorder()],
  // The version shown on the start screen.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173 },
  build: { target: "es2022", chunkSizeWarningLimit: 1600 },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
