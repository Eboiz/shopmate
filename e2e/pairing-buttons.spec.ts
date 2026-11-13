import { expect, test, type Page } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "./support/admin";
import { againstDeployment, db, NEEDS_DB, uid } from "./support/env";

// PB-31 AC12: "Bạn muốn phối cùng sản phẩm nào?" now comes with buttons naming
// the shop's own declared pairings (max 3, sorted by name); a product named right
// after that question is treated as a pairing question.
//
// This case needs the real AI: with no key the engine hands the turn to staff and
// there is nothing to assert. It belongs to the nightly `ai` job (E2E_REAL_AI=1),
// like e2e/main-flow.spec.ts. The DB button list is computed the same way the
// engine does it (store.pairedProductNames): the shop's own paired products,
// names trimmed and fit within the 20-character quick-reply limit, cut to 3.

const CHAT = `/api/shops/${DEMO_SHOP_SLUG}/chat`;
const QUESTION = "phối đồ gì đẹp?";
const ASK_PAIRING_PRODUCT_TEXT = "Bạn muốn phối cùng sản phẩm nào? Hãy chọn món hoặc cho shop biết tên sản phẩm nhé.";

async function shopId(): Promise<string> {
  const { data, error } = await db!.from("shops").select("id").eq("slug", DEMO_SHOP_SLUG).single();
  if (error) throw error;
  return data.id;
}

// The DB truth the buttons must equal (mirrors store.pairedProductNames).
async function expectedButtons(shop: string): Promise<string[]> {
  const { data: pairs, error } = await db!.from("pairings").select("product_a_id, product_b_id").eq("shop_id", shop);
  if (error) throw error;
  const ids = [...new Set((pairs ?? []).flatMap((p) => [p.product_a_id, p.product_b_id]))];
  if (ids.length === 0) return [];
  const { data: products, error: productError } = await db!.from("products").select("name").eq("shop_id", shop).in("id", ids).order("name");
  if (productError) throw productError;
  return (products ?? []).map((p) => p.name.trim()).filter((name) => name.length >= 1 && name.length <= 20).slice(0, 3);
}

test("the pairing question offers the shop's own paired products; tapping one asks for that product's matches", async ({ page }) => {
  // Read-only: only the button list is cross-checked against the DB; the chat
  // writes one conversation, so this is local (the ai job), not a @smoke run.
  test.skip(againstDeployment, "writes a conversation: local only");
  test.skip(!db, NEEDS_DB);
  // The pairing question is answered by the model; without the real AI the turn
  // is handed to staff and there is no button list to assert on.
  test.skip(
    Boolean(process.env.CI) && !process.env.E2E_REAL_AI,
    "needs the real AI: the nightly ai job runs it (E2E_REAL_AI=1), like main-flow.spec.ts",
  );

  test.setTimeout(3 * 60_000);
  const [shop, evalShop] = await Promise.all([shopId(), shopIdForEval()]);
  const expected = await expectedButtons(shop);
  const evalNames = await evalProductNames(evalShop);

  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  // Open the shop page without a product detail, so the chat has no product context.
  const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
  await openChat(page);
  await chat.getByRole("textbox", { name: "Tin nhắn" }).fill(QUESTION);
  await chat.getByRole("button", { name: "Gửi" }).click();

  // The reply is the fixed pairing question, with the shop's paired products as buttons.
  const ask = chat.getByText(ASK_PAIRING_PRODUCT_TEXT);
  await expect(ask).toBeVisible({ timeout: 60_000 });
  const buttons = chat.locator("button:not([aria-label='Gửi']):not([aria-label='Gửi cho shop'])");
  const buttonLabels: string[] = [];
  await expect(async () => {
    for (const name of expected) buttonLabels.push(...(await buttons.filter({ hasText: name, exact: true }).count() ? [name] : []));
  }).pass();

  // 3 (max) buttons in the demo shop.
  expect(buttonLabels).toEqual(expected);
  expect(buttonLabels.length).toBeLessThanOrEqual(3);
  // Only this shop's own paired products: no eval-shop product, nothing unpaired.
  for (const name of buttonLabels) expect(evalNames).not.toContain(name);

  // Tapping one button sends that product name as the shopper's message; the
  // next reply lists the paired product with the owner's reason from the DB.
  const tapped = buttonLabels[0];
  const reason = await pairingReasonFor(shop, tapped);
  await chat.getByRole("button", { name: tapped, exact: true }).click();
  // The tapped name appears in the chat as the shopper's own bubble.
  await expect(chat.getByText(tapped, { exact: true })).toBeVisible({ timeout: 30_000 });
  const next = await nextAiBubble(chat, tapped);
  expect(next).toContain(reason);
  // No invented numbers: the reply only names the paired product and the owner's reason.
  expect(next).not.toMatch(/\d+\s?(%|đ|k|nghìn|triệu)/i);
});

// ── helpers ────────────────────────────────────────────────────────────────

async function openChat(page: Page) {
  // The floating "Chat với shop" button, pressed like the live spec does.
  const opener = page.getByRole("button", { name: /Chat với shop/ }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Trò chuyện với shop" }).waitFor();
}

// The last AI bubble strictly after the given marker so a fresh answer is read.
async function nextAiBubble(chat: import("@playwright/test").Locator, marker: string): Promise<string> {
  const text = await expect
    .poll(async () => {
      const bubbles = chat.locator("div");
      const count = await bubbles.count();
      for (let i = count - 1; i >= 0; i -= 1) {
        const value = (await bubbles.nth(i).innerText()) ?? "";
        if (value.includes(marker) && !value.includes(marker) === false) return value;
      }
      return "";
    }, { timeout: 30_000 })
    .catch(() => "");
  return text;
}

async function shopIdForEval(): Promise<string> {
  const { data, error } = await db!.from("shops").select("id").eq("slug", "hanh-boutique-eval").single();
  if (error) throw error;
  return data.id;
}

async function evalProductNames(evalShop: string): Promise<string[]> {
  const { data, error } = await db!.from("products").select("name").eq("shop_id", evalShop);
  if (error) throw error;
  return (data ?? []).map((p) => p.name.trim());
}

// The owner's reason for pairing `name` (either end of its pairing row).
async function pairingReasonFor(shop: string, name: string): Promise<string> {
  const { data: product, error } = await db!.from("products").select("id").eq("shop_id", shop).ilike("name", name).single();
  if (error) throw error;
  const { data, error: pairingError } = await db!
    .from("pairings")
    .select("reason")
    .eq("shop_id", shop)
    .and(`(product_a_id = ${JSON.stringify(product.id)} or product_b_id = ${JSON.stringify(product.id)})`)
    .single();
  if (pairingError) throw pairingError;
  return data.reason;
}
