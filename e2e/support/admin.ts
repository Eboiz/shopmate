import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { demo } from "./env";

// Shared steps for the PB-19 main flow. Selectors follow the shared components
// (PB-25), the shop page (PB-04), the products page (PB-16) and the orders page
// (PB-12).

export const DEMO_SHOP_SLUG = "may-boutique";

export async function signIn(page: Page, role: "owner" | "staff", next = "/admin") {
  const { email, password } = demo[role];
  if (!email || !password) {
    throw new Error(`DEMO_${role.toUpperCase()}_EMAIL and DEMO_${role.toUpperCase()}_PASSWORD must be set: the seeded demo accounts of PB-02.`);
  }
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL((url) => url.pathname.startsWith(next));
}

// Stock of one variant as the products page (PB-16) shows it. Staff can view it,
// so the test needs no database key and also works against a preview.
export async function readStock(page: Page, product: string, size: string, color: string) {
  await page.goto("/admin/products");
  const section = page.locator("section", { has: page.getByRole("heading", { name: product, exact: true }) });
  return Number(await section.getByLabel(`Tồn kho: ${size} / ${color}`).inputValue());
}

// Opens /admin/orders and waits until the list has loaded (or says it is empty):
// counting before that sees 0 orders (review #13).
export async function openDraftOrders(page: Page) {
  await page.goto("/admin/orders");
  const list = page.getByRole("list", { name: "Đơn nháp" });
  const empty = page.getByText("Không có đơn nháp", { exact: true });
  await expect(list.or(empty)).toBeVisible({ timeout: 30_000 });
  return list;
}

// The draft order card whose customer name is `customer`.
export function draftOrderOf(list: Locator, customer: string) {
  return list.getByRole("article").filter({ has: list.page().getByRole("heading", { name: customer, exact: true }) });
}

// True when a route answers with anything but 404 or a redirect (a redirect to
// the login page says nothing about the route), so the main flow can wait until
// the stories it needs have reached the deployment under test.
export async function routeExists(request: APIRequestContext, path: string) {
  const status = (await request.get(path, { maxRedirects: 0 })).status();
  return status !== 404 && (status < 300 || status >= 400);
}

// Letter sizes written as a word of their own in a reply ("size M", "M nhé"), not
// inside a word like "Mình" or "TP.HCM".
export function sizesNamed(text: string): string[] {
  const found = text.match(/(?<!\p{L})(XXL|XL|XS|S|M|L)(?!\p{L})/gu) ?? [];
  return [...new Set(found)];
}
