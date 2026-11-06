import { expect, test } from "@playwright/test";
import {
  DEMO_SHOP_SLUG,
  expectNoHorizontalScroll,
  readStock,
  routeExists,
  signIn,
} from "./helpers";

test("signed-out visitors of /admin go to the login page", async ({ page }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
});

test("the login page fits a 375 px screen", async ({ page }) => {
  await page.goto("/login");

  await expectNoHorizontalScroll(page);
});

test("the seeded demo staff account can sign in", async ({ page }) => {
  await signIn(page, "staff");

  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Menu quản lý" })).toBeVisible();
});

// PB-19 main flow (Eboiz/Documents#19). The AI's wording changes between runs,
// so the test checks facts (a size is named, an order exists, stock went down by
// the ordered quantity) rather than exact sentences.
const PRODUCT = "Váy suông linen";
const SIZE = "M";
const COLOR = "Trắng";

test("shopper asks for a size, orders in the chat, staff confirm, stock goes down", async ({
  page,
  browser,
}) => {
  test.setTimeout(5 * 60_000);

  const staff = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await signIn(staff, "staff");

  // Runs once the chat API (PB-03/PB-04/PB-11) and the orders API (PB-12) are on
  // the deployment under test; until then it is reported as skipped, not passed.
  // Probed with the staff session, so the orders API answers as it will in the test.
  const api = staff.context().request;
  const missing = [];
  if (!(await routeExists(api, `/api/shops/${DEMO_SHOP_SLUG}/chat`))) missing.push("chat API (PB-03, PB-04, PB-11)");
  if (!(await routeExists(api, "/api/admin/orders?status=draft"))) missing.push("orders API (PB-12)");
  test.skip(missing.length > 0, `Not deployed yet: ${missing.join(", ")}`);

  // A name only this run uses, to find its order among the others.
  const customer = `E2E ${Date.now().toString(36)}`;

  const stockBefore = await readStock(staff, PRODUCT, SIZE, COLOR);
  expect(stockBefore, "seeded stock must allow one more order; run pnpm db:seed").toBeGreaterThan(0);

  // 1. Shop page, ask about the dress.
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  await expectNoHorizontalScroll(page);
  await page
    .locator("article", { has: page.getByRole("heading", { name: PRODUCT }) })
    .getByRole("button", { name: "Hỏi về món này" })
    .click();

  // Each AI reply carries the label "Shop" above its bubble (PB-04); its parent
  // holds the reply text and any product cards.
  const chat = page.getByRole("region", { name: "Trò chuyện với shop" });
  const aiReplies = chat.getByText("Shop", { exact: true });
  const send = async (text: string) => {
    const before = await aiReplies.count();
    await chat.getByRole("textbox", { name: "Tin nhắn" }).fill(text);
    await chat.getByRole("button", { name: "Gửi" }).click();
    await expect(aiReplies).toHaveCount(before + 1, { timeout: 60_000 });
    return aiReplies.last().locator("xpath=..").innerText();
  };

  // 2. Size question: the answer names a size from the size chart (PB-06).
  const sizeAnswer = await send("Mình cao 158cm, nặng 50kg thì mặc size nào vừa?");
  expect(sizeAnswer).toMatch(/\b(XS|S|M|L|XL)\b/);

  // 3. Order in the chat (PB-11): everything in one message, then confirm the
  // summary. The model may ask once more, so confirm up to three times.
  await send(
    `Mình lấy 1 cái ${PRODUCT} màu ${COLOR} size ${SIZE}. Tên ${customer}, SĐT 0912345678, địa chỉ 12 Lê Lợi, Quận 1, TP.HCM.`,
  );
  const draft = staff.getByRole("list", { name: "Đơn nháp" }).locator("li", { hasText: customer });
  for (let attempt = 0; attempt < 3; attempt++) {
    await send("Đúng rồi, bạn chốt đơn giúp mình nhé.");
    await staff.goto("/admin/orders");
    if (await draft.count()) break;
  }

  // 4. Staff confirm the draft order (PB-12).
  await expect(draft).toHaveCount(1);
  await expect(draft).toContainText(`${SIZE}`);
  await draft.getByRole("button", { name: "Xác nhận" }).click();
  await expect(draft).toHaveCount(0, { timeout: 30_000 });

  // 5. Stock went down by exactly the one item ordered.
  expect(await readStock(staff, PRODUCT, SIZE, COLOR)).toBe(stockBefore - 1);
});
