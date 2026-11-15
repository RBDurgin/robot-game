import { defineConfig } from "vitest/config";
import { perfRecorder } from "./scripts/perf-recorder.mjs";

export default defineConfig({
  plugins: [perfRecorder()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173 },
  build: { target: "es2022", chunkSizeWarningLimit: 8000 },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
