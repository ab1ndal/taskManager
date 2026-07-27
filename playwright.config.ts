import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end harness for the real, authenticated app.
 *
 * Everything before Phase 6.5 was verified either in jsdom (no layout, no real browser) or against
 * a fixture preview route (no auth, no database). Neither exercises the pages a signed-in user
 * actually sees, which is where the last round of visual defects lived. These specs sign in through
 * the real login form against a seeded throwaway workspace and drive the app.
 *
 * `globalSetup` seeds that data with the service-role key and `globalTeardown` removes it, so a run
 * leaves the project exactly as it found it.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
    },
    {
      name: "webkit",
      dependencies: ["setup"],
      use: { ...devices["Desktop Safari"], storageState: "e2e/.auth/user.json" },
    },
    {
      name: "firefox",
      dependencies: ["setup"],
      use: { ...devices["Desktop Firefox"], storageState: "e2e/.auth/user.json" },
    },
    {
      // Mobile Safari on a notched device: the deliverable ships as an iPhone app, so the phone
      // layout is a first-class target rather than a narrow-viewport afterthought.
      name: "iphone",
      dependencies: ["setup"],
      use: { ...devices["iPhone 14 Pro"], storageState: "e2e/.auth/user.json" },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
