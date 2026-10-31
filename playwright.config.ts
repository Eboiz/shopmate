import { defineConfig } from "@playwright/test";

// Set E2E_BASE_URL to test a preview deployment. Without it, a local dev server is started.
const baseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: baseURL ?? "http://localhost:3000",
    viewport: { width: 375, height: 812 },
    trace: "retain-on-failure",
  },
  webServer: baseURL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000/login",
        reuseExistingServer: true,
      },
});
