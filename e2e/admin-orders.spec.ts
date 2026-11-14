import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SHOP_SLUG, draftOrderOf, signIn } from "./support/admin";
import { shopIdBySlug } from "./support/db";
import { NEEDS_DB, db, uid } from "./support/env";

// Staff-made orders (/admin/orders/new, POST /api/admin/orders). Written as
// drafts through the same RPC as the AI, without any AI call; stock goes down
// only when staff confirm, which these tests never do.

const EVAL_SHOP_SLUG = `${DEMO_SHOP_SLUG}-eval`;
const vnd = new Intl.NumberFormat("vi-VN");
const formatPrice = (price: number) => `${vnd.format(price)}đ`;

type StockedVariant = { id: string; color: string; size: string; stock: number; productId: string; price: number };

function client() {
  if (!db) throw new Error("no local database");
  return db;
}

// Variants with at least `min` in stock, each of a different product.
async function stockedVariants(shopId: string, min: number, count: number): Promise<StockedVariant[]> {
  const { data, error } = await client()
    .from("variants")
    .select("id, color, size, stock, product_id, products!inner(price)")
    .eq("shop_id", shopId)
    .gte("stock", min)
    .order("id");
  if (error) throw error;
  const picked = new Map<string, StockedVariant>();
  for (const row of data) {
    if (picked.has(row.product_id)) continue;
    picked.set(row.product_id, { id: row.id, color: row.color, size: row.size, stock: row.stock, productId: row.product_id, price: row.products.price });
  }
  const found = [...picked.values()].slice(0, count);
  if (found.length < count) throw new Error(`the seed has fewer than ${count} products with stock >= ${min}`);
  return found;
}

async function stockOf(variantId: string) {
  const { data, error } = await client().from("variants").select("stock").eq("id", variantId).single();
  if (error) throw error;
  return data.stock;
}

// Removes conversations made by a test, with everything hanging off them.
async function purge(conversationIds: string[]) {
  if (conversationIds.length === 0) return;
  const d = client();
  const { data: orders } = await d.from("orders").select("id").in("conversation_id", conversationIds);
  const orderIds = (orders ?? []).map((order) => order.id);
  if (orderIds.length) {
    await d.from("order_items").delete().in("order_id", orderIds);
    await d.from("orders").delete().in("id", orderIds);
  }
  await d.from("messages").delete().in("conversation_id", conversationIds);
  const { data: conversations } = await d.from("conversations").select("shopper_id").in("id", conversationIds);
  await d.from("conversations").delete().in("id", conversationIds);
  const shopperIds = (conversations ?? []).map((row) => row.shopper_id);
  if (shopperIds.length) await d.from("shoppers").delete().in("id", shopperIds);
}

// A web shopper with a conversation in staff mode and one message: nothing here
// calls the AI, and the conversation shows up in the inbox.
async function insertStaffConversation(shopId: string, externalId: string, displayName: string) {
  const d = client();
  const shopper = await d
    .from("shoppers")
    .insert({ shop_id: shopId, channel: "web", external_id: externalId, display_name: displayName })
    .select("id")
    .single();
  if (shopper.error) throw shopper.error;
  const conversation = await d
    .from("conversations")
    .insert({ shop_id: shopId, shopper_id: shopper.data.id, mode: "staff" })
    .select("id")
    .single();
  if (conversation.error) throw conversation.error;
  const message = await d
    .from("messages")
    .insert({ shop_id: shopId, conversation_id: conversation.data.id, sender: "shopper", text: "xin chào" });
  if (message.error) throw message.error;
  return conversation.data.id;
}

async function insertDraftOrder(
  shopId: string,
  conversationId: string,
  customer: { name: string; phone: string; address: string },
  variant: StockedVariant,
) {
  const d = client();
  const order = await d
    .from("orders")
    .insert({
      shop_id: shopId,
      conversation_id: conversationId,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_address: customer.address,
      total: variant.price,
    })
    .select("id")
    .single();
  if (order.error) throw order.error;
  const item = await d
    .from("order_items")
    .insert({ order_id: order.data.id, shop_id: shopId, variant_id: variant.id, quantity: 1, unit_price: variant.price });
  if (item.error) throw item.error;
  return order.data.id;
}

// The cookie the shop chat reads: "<id>.<HMAC of the id>", signed with the same
// secret key the app runs with (the throwaway stack uses one key for both). The
// database keeps only the SHA-256 of the token as the shopper's external id.
function mintShopperToken() {
  const key = process.env.E2E_SUPABASE_SECRET_KEY ?? "";
  const id = randomBytes(32).toString("base64url");
  const token = `${id}.${createHmac("sha256", key).update(`shopper-token:${id}`).digest("base64url")}`;
  return { token, externalId: createHash("sha256").update(token).digest("base64url") };
}

// The line `index` (0-based) of the new-order form.
function orderLine(page: Page, index: number) {
  const line = page.locator("form ul > li").nth(index);
  return {
    product: line.locator("select").nth(0),
    variant: line.locator("select").nth(1),
    quantity: line.getByLabel("Số lượng"),
  };
}

test.describe("Admin manual orders", () => {
  test("staff type in a phone order without a conversation", async ({ page }) => {
    test.skip(!db, NEEDS_DB);
    const shopId = await shopIdBySlug(DEMO_SHOP_SLUG);
    const [v1, v2, spare] = await stockedVariants(shopId, 2, 3);
    const customerName = `Khách ${uid("don")}`;
    const address = "12 Lê Lợi, Q1";

    // A variant out of stock: the seed's own if it has one, else the spare one
    // for the length of the test.
    const { data: zeroRows, error: zeroError } = await client()
      .from("variants")
      .select("id, color, size, product_id")
      .eq("shop_id", shopId)
      .eq("stock", 0)
      .not("product_id", "in", `(${v1.productId},${v2.productId})`)
      .limit(1);
    if (zeroError) throw zeroError;
    let zero = zeroRows[0] ? { id: zeroRows[0].id, productId: zeroRows[0].product_id } : null;
    let restoreSpare = false;
    if (!zero) {
      const { error } = await client().from("variants").update({ stock: 0 }).eq("id", spare.id);
      if (error) throw error;
      restoreSpare = true;
      zero = { id: spare.id, productId: spare.productId };
    }

    const stockBefore = { v1: await stockOf(v1.id), v2: await stockOf(v2.id) };
    let conversationIds: string[] = [];
    try {
      await signIn(page, "staff", "/admin/orders");

      // 1. Open /admin/orders and tap "+ Tạo đơn".
      await page.getByRole("link", { name: "+ Tạo đơn" }).click();
      await expect(page.getByRole("heading", { name: "Tạo đơn thủ công" })).toBeVisible();
      await expect(page.getByText("Đơn khách đặt qua điện thoại, Zalo hoặc tại cửa hàng.")).toBeVisible();

      // A variant with stock 0 is shown "(hết hàng)" and can't be chosen.
      const first = orderLine(page, 0);
      await first.product.selectOption(zero.productId);
      const soldOut = first.variant.locator(`option[value="${zero.id}"]`);
      await expect(soldOut).toContainText("(hết hàng)");
      await expect(soldOut).toBeDisabled();

      // 2. Sản phẩm 1: V1's product, V1's variant, quantity 1.
      await first.product.selectOption(v1.productId);
      await first.variant.selectOption(v1.id);
      await expect(first.quantity).toHaveValue("1");

      // 3. "+ Thêm sản phẩm", then V2 with quantity 2.
      await page.getByRole("button", { name: "+ Thêm sản phẩm" }).click();
      const second = orderLine(page, 1);
      await second.product.selectOption(v2.productId);
      await second.variant.selectOption(v2.id);
      await second.quantity.fill("2");
      await expect(page.locator("p", { hasText: "Tổng tiền hàng" })).toContainText(formatPrice(v1.price + 2 * v2.price));

      // 4. Họ tên, Số điện thoại and Địa chỉ giao hàng.
      await page.getByLabel("Họ tên").fill(customerName);
      await page.getByLabel("Số điện thoại").fill("0987654321");
      await page.getByLabel("Địa chỉ giao hàng").fill(address);

      // 5. "Tạo đơn chờ xác nhận".
      await page.getByRole("button", { name: "Tạo đơn chờ xác nhận" }).click();
      await expect(page).toHaveURL(/\/admin\/orders\?created=1$/);
      await expect(page.getByRole("status").filter({ hasText: "Đã tạo đơn. Kiểm tra lại rồi bấm Xác nhận để trừ tồn kho." })).toBeVisible();
      const list = page.getByRole("list", { name: "Đơn chờ xác nhận" });
      await expect(draftOrderOf(list, customerName)).toBeVisible({ timeout: 30_000 });

      // DB: one draft order with a staff quote key and 2 lines.
      const { data: orders, error } = await client()
        .from("orders")
        .select("id, status, quote_key, conversation_id, customer_phone, total, order_items(variant_id, quantity)")
        .eq("shop_id", shopId)
        .eq("customer_name", customerName);
      if (error) throw error;
      expect(orders).toHaveLength(1);
      const order = orders[0];
      conversationIds = [order.conversation_id];
      expect(order.status).toBe("draft");
      expect(order.customer_phone).toBe("0987654321");
      expect(order.total).toBe(v1.price + 2 * v2.price);
      expect(order.quote_key).toMatch(/^staff:[0-9a-f-]{36}$/);
      expect(order.order_items).toHaveLength(2);
      expect(order.order_items.find((line) => line.variant_id === v1.id)?.quantity).toBe(1);
      expect(order.order_items.find((line) => line.variant_id === v2.id)?.quantity).toBe(2);
      const clientOrderId = order.quote_key!.slice("staff:".length);

      // A new conversation in staff mode of a web shopper made for this order.
      const { data: conversation, error: conversationError } = await client()
        .from("conversations")
        .select("id, mode, shoppers!inner(channel, external_id, display_name)")
        .eq("id", order.conversation_id)
        .single();
      if (conversationError) throw conversationError;
      expect(conversation.mode).toBe("staff");
      expect(conversation.shoppers).toMatchObject({
        channel: "web",
        external_id: `staff-order:${clientOrderId}`,
        display_name: customerName,
      });

      // No AI turn, and stock is untouched until staff confirm.
      const turns = await client().from("ai_turns").select("id", { count: "exact", head: true }).eq("conversation_id", order.conversation_id);
      expect(turns.error).toBeNull();
      expect(turns.count).toBe(0);
      expect(await stockOf(v1.id)).toBe(stockBefore.v1);
      expect(await stockOf(v2.id)).toBe(stockBefore.v2);

      // 6. The inbox lists a conversation named after the customer.
      await page.goto("/admin/inbox");
      await page.getByLabel("Tìm hội thoại").fill(customerName);
      await expect(page.getByLabel("Danh sách hội thoại").getByText(customerName, { exact: true })).toBeVisible({ timeout: 30_000 });
    } finally {
      if (restoreSpare) await client().from("variants").update({ stock: spare.stock }).eq("id", spare.id);
      if (conversationIds.length === 0) {
        const { data } = await client().from("orders").select("conversation_id").eq("shop_id", shopId).eq("customer_name", customerName);
        conversationIds = (data ?? []).map((row) => row.conversation_id);
      }
      await purge(conversationIds);
    }
  });

  test("staff create an order from an inbox conversation and the shopper is told in their chat", async ({ page, browser, baseURL }) => {
    test.skip(!db, NEEDS_DB);
    const shopId = await shopIdBySlug(DEMO_SHOP_SLUG);
    const [earlier, chosen] = await stockedVariants(shopId, 1, 2);
    const shopperName = `Khách ${uid("hoi-thoai")}`;
    const previous = { name: shopperName, phone: "0912345678", address: "45 Nguyễn Huệ, Q1" };
    const { token, externalId } = mintShopperToken();
    const conversationId = await insertStaffConversation(shopId, externalId, shopperName);
    const shopperContext = await browser.newContext({ baseURL, viewport: { width: 375, height: 800 } });
    try {
      await insertDraftOrder(shopId, conversationId, previous, earlier);
      const stockBefore = await stockOf(chosen.id);
      await shopperContext.addCookies([
        { name: "shopmate_shopper", value: token, domain: new URL(baseURL!).hostname, path: "/api/shops", httpOnly: true, secure: false, sameSite: "Lax" },
      ]);

      // The shopper keeps the shop chat open.
      const shopper = await shopperContext.newPage();
      await shopper.goto(`/s/${DEMO_SHOP_SLUG}`);
      await shopper.getByRole("button", { name: "Chat với shop" }).first().focus();
      await shopper.keyboard.press("Enter");
      const chat = shopper.getByRole("dialog", { name: "Trò chuyện với shop" });
      await expect(chat.getByText("xin chào", { exact: true })).toBeVisible({ timeout: 30_000 });

      // 1. In /admin/inbox, open the conversation and tap "Tạo đơn".
      await signIn(page, "staff", "/admin/inbox");
      await page.goto(`/admin/inbox?c=${conversationId}`);
      await expect(page.getByRole("region", { name: `Cuộc trò chuyện với ${shopperName}` })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("link", { name: "Tạo đơn cho khách này" }).click();

      // 2. Check the page, choose one in-stock variant, quantity 1, create the order.
      await expect(page).toHaveURL(new RegExp(`/admin/orders/new\\?c=${conversationId}$`));
      await expect(page.getByText("Đơn cho khách trong hội thoại này.")).toBeVisible();
      await expect(page.getByLabel("Họ tên")).toHaveValue(previous.name);
      await expect(page.getByLabel("Số điện thoại")).toHaveValue(previous.phone);
      await expect(page.getByLabel("Địa chỉ giao hàng")).toHaveValue(previous.address);
      const line = orderLine(page, 0);
      await line.product.selectOption(chosen.productId);
      await line.variant.selectOption(chosen.id);
      await expect(line.quantity).toHaveValue("1");
      await page.getByRole("button", { name: "Tạo đơn chờ xác nhận" }).click();
      await expect(page).toHaveURL(/\/admin\/orders\?created=1$/);

      // The new order belongs to that conversation; nothing else was created.
      await expect
        .poll(async () => {
          const { data } = await client().from("orders").select("id").eq("conversation_id", conversationId);
          return data?.length;
        })
        .toBe(2);
      const { data: staffOrders, error } = await client()
        .from("orders")
        .select("id, shop_id, quote_key, total, status")
        .eq("conversation_id", conversationId)
        .like("quote_key", "staff:%");
      if (error) throw error;
      expect(staffOrders).toHaveLength(1);
      expect(staffOrders[0]).toMatchObject({ shop_id: shopId, status: "draft", total: chosen.price });
      const sameName = await client().from("shoppers").select("id").eq("shop_id", shopId).eq("display_name", shopperName);
      expect(sameName.data).toHaveLength(1);
      const { data: notices, error: noticeError } = await client()
        .from("messages")
        .select("text")
        .eq("conversation_id", conversationId)
        .eq("sender", "system");
      if (noticeError) throw noticeError;
      expect(notices).toHaveLength(1);
      expect(notices[0].text).toMatch(/^Shop đã tạo đơn hàng cho bạn:\n/);
      expect(await stockOf(chosen.id)).toBe(stockBefore);

      // 3. The shopper's open chat shows the notice on its next poll, line breaks kept.
      const bubble = chat.locator("div.whitespace-pre-line").filter({ hasText: "Shop đã tạo đơn hàng cho bạn:" });
      await expect(bubble).toBeVisible({ timeout: 20_000 });
      await expect(bubble).toHaveCSS("white-space", "pre-line");
      expect(await bubble.textContent()).toContain("\n");
      await expect(bubble).toContainText(formatPrice(chosen.price));

      // The inbox thread shows the same message as a multi-line system bubble.
      await page.goto(`/admin/inbox?c=${conversationId}`);
      const notice = page.getByRole("log", { name: "Tin nhắn" }).locator("p").filter({ hasText: "Shop đã tạo đơn hàng cho bạn:" });
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice).toHaveClass(/whitespace-pre-line/);
      await expect(notice).toHaveClass(/rounded-xl/);
      expect(await notice.textContent()).toContain("\n");
    } finally {
      await shopperContext.close();
      await purge([conversationId]);
    }
  });

  test("staff cannot order or open another shop's data", async ({ page }) => {
    test.skip(!db, NEEDS_DB);
    const shopId = await shopIdBySlug(DEMO_SHOP_SLUG);
    const evalShopId = await shopIdBySlug(EVAL_SHOP_SLUG);
    const [own] = await stockedVariants(shopId, 1, 1);
    const [foreign] = await stockedVariants(evalShopId, 1, 1);
    const evalShopper = `Khách ${uid("eval")}`;
    const evalAddress = `Địa chỉ eval ${uid("dc")}`;
    const probeName = `Khách ${uid("probe")}`;
    const clientOrderIds = [randomUUID(), randomUUID()];
    const customer = { name: probeName, phone: "0912345678", address: "12 Lê Lợi, Q1" };

    // Ce: a conversation of the eval twin with an order that has a name and address.
    const conversationId = await insertStaffConversation(evalShopId, `e2e-eval-${uid("ext")}`, evalShopper);
    const orphans: string[] = [];
    try {
      await insertDraftOrder(evalShopId, conversationId, { name: evalShopper, phone: "0912345670", address: evalAddress }, foreign);
      const countOf = async (table: "orders" | "messages", column: "conversation_id", value: string) => {
        const { count, error } = await client().from(table).select("id", { count: "exact", head: true }).eq(column, value);
        if (error) throw error;
        return count;
      };
      const before = {
        messages: await countOf("messages", "conversation_id", conversationId),
        orders: await countOf("orders", "conversation_id", conversationId),
        stock: await stockOf(foreign.id),
      };

      await signIn(page, "staff", "/admin/orders");

      // 2. POST /api/admin/orders with the other shop's variant and no conversation.
      const foreignVariant = await page.request.post("/api/admin/orders", {
        data: {
          clientOrderId: clientOrderIds[0],
          conversationId: null,
          items: [{ variantId: foreign.id, quantity: 1, unitPrice: foreign.price }],
          customer,
        },
      });
      expect(foreignVariant.status()).toBe(409);
      expect(await foreignVariant.json()).toMatchObject({ code: "unavailable" });

      // 3. One of this shop's variants, but the other shop's conversation.
      const foreignConversation = await page.request.post("/api/admin/orders", {
        data: {
          clientOrderId: clientOrderIds[1],
          conversationId,
          items: [{ variantId: own.id, quantity: 1, unitPrice: own.price }],
          customer,
        },
      });
      expect(foreignConversation.status()).toBe(404);
      expect(await foreignConversation.json()).toMatchObject({ error: "Không tìm thấy hội thoại này." });

      // 4. /admin/orders/new?c=<Ce> opens a plain order form with no prefill.
      await page.goto(`/admin/orders/new?c=${conversationId}`);
      await expect(page.getByRole("heading", { name: "Tạo đơn thủ công" })).toBeVisible();
      await expect(page.getByText("Đơn khách đặt qua điện thoại, Zalo hoặc tại cửa hàng.")).toBeVisible();
      await expect(page.getByText("Đơn cho khách trong hội thoại này.")).toHaveCount(0);
      await expect(page.getByLabel("Họ tên")).toHaveValue("");
      await expect(page.getByLabel("Số điện thoại")).toHaveValue("");
      await expect(page.getByLabel("Địa chỉ giao hàng")).toHaveValue("");
      await expect(page.getByText(evalShopper)).toHaveCount(0);
      await expect(page.getByText(evalAddress)).toHaveCount(0);

      // Nothing was written in either shop.
      for (const id of clientOrderIds) {
        const quoted = await client().from("orders").select("id").eq("quote_key", `staff:${id}`);
        expect(quoted.data).toHaveLength(0);
      }
      const named = await client().from("orders").select("id").eq("customer_name", probeName);
      expect(named.data).toHaveLength(0);
      const shoppers = await client().from("shoppers").select("id, shop_id, external_id").eq("display_name", probeName);
      expect(shoppers.data?.filter((row) => row.shop_id === evalShopId)).toHaveLength(0);
      expect(await countOf("messages", "conversation_id", conversationId)).toBe(before.messages);
      expect(await countOf("orders", "conversation_id", conversationId)).toBe(before.orders);
      expect(await stockOf(foreign.id)).toBe(before.stock);

      // Step 2 may leave a staff-mode conversation behind in the staff member's own
      // shop before the RPC refuses: report it, then clean it up.
      for (const row of shoppers.data ?? []) {
        orphans.push(row.id);
        test.info().annotations.push({
          type: "finding",
          description: `POST /api/admin/orders refused with 409 but left an orphan shopper ${row.external_id} and conversation in the staff member's shop`,
        });
      }
    } finally {
      await purge([conversationId]);
      if (orphans.length) {
        const { data } = await client().from("conversations").select("id").in("shopper_id", orphans);
        await purge((data ?? []).map((row) => row.id));
        await client().from("shoppers").delete().in("id", orphans);
      }
    }
  });
});
