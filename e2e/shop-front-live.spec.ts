import { expect, test } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "./support/admin";
import { NEEDS_DB, againstDeployment, db, uid } from "./support/env";

// PB-04 against the real API (no mocked routes): the seeded demo shop, the
// catalog, the httpOnly shopper cookie, the channel core, and polling. It does
// not depend on the AI: without ANTHROPIC_API_KEY the engine fails and the chat
// is handed to staff, which is still a reply from the shop. Facts about the
// AI's answers are checked by e2e/main-flow.spec.ts.

const CHAT = `/api/shops/${DEMO_SHOP_SLUG}/chat`;

test("@smoke the demo shop lists products with photo, name, price and colors on a 375 px phone", async ({ page }) => {
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hạnh Boutique");
  const first = page.getByRole("article").first();
  await expect(first.getByRole("img")).toBeVisible();
  await expect(first.getByRole("heading", { level: 3 })).not.toBeEmpty();
  await expect(first.getByText(/\d[\d.]*đ$/)).toBeVisible();
  await expect(first.getByText(/^Màu: /)).toBeVisible();
  // The photo really loaded (not a broken image).
  await expect
    .poll(() => first.getByRole("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("@smoke an unknown shop shows the Vietnamese not-found state", async ({ page }) => {
  await page.goto("/s/khong-co-shop-nay");
  await expect(page.getByText("Không tìm thấy cửa hàng")).toBeVisible();
});

test("ask about a product, get a reply, keep the chat after a reload, see a staff message without reload", async ({ page }) => {
  test.skip(againstDeployment, "writes a conversation: local only");
  const question = `${uid("Váy này còn size M không")}?`;

  // Hold the POST a moment so the typing indicator is observable even when the
  // turn is instant (no AI key locally: immediate handoff).
  const posted: Record<string, unknown>[] = [];
  await page.route(`**${CHAT}`, async (route) => {
    if (route.request().method() === "POST") {
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });

  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  const card = page.getByRole("article").first();
  const productName = (await card.getByRole("heading", { level: 3 }).textContent())!.trim();
  // Asking about a product starts from its detail page.
  await card.getByRole("link", { name: "Xem chi tiết", exact: true }).click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(productName);
  await page.getByRole("button", { name: "Hỏi shop", exact: true }).click();

  const chat = page.getByRole("region", { name: "Trò chuyện với shop" });
  await expect(chat.getByText("Đang hỏi về:")).toContainText(productName);
  // The first GET can be slow on `next dev` (the route compiles on first use).
  await expect(chat.getByText("Xin chào! Mình giúp gì cho bạn?")).toBeVisible({ timeout: 20_000 });
  await chat.getByRole("textbox", { name: "Tin nhắn" }).fill(question);
  await chat.getByRole("button", { name: "Gửi" }).click();
  await expect(chat.getByRole("status")).toContainText("Shop đang trả lời");
  await expect(chat.getByText(question)).toBeVisible();
  // A reply from the shop (AI answer or the handoff notice), then the indicator goes.
  await expect(chat.getByText("Shop", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(chat.getByRole("status")).toHaveCount(0, { timeout: 60_000 });
  expect(posted[0]).toMatchObject({ text: question, productId: expect.any(String), clientMessageId: expect.any(String) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // The shopper cookie is httpOnly: the page's script can't read it.
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "shopmate_shopper")).toMatchObject({ httpOnly: true, path: "/api/shops" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("shopmate_shopper");

  await page.reload();
  // focus + Enter: in `next dev` the dev-tools badge can sit over the button.
  await page.getByRole("button", { name: "Mở trò chuyện với shop" }).focus();
  await page.keyboard.press("Enter");
  await expect(chat.getByText(question)).toBeVisible();

  // PB-12/PB-13 deliver through sendToConversation, which stores the message;
  // the open chat picks it up on its next poll.
  test.skip(!db, NEEDS_DB);
  const { data: stored, error } = await db!
    .from("messages")
    .select("shop_id, conversation_id")
    .eq("sender", "shopper")
    .eq("text", question)
    .single();
  if (error) throw error;
  const staffText = uid("Nhân viên: shop còn size M nha");
  const insert = await db!.from("messages").insert({
    shop_id: stored.shop_id,
    conversation_id: stored.conversation_id,
    sender: "system",
    text: staffText,
    reply: { text: staffText, products: [], quickReplies: [] },
  });
  if (insert.error) throw insert.error;
  await expect(chat.getByText(staffText)).toBeVisible({ timeout: 7_000 });
});
