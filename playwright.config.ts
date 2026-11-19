import { defineConfig } from "@playwright/test";

// The dev container has no GPU, so Chromium renders WebGL in software (SwiftShader).
// That is slow: fine for correctness checks and screenshots, not for judging performance.
//
// E2E_PROD=1 (npm run e2e:prod) runs the same tests against the production build served by
// `vite preview`, which is what players get: split chunks, relative paths, no dev server.
declare const process: { env: Record<string, string | undefined> }; // no @types/node here
const prod = !!process.env.E2E_PROD;
const baseURL = prod ? "http://localhost:4173" : "http://localhost:5173";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
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
    command: prod ? "npm run build && npx vite preview --port 4173 --strictPort" : "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
