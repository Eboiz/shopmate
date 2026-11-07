import { test } from "@playwright/test";

// Seed for the Playwright test agents (planner, generator, healer): they run this
// to get a page on the running app before exploring it. Kept trivial on purpose.
test("seed", async ({ page }) => {
  await page.goto("/login");
});
