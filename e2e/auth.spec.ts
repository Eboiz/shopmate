import { expect, test } from "@playwright/test";
import { againstDeployment, demo } from "./support/env";

// PB-01: sign-in, sign-out and the /admin gate.

// /admin itself redirects to the first admin page.
const ADMIN_HOME = "/admin/inbox";

const adminPages = ["/admin", "/admin/inbox", "/admin/orders", "/admin/products", "/admin/reply-assistant"];

test.describe("signed out", () => {
  for (const path of adminPages) {
    test(`@smoke ${path} sends visitors to the login page and keeps where they were going`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
      await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
    });
  }

  test("@smoke a wrong password shows an error and stays on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@shopmate.test");
    await page.getByLabel("Mật khẩu").fill("wrong-password");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByText("Sai email hoặc mật khẩu.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("@smoke the login page fits a 375 px phone screen", async ({ page }) => {
    await page.goto("/login");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});

test.describe("demo accounts", () => {
  test.skip(againstDeployment || !demo.owner.email, "needs the seeded demo accounts of the local run");

  async function signIn(page: import("@playwright/test").Page, who: { email: string; password: string }, next = "") {
    await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    await page.getByLabel("Email").fill(who.email);
    await page.getByLabel("Mật khẩu").fill(who.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
  }

  test("the owner signs in, sees their email, signs out, and /admin is closed again", async ({ page }) => {
    await signIn(page, demo.owner);
    await expect(page).toHaveURL(ADMIN_HOME);
    await expect(page.getByText(demo.owner.email)).toBeVisible();

    await page.getByRole("button", { name: "Đăng xuất" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("staff sign in and land on the page they asked for", async ({ page }) => {
    await signIn(page, demo.staff, "/admin/orders");
    await expect(page).toHaveURL("/admin/orders");
  });

  test("a next pointing outside the site is ignored (no open redirect)", async ({ page }) => {
    await signIn(page, demo.staff, "https://evil.example/steal");
    await expect(page).toHaveURL(ADMIN_HOME);
  });

  test("a next pointing at a non-admin page is ignored", async ({ page }) => {
    await signIn(page, demo.staff, "/login");
    await expect(page).toHaveURL(ADMIN_HOME);
  });

  test("a correct email with the wrong password is refused", async ({ page }) => {
    await signIn(page, { email: demo.owner.email, password: `${demo.owner.password}x` });
    await expect(page.getByText("Sai email hoặc mật khẩu.")).toBeVisible();
  });
});
