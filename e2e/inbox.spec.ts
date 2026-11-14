import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMO_SHOP_SLUG, signIn } from "./support/admin";
import { shopIdBySlug } from "./support/db";
import { db, NEEDS_DB, uid } from "./support/env";

// The staff inbox message log: a new message must not drag the reader to the
// bottom while they read further up (plan 2026-11-14, case 7, inbox part).

const HISTORY = 30;

// How far the log is from its bottom edge, in px.
const gapToBottom = (log: Locator) => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

// Scrolls the log to the top and waits for the scroll event, so the inbox has
// already noted that the reader left the bottom.
const scrollToTop = (log: Locator) =>
  log.evaluate((el) => new Promise<void>((resolve) => {
    if (el.scrollTop === 0) return resolve();
    el.addEventListener("scroll", () => resolve(), { once: true });
    el.scrollTop = 0;
  }));

// Two animation frames: whatever React committed for the last update has run.
const nextFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test.describe("Polling no longer drags the reader to the bottom (inbox)", () => {
  test("a new shopper message keeps the reader's place until staff send a reply", async ({ page }) => {
    test.skip(!db, NEEDS_DB);
    const client = db!;
    const shopId = await shopIdBySlug(DEMO_SHOP_SLUG);
    const customer = `Khách ${uid("cuon")}`;

    const { data: shopper, error: shopperError } = await client
      .from("shoppers")
      .insert({ shop_id: shopId, channel: "web", external_id: uid("e2e-inbox"), display_name: customer })
      .select("id")
      .single();
    if (shopperError) throw shopperError;

    try {
      const { data: conversation, error: conversationError } = await client
        .from("conversations")
        .insert({ shop_id: shopId, shopper_id: shopper.id, mode: "ai" })
        .select("id")
        .single();
      if (conversationError) throw conversationError;

      // A long history, one message per second, ending a minute ago.
      const start = Date.now() - 120_000;
      const { error: historyError } = await client.from("messages").insert(
        Array.from({ length: HISTORY }, (_, i) => ({
          shop_id: shopId,
          conversation_id: conversation.id,
          sender: i % 2 === 0 ? ("shopper" as const) : ("ai" as const),
          text: `Tin nhắn số ${i + 1}: nội dung đủ dài để mỗi bong bóng chiếm vài dòng trên màn hình điện thoại.`,
          created_at: new Date(start + i * 1000).toISOString(),
        })),
      );
      if (historyError) throw historyError;

      await signIn(page, "staff", "/admin/inbox");
      await page.goto(`/admin/inbox?c=${conversation.id}`);
      const log = page.getByRole("log", { name: "Tin nhắn" });

      // The conversation opens at its newest message.
      await expect(log).toContainText(`Tin nhắn số ${HISTORY}:`);
      await expect.poll(() => gapToBottom(log), { timeout: 10_000 }).toBeLessThanOrEqual(2);
      expect(await log.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);

      // Scroll up, then a new shopper message arrives.
      await scrollToTop(log);
      const fresh = `Khách hỏi thêm ${uid("moi")}`;
      const { error: freshError } = await client.from("messages").insert({
        shop_id: shopId,
        conversation_id: conversation.id,
        sender: "shopper",
        text: fresh,
      });
      if (freshError) throw freshError;

      // The new message is in the log (arrived by realtime) but the position is kept.
      await expect(log.getByText(fresh)).toBeAttached({ timeout: 20_000 });
      await nextFrames(page);
      expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(5);
      expect(await gapToBottom(log)).toBeGreaterThan(300);

      // Staff take over; the position still holds. Their own reply then brings the log to the bottom.
      await page.getByRole("button", { name: "Tiếp quản" }).click();
      const composer = page.getByRole("textbox", { name: "Tin nhắn cho khách" });
      await expect(composer).toBeVisible();
      expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(5);
      const reply = `Shop trả lời ${uid("rep")}`;
      await composer.fill(reply);
      await composer.press("Enter");
      await expect(log.getByText(reply)).toBeAttached({ timeout: 20_000 });
      await expect.poll(() => gapToBottom(log), { timeout: 10_000 }).toBeLessThanOrEqual(2);
    } finally {
      // Deleting the shopper removes its conversation and messages with it.
      await client.from("shoppers").delete().eq("id", shopper.id);
    }
  });
});
