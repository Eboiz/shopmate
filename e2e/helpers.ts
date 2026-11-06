import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Shared steps for the PB-19 main-flow test. Selectors follow the shared
// components (PB-25), the shop page (PB-04), the products page (PB-16) and the
// orders page (PB-12).

export const DEMO_SHOP_SLUG = "may-boutique";

export function demoAccount(role: "owner" | "staff") {
  const prefix = `DEMO_${role.toUpperCase()}`;
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `${prefix}_EMAIL and ${prefix}_PASSWORD must be set (in .env.local, or as GitHub Actions secrets in CI): the seeded demo accounts of PB-02.`,
    );
  }
  return { email, password };
}

export async function signIn(page: Page, role: "owner" | "staff", next = "/admin") {
  const { email, password } = demoAccount(role);
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL((url) => url.pathname.startsWith(next));
}

// Stock of one variant as the products page (PB-16) shows it. Staff can view it,
// so the test needs no database key.
export async function readStock(page: Page, product: string, size: string, color: string) {
  await page.goto("/admin/products");
  const section = page.locator("section", { has: page.getByRole("heading", { name: product }) });
  const value = await section.getByLabel(`Tồn kho: ${size} / ${color}`).inputValue();
  return Number(value);
}

// True when a route answers with anything but 404 or a redirect (a redirect to
// the login page says nothing about the route), so the main flow can wait until
// the stories it needs have reached the deployment under test.
export async function routeExists(request: APIRequestContext, path: string) {
  const status = (await request.get(path, { maxRedirects: 0 })).status();
  return status !== 404 && (status < 300 || status >= 400);
}

export function expectNoHorizontalScroll(page: Page) {
  return expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
}
