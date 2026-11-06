import { defineConfig } from "@playwright/test";

// Set E2E_BASE_URL to test a deployment (only @smoke tests are meant for that:
// they are read-only). Without it, the app is started locally: `pnpm start` in CI
// (after `pnpm build`), `pnpm dev` on a laptop. See e2e/README.md.
const baseURL = process.env.E2E_BASE_URL;
const port = process.env.E2E_PORT ?? "3000";

export default defineConfig({
  testDir: "./e2e",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: baseURL ?? `http://localhost:${port}`,
    viewport: { width: 375, height: 812 },
    trace: "retain-on-failure",
  },
  webServer: baseURL
    ? undefined
    : {
        command: `${process.env.CI ? "pnpm start" : "pnpm dev"} -p ${port}`,
        url: `http://localhost:${port}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
