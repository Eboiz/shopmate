import { expect, test } from "@playwright/test";
import {
  DEMO_SHOP_SLUG,
  draftOrderOf,
  openDraftOrders,
  readStock,
  routeExists,
  signIn,
  sizesNamed,
} from "./support/admin";
import { againstDeployment, uid } from "./support/env";

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

test("sizesNamed finds sizes written as words, not letters inside words", () => {
  expect(sizesNamed("Bạn mặc size M nhé, L sẽ hơi rộng.")).toEqual(["M", "L"]);
  expect(sizesNamed("Mình gửi về TP.HCM, Quận 1")).toEqual([]);
  expect(sizesNamed("Size còn hàng: S, M, L, XL")).toEqual(["S", "M", "L", "XL"]);
  expect(sizesNamed("Bạn mặc size M.")).toEqual(["M"]);
  expect(sizesNamed("Mẫu này Màu Be")).toEqual([]);
});

// PB-19 main flow (Eboiz/Documents#19). It talks to the real AI, so it checks
// facts (the right size, the right order line, stock one lower), not sentences.
// Run it with `pnpm test:e2e:main` (one worker, three times; see README).
const PRODUCT = "Váy suông linen";
const SIZE = "S"; // The PO's VAY01 chart maps 150 cm / 44 kg to S; be/S has stock for three runs.
const COLOR = "be";

test("shopper asks for a size, orders in the chat, staff confirm, stock goes down", async ({ page, browser }) => {
  test.setTimeout(5 * 60_000);
  // The nightly job's throwaway stack has no Claude key; this test needs the real AI.
  test.skip(Boolean(process.env.CI) && !againstDeployment, "needs the real AI: run it against a preview with E2E_BASE_URL");

  const staff = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await signIn(staff, "staff");

  // Runs once the chat API (PB-03/PB-04/PB-11) and the orders API (PB-12) are on
  // the deployment under test; until then it is reported as skipped, not passed.
  const api = staff.context().request;
  const missing = [];
  if (!(await routeExists(api, `/api/shops/${DEMO_SHOP_SLUG}/chat`))) missing.push("chat API (PB-03, PB-04, PB-11)");
  if (!(await routeExists(api, "/api/admin/orders?status=draft"))) missing.push("orders API (PB-12)");
  test.skip(missing.length > 0, `Not deployed yet: ${missing.join(", ")}`);

  // A name only this run uses, to find its order among the others.
  const customer = uid("E2E");
  const stockBefore = await readStock(staff, PRODUCT, SIZE, COLOR);
  expect(stockBefore, "seeded stock must allow one more order; run pnpm db:seed").toBeGreaterThan(0);

  // 1. Shop page, open the dress, ask about it.
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  await page
    .locator("article", { has: page.getByRole("heading", { name: PRODUCT, exact: true }) })
    .getByRole("link", { name: "Xem chi tiết", exact: true })
    .click();
  await page.getByRole("button", { name: "Hỏi shop", exact: true }).click();

  // Each shop reply has a label ("Trợ lý AI", or "Shop" for a system notice)
  // followed by its text bubble. Only the bubble is read: the product cards
  // under it list every size in stock.
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  const aiLabels = chat.getByText(/^(Trợ lý AI|Shop)$/);
  const send = async (text: string) => {
    const before = await aiLabels.count();
    await chat.getByRole("textbox", { name: "Tin nhắn" }).fill(text);
    await chat.getByRole("button", { name: "Gửi" }).click();
    await expect(aiLabels).toHaveCount(before + 1, { timeout: 60_000 });
    return aiLabels.last().locator("xpath=following-sibling::div[1]").innerText();
  };

  // 2. Size question: the reply text recommends S (PB-06).
  const sizeAnswer = await send("Mình cao 150cm, nặng 44kg thì mặc size nào vừa?");
  expect(sizesNamed(sizeAnswer), `size answer: ${sizeAnswer}`).toContain(SIZE);

  // 3. Order in the chat (PB-11): everything in one message, then confirm the
  // summary. The model may ask once more, so confirm up to three times, looking
  // for the order only once the orders page has loaded.
  await send(
    `Mình lấy 1 cái ${PRODUCT} màu ${COLOR} size ${SIZE}. Tên ${customer}, SĐT 0912345678, địa chỉ 12 Lê Lợi, Quận 1, TP.HCM.`,
  );
  let order = draftOrderOf(await openDraftOrders(staff), customer);
  for (let attempt = 0; attempt < 3 && (await order.count()) === 0; attempt++) {
    await send("Đúng rồi, bạn chốt đơn giúp mình nhé.");
    order = draftOrderOf(await openDraftOrders(staff), customer);
  }

  // 4. The draft has exactly the line ordered: name, color, size, quantity (PB-12).
  await expect(order).toHaveCount(1);
  const lines = order.getByRole("list", { name: "Mặt hàng" }).getByRole("listitem");
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText(PRODUCT);
  await expect(lines.first()).toContainText(`${COLOR} · Cỡ ${SIZE} · SL 1`);

  // 5. Staff confirm it, and stock goes down by exactly the one item ordered.
  await order.getByRole("button", { name: "Xác nhận" }).click();
  await expect(staff.getByText(`Đã xác nhận đơn của ${customer}.`)).toBeVisible({ timeout: 30_000 });
  expect(await readStock(staff, PRODUCT, SIZE, COLOR)).toBe(stockBefore - 1);
});
