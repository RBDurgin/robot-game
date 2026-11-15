import { defineConfig } from "@playwright/test";

// The dev container has no GPU, so Chromium renders WebGL in software (SwiftShader).
// That is slow: fine for correctness checks and screenshots, not for judging performance.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 960, height: 540 },
    launchOptions: {
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
