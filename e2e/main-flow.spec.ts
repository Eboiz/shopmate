import { expect, test } from "@playwright/test";

test("signed-out visitors of /admin go to the login page", async ({ page }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
});

test("the login page fits a 375 px screen", async ({ page }) => {
  await page.goto("/login");

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
});

// Needs the shop page (PB-04), ordering in chat (PB-11) and order confirmation (PB-12).
test.fixme("shopper orders in the chat and staff confirm it", async () => {
  // Open the shop page, ask a size question and get an answer, order in the chat,
  // sign in with the seeded demo staff account, confirm the order, check stock went down.
});
