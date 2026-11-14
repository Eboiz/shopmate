// spec: e2e/plans/2026-11-14.md (cases 1, 4, 5, 8, 9 shopper half, 10)
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { formatPrice } from "../src/lib/format";
import { displayColor } from "../src/lib/shop/catalog-view";
import { DEMO_SHOP_SLUG, draftOrderOf, openDraftOrders, signIn } from "./support/admin";
import { shopIdBySlug } from "./support/db";
import { NEEDS_DB, db, uid } from "./support/env";

// Manual orders, shopper side: the basket's "Đặt hàng" form and
// POST /api/shops/[slug]/orders. Staff confirm on /admin/orders as before.

const SLUG = DEMO_SHOP_SLUG;
const EVAL_SLUG = "hanh-boutique-eval";
const ORDERS_PATH = `/api/shops/${SLUG}/orders`;
const SEARCH_PATH = `/api/shops/${SLUG}/search`;
const UNKNOWN_SHOP = "khong-co-shop-nay";
const SHOPPER_COOKIE = "shopmate_shopper";
const NOTICE_HEAD = "Đã nhận đơn đặt hàng của bạn:";
// main-flow.spec.ts orders this product with the real AI; leave its stock alone.
const RESERVED_PRODUCT = "Váy suông linen";

const MSG = {
  phone: "Số điện thoại gồm 10 số, bắt đầu bằng 0.",
  name: "Vui lòng nhập họ tên.",
  outOfStock: "Một vài món không còn đủ hàng. Bạn giảm số lượng hoặc bỏ món đó rồi đặt lại nhé.",
  priceChanged: "Giá một vài món vừa thay đổi. Bạn mở lại giỏ để xem giá mới rồi đặt lại nhé.",
  unavailable: "Một vài món không còn bán. Bạn bỏ món đó khỏi giỏ rồi đặt lại nhé.",
  notStaff: "Vui lòng đăng nhập bằng tài khoản nhân viên.",
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- database helpers (local Supabase only) ----------

function d() {
  if (!db) throw new Error(NEEDS_DB);
  return db;
}

type Pick = { variantId: string; productId: string; name: string; color: string; size: string; stock: number; price: number };

// An in-stock variant of the shop, found through the database, never by a fixed id.
async function pickVariant(shopId: string, minStock: number): Promise<Pick> {
  const { data, error } = await d()
    .from("variants")
    .select("id, color, size, stock, product_id, products!inner(name, price)")
    .eq("shop_id", shopId)
    .gte("stock", minStock)
    .order("id");
  if (error) throw error;
  const row = data.find((variant) => variant.products.name !== RESERVED_PRODUCT);
  expect(row, `the seeded shop needs a variant with stock >= ${minStock}; run pnpm db:seed`).toBeTruthy();
  const v = row!;
  return { variantId: v.id, productId: v.product_id, name: v.products.name, color: v.color, size: v.size, stock: v.stock, price: v.products.price };
}

async function stockOf(variantId: string): Promise<number> {
  const { data, error } = await d().from("variants").select("stock").eq("id", variantId).single();
  if (error) throw error;
  return data.stock;
}

async function setStock(variantId: string, stock: number) {
  const { error } = await d().from("variants").update({ stock }).eq("id", variantId);
  if (error) throw error;
}

async function setPrice(productId: string, price: number) {
  const { error } = await d().from("products").update({ price }).eq("id", productId);
  if (error) throw error;
}

// Values a test changes are put back here, last change first.
const restores: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  while (restores.length > 0) await restores.pop()!();
});

async function ordersWhere(shopId: string, filter: { customer_name?: string; customer_address?: string; quote_key?: string }) {
  const { data, error } = await d()
    .from("orders")
    .select("id, status, quote_key, customer_name, customer_phone, customer_address, total, conversation_id, order_items(variant_id, quantity, unit_price)")
    .eq("shop_id", shopId)
    .match(filter);
  if (error) throw error;
  return data;
}

async function count(table: "orders" | "shoppers" | "conversations" | "messages", shopId: string): Promise<number> {
  const { count: total, error } = await d().from(table).select("id", { count: "exact", head: true }).eq("shop_id", shopId);
  if (error) throw error;
  return total ?? 0;
}

async function systemTexts(conversationId: string): Promise<string[]> {
  const { data, error } = await d().from("messages").select("text").eq("conversation_id", conversationId).eq("sender", "system");
  if (error) throw error;
  return data.map((message) => message.text);
}

async function messageCount(conversationId: string): Promise<number> {
  const { count: total, error } = await d().from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  if (error) throw error;
  return total ?? 0;
}

// The web shopper behind the browser's chat cookie: the server stores
// sha256(token) as external_id.
async function shopperOfBrowser(page: Page, shopId: string) {
  const cookie = (await page.context().cookies()).find((c) => c.name === SHOPPER_COOKIE);
  expect(cookie, "the order endpoint sets the shopper cookie for a first-time visitor").toBeTruthy();
  const externalId = createHash("sha256").update(cookie!.value).digest("base64url");
  const { data, error } = await d()
    .from("shoppers")
    .select("id, display_name, external_id, conversations(id)")
    .eq("shop_id", shopId)
    .eq("channel", "web")
    .eq("external_id", externalId)
    .single();
  if (error) throw error;
  return { displayName: data.display_name, conversationId: data.conversations[0]?.id as string | undefined };
}

// ---------- shop page helpers ----------

async function addToBasket(page: Page, v: Pick, quantity: number) {
  await page.goto(`/s/${SLUG}/p/${v.productId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(v.name);
  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(displayColor(v.color))}(?: · Hết hàng)?$`) }).click();
  await page.getByRole("button", { name: v.size, exact: true }).click();
  for (let i = 1; i < quantity; i++) await page.getByRole("button", { name: "Tăng số lượng", exact: true }).click();
  await page.getByRole("button", { name: "Thêm vào giỏ", exact: true }).click();
  await expect(page.getByText("Đã thêm vào giỏ.")).toBeVisible();
}

async function openCheckout(page: Page, v: Pick, quantity: number) {
  await page.getByRole("button", { name: /^Giỏ đặt hàng, \d+ món$/ }).first().click();
  const panel = page.getByRole("dialog", { name: /Giỏ đặt hàng|Thông tin giao hàng|Đã gửi đơn/ });
  await expect(panel.getByLabel(`Số lượng ${v.name}`)).toHaveText(String(quantity));
  await panel.getByRole("button", { name: "Đặt hàng", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Thông tin giao hàng" })).toBeVisible();
  return panel;
}

async function fillCustomer(panel: Locator, customer: { name?: string; phone: string; address: string }) {
  if (customer.name !== undefined) await panel.getByLabel("Họ tên").fill(customer.name);
  await panel.getByLabel("Số điện thoại").fill(customer.phone);
  await panel.getByLabel("Địa chỉ giao hàng").fill(customer.address);
}

const submitButton = (panel: Locator) => panel.getByRole("button", { name: "Gửi đơn cho shop" });

async function staffPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await signIn(page, "staff");
  return { context, page };
}

function orderBody(v: Pick, customerName: string, clientOrderId = randomUUID(), quantity = 1) {
  return {
    clientOrderId,
    items: [{ productId: v.productId, color: v.color, size: v.size, quantity, unitPrice: v.price }],
    customer: { name: customerName, phone: "0912345678", address: "12 Lê Lợi, Q1" },
  };
}

// =====================================================================
// Happy path
// =====================================================================

test.describe("shop checkout", () => {
  test("a shopper orders from the basket; staff confirm and stock goes down once", async ({ page, browser }) => {
    test.skip(!db, NEEDS_DB);
    test.setTimeout(120_000);
    const shopId = await shopIdBySlug(SLUG);
    const v = await pickVariant(shopId, 3);
    restores.push(() => setStock(v.variantId, v.stock));
    const name = `Khách ${uid("E2E")}`;
    const total = 2 * v.price;

    // 1. Open the shop at 375 px, choose colour and size, quantity 2, add to basket.
    await addToBasket(page, v, 2);

    // 2. Open the basket and tap "Đặt hàng".
    const panel = await openCheckout(page, v, 2);

    // 3. Fill in the form.
    await fillCustomer(panel, { name, phone: "0912 345 678", address: "12 Lê Lợi, Q1" });

    // 4. Tap "Gửi đơn cho shop".
    await submitButton(panel).click();
    await expect(panel.getByRole("heading", { name: "Đã gửi đơn" })).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("Shop đã nhận đơn của bạn")).toBeVisible();
    await expect(panel.getByText(`Tổng tiền hàng ${formatPrice(total)}`)).toBeVisible();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), `shopmate-cart:${SLUG}`)).toBeNull();

    const shopper = await shopperOfBrowser(page, shopId);
    expect(shopper.displayName).toBe(name);
    await expect.poll(async () => (await ordersWhere(shopId, { customer_name: name })).length).toBe(1);
    const [order] = await ordersWhere(shopId, { customer_name: name });
    expect(order.status).toBe("draft");
    expect(order.quote_key).toMatch(/^checkout:[0-9a-f-]{36}$/);
    expect(order.customer_phone).toBe("0912345678");
    expect(order.total).toBe(total);
    expect(order.conversation_id).toBe(shopper.conversationId);
    expect(order.order_items).toHaveLength(1);
    expect(order.order_items[0]).toMatchObject({ variant_id: v.variantId, quantity: 2, unit_price: v.price });
    expect(await stockOf(v.variantId)).toBe(v.stock);
    await expect.poll(async () => (await systemTexts(order.conversation_id)).filter((t) => t.startsWith(NOTICE_HEAD)).length).toBe(1);
    expect(await systemTexts(order.conversation_id)).toHaveLength(1);

    // 5. Tap "Xem đơn trong chat".
    await panel.getByRole("button", { name: "Xem đơn trong chat" }).click();
    const chat = page.getByRole("dialog", { name: "Trò chuyện với shop" });
    const notice = chat.getByText(NOTICE_HEAD);
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText(`(${v.color}, size ${v.size}) × 2`);
    await expect(notice).toContainText(formatPrice(total));
    await expect(notice).toContainText("0912345678");
    await expect(notice).toContainText("12 Lê Lợi, Q1");

    // 6. In another context, demo staff confirm the order.
    const staff = await staffPage(browser);
    try {
      const list = await openDraftOrders(staff.page);
      const card = draftOrderOf(list, name);
      await expect(card).toHaveCount(1);
      await card.getByRole("button", { name: "Xác nhận", exact: true }).click();
      await card.getByRole("button", { name: "Xác nhận đơn này" }).click();
      await expect(staff.page.getByText(`Đã xác nhận đơn của ${name}. Tồn kho đã được trừ.`)).toBeVisible({ timeout: 30_000 });
      await expect(draftOrderOf(list, name)).toHaveCount(0);
      await expect.poll(() => stockOf(v.variantId)).toBe(v.stock - 2);

      // Reload: the order is gone from the list and stock was not lowered twice.
      const reloaded = await openDraftOrders(staff.page);
      await expect(draftOrderOf(reloaded, name)).toHaveCount(0);
      expect(await stockOf(v.variantId)).toBe(v.stock - 2);
    } finally {
      await staff.context.close();
    }
  });

  // =====================================================================
  // Edge cases
  // =====================================================================

  test("phone formats are normalised; a bad phone or empty field is refused before anything is sent", async ({ page }) => {
    test.skip(!db, NEEDS_DB);
    test.setTimeout(90_000);
    const shopId = await shopIdBySlug(SLUG);
    const v = await pickVariant(shopId, 1);
    const name = `Khách ${uid("E2E")}`;
    const address = `12 Lê Lợi ${uid("addr")}`;
    const orderRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(ORDERS_PATH)) orderRequests.push(request.url());
    });

    // 1. Open the basket and tap "Đặt hàng".
    await addToBasket(page, v, 1);
    const panel = await openCheckout(page, v, 1);

    // 2. Empty name, phone 091234, an address: refused on the form.
    await fillCustomer(panel, { name: "", phone: "091234", address });
    await submitButton(panel).click();
    await expect(panel.getByText(MSG.name)).toBeVisible();
    await expect(panel.getByText(MSG.phone)).toBeVisible();
    await expect(panel.getByLabel("Họ tên")).toHaveAttribute("aria-invalid", "true");
    await expect(panel.getByLabel("Số điện thoại")).toHaveAttribute("aria-invalid", "true");
    await expect(panel.getByLabel("Địa chỉ giao hàng")).not.toHaveAttribute("aria-invalid", "true");
    expect(orderRequests).toHaveLength(0);
    expect(await ordersWhere(shopId, { customer_address: address })).toHaveLength(0);

    // 3. Name filled in and phone "+84 912-345-678": accepted and stored as 10 digits.
    await panel.getByLabel("Họ tên").fill(name);
    await panel.getByLabel("Số điện thoại").fill("+84 912-345-678");
    await submitButton(panel).click();
    await expect(panel.getByRole("heading", { name: "Đã gửi đơn" })).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await ordersWhere(shopId, { customer_name: name })).length).toBe(1);
    const [order] = await ordersWhere(shopId, { customer_name: name });
    expect(order.customer_phone).toBe("0912345678");
    expect(orderRequests).toHaveLength(1);

    // 4. Reload, add an item and open the form again: prefilled from localStorage.
    await page.reload();
    await addToBasket(page, v, 1);
    const again = await openCheckout(page, v, 1);
    await expect(again.getByLabel("Họ tên")).toHaveValue(name);
    await expect(again.getByLabel("Số điện thoại")).toHaveValue("+84 912-345-678");
    await expect(again.getByLabel("Địa chỉ giao hàng")).toHaveValue(address);
    const saved = await page.evaluate(() => localStorage.getItem("shopmate:checkout-customer"));
    expect(JSON.parse(saved ?? "null")).toMatchObject({ name, address });
  });

  test("the order endpoint answers 400 with a Vietnamese message for a bad phone, an empty basket or a bad id", async ({ request }) => {
    const shopId = db ? await shopIdBySlug(SLUG) : null;
    const before = shopId ? await count("orders", shopId) : null;
    const valid = () => ({
      clientOrderId: randomUUID(),
      items: [{ productId: randomUUID(), color: "be", size: "S", quantity: 1, unitPrice: 100_000 }],
      customer: { name: `Khách ${uid("E2E")}`, phone: "0912345678", address: "12 Lê Lợi, Q1" },
    });

    // 4. API check: each bad field is refused with its own message.
    const badPhone = await request.post(ORDERS_PATH, { data: { ...valid(), customer: { ...valid().customer, phone: "123" } } });
    expect(badPhone.status()).toBe(400);
    expect((await badPhone.json()).error).toBe(MSG.phone);

    const emptyBasket = await request.post(ORDERS_PATH, { data: { ...valid(), items: [] } });
    expect(emptyBasket.status()).toBe(400);
    expect((await emptyBasket.json()).error).toBe("Giỏ hàng đang trống.");

    const badId = await request.post(ORDERS_PATH, { data: { ...valid(), clientOrderId: "nope" } });
    expect(badId.status()).toBe(400);
    expect((await badId.json()).error).toBe("Mã đơn không hợp lệ.");

    if (shopId) expect(await count("orders", shopId)).toBe(before);
  });

  test("a stale basket: a stock drop or a price change is refused, nothing is written, a new attempt gets a new id", async ({ page }) => {
    test.skip(!db, NEEDS_DB);
    test.setTimeout(120_000);
    const shopId = await shopIdBySlug(SLUG);
    const v = await pickVariant(shopId, 2);
    restores.push(() => setStock(v.variantId, v.stock));
    restores.push(() => setPrice(v.productId, v.price));
    const name = `Khách ${uid("E2E")}`;
    const sent: Array<{ clientOrderId: string; items: Array<{ unitPrice: number; quantity: number }> }> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(ORDERS_PATH)) sent.push(request.postDataJSON());
    });
    const submit = async () => {
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(ORDERS_PATH)),
        submitButton(panel).click(),
      ]);
      return response;
    };

    // 1. Add V x 2, open "Đặt hàng" and fill in valid details.
    await addToBasket(page, v, 2);
    const panel = await openCheckout(page, v, 2);
    await fillCustomer(panel, { name, phone: "0912345678", address: "12 Lê Lợi, Q1" });

    // 2. Stock drops to 1 behind the shopper's back, then submit.
    await setStock(v.variantId, 1);
    const stale = await submit();
    expect(stale.status()).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.code).toBe("out_of_stock");
    expect(staleBody.lines).toEqual([expect.objectContaining({ productId: v.productId, name: v.name, color: v.color, size: v.size })]);
    await expect(panel.getByRole("alert")).toHaveText(MSG.outOfStock);
    expect(await ordersWhere(shopId, { customer_name: name })).toHaveLength(0);
    expect(await stockOf(v.variantId)).toBe(1);
    const shopper = await shopperOfBrowser(page, shopId);
    if (shopper.conversationId) expect(await messageCount(shopper.conversationId), "a refused order posts no chat notice").toBe(0);

    // The basket reloads the catalog and shows the stock notice.
    await panel.getByRole("button", { name: "Quay lại giỏ" }).click();
    await expect(panel.getByText(`${v.name} (${displayColor(v.color)}, size ${v.size}) chỉ còn 1, đã giảm số lượng về 1.`)).toBeVisible();
    await expect(panel.getByLabel(`Số lượng ${v.name}`)).toHaveText("1");

    // 3. Stock restored, the price goes up 10 000, submit again from the open form.
    await setStock(v.variantId, v.stock);
    await setPrice(v.productId, v.price + 10_000);
    await panel.getByRole("button", { name: "Đặt hàng", exact: true }).click();
    await expect(panel.getByLabel("Họ tên")).toHaveValue(name);
    const changed = await submit();
    expect(changed.status()).toBe(409);
    expect((await changed.json()).code).toBe("price_changed");
    await expect(panel.getByRole("alert")).toHaveText(MSG.priceChanged);
    expect(sent[1].items[0].unitPrice, "the price in the request is the one the shopper saw").toBe(v.price);
    expect(sent[1].clientOrderId, "a refused attempt is not replayed").not.toBe(sent[0].clientOrderId);
    expect(await ordersWhere(shopId, { customer_name: name })).toHaveLength(0);
    if (shopper.conversationId) expect(await messageCount(shopper.conversationId)).toBe(0);

    // The next valid attempt (price back to what the basket shows) is a new order.
    await setPrice(v.productId, v.price);
    const accepted = await submit();
    expect(accepted.status()).toBe(200);
    expect(sent[2].clientOrderId).not.toBe(sent[1].clientOrderId);
    await expect(panel.getByRole("heading", { name: "Đã gửi đơn" })).toBeVisible();
    await expect.poll(async () => (await ordersWhere(shopId, { customer_name: name })).length).toBe(1);
    const [order] = await ordersWhere(shopId, { customer_name: name });
    expect(order.quote_key).toBe(`checkout:${sent[2].clientOrderId}`);
    expect(order.total).toBe(v.price * sent[2].items[0].quantity);
    expect(await stockOf(v.variantId)).toBe(v.stock);
  });

  // =====================================================================
  // Worst cases
  // =====================================================================

  test("two identical order requests at once give one order and one notice, and a replay returns the same order", async ({ playwright, baseURL }) => {
    test.skip(!db, NEEDS_DB);
    const shopId = await shopIdBySlug(SLUG);
    const v = await pickVariant(shopId, 2);
    const clientOrderId = randomUUID();
    const body = orderBody(v, `Khách ${uid("E2E")}`, clientOrderId);

    // 1. A request context per caller, so each starts without the shopper cookie.
    const contexts = await Promise.all([playwright.request.newContext({ baseURL }), playwright.request.newContext({ baseURL })]);
    try {
      const responses = await Promise.all(contexts.map((context) => context.post(ORDERS_PATH, { data: body })));
      const results = await Promise.all(responses.map(async (response) => ({ status: response.status(), json: await response.json() })));

      const winners = results.filter((result) => result.status === 200);
      expect(winners.length, JSON.stringify(results)).toBeGreaterThanOrEqual(1);
      for (const winner of winners) {
        expect(winner.json.orderId).toBe(winners[0].json.orderId);
        expect(winner.json.total).toBe(v.price);
      }
      // A losing request is refused cleanly (a JSON message), never a second order.
      for (const loser of results.filter((result) => result.status !== 200)) {
        expect(typeof (loser.json.error ?? loser.json.message)).toBe("string");
      }

      await expect.poll(async () => (await ordersWhere(shopId, { quote_key: `checkout:${clientOrderId}` })).length).toBe(1);
      const [order] = await ordersWhere(shopId, { quote_key: `checkout:${clientOrderId}` });
      expect(order.id).toBe(winners[0].json.orderId);
      await expect.poll(async () => (await systemTexts(order.conversation_id)).filter((t) => t.startsWith(NOTICE_HEAD)).length).toBe(1);

      // A third, sequential request with the first winner's cookie replays the order.
      const winnerContext = contexts[results.findIndex((result) => result.status === 200)];
      const replay = await winnerContext.post(ORDERS_PATH, { data: body });
      expect(replay.status()).toBe(200);
      const replayed = await replay.json();
      expect(replayed.orderId).toBe(order.id);
      expect(replayed.total).toBe(order.total);
      expect(await ordersWhere(shopId, { quote_key: `checkout:${clientOrderId}` })).toHaveLength(1);
      expect((await systemTexts(order.conversation_id)).filter((t) => t.startsWith(NOTICE_HEAD))).toHaveLength(1);
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });

  test("a double click on 'Gửi đơn cho shop' over a slow network sends one request and writes one order", async ({ page }) => {
    test.skip(!db, NEEDS_DB);
    test.setTimeout(90_000);
    const shopId = await shopIdBySlug(SLUG);
    const v = await pickVariant(shopId, 2);
    const name = `Khách ${uid("E2E")}`;
    let requests = 0;
    await page.route(`**${ORDERS_PATH}`, async (route) => {
      requests += 1;
      // The network is slowed by one second, so the second click lands mid-flight.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.continue();
    });

    await addToBasket(page, v, 1);
    const panel = await openCheckout(page, v, 1);
    await fillCustomer(panel, { name, phone: "0912345678", address: "12 Lê Lợi, Q1" });

    // 2. Double-click the submit button.
    await submitButton(panel).dblclick();
    await expect(panel.getByRole("heading", { name: "Đã gửi đơn" })).toBeVisible({ timeout: 30_000 });
    expect(requests).toBe(1);
    await expect.poll(async () => (await ordersWhere(shopId, { customer_name: name })).length).toBe(1);
    const [order] = await ordersWhere(shopId, { customer_name: name });
    await expect.poll(async () => (await systemTexts(order.conversation_id)).filter((t) => t.startsWith(NOTICE_HEAD)).length).toBe(1);
  });

  test("two staff confirming the same order at once decrease stock once", async ({ request, browser }) => {
    test.skip(!db, NEEDS_DB);
    test.setTimeout(120_000);
    const shopId = await shopIdBySlug(SLUG);
    const v = await pickVariant(shopId, 2);
    restores.push(() => setStock(v.variantId, v.stock));
    const name = `Khách ${uid("E2E")}`;

    // The order of step 1: one item, written through the shopper endpoint.
    const created = await request.post(ORDERS_PATH, { data: orderBody(v, name) });
    expect(created.status()).toBe(200);

    // 3. Two staff sessions open the list and confirm at the same moment.
    const staffA = await staffPage(browser);
    const staffB = await staffPage(browser);
    try {
      const [listA, listB] = await Promise.all([openDraftOrders(staffA.page), openDraftOrders(staffB.page)]);
      const cardA = draftOrderOf(listA, name);
      const cardB = draftOrderOf(listB, name);
      await expect(cardA).toHaveCount(1);
      await expect(cardB).toHaveCount(1);
      await Promise.all([
        cardA.getByRole("button", { name: "Xác nhận", exact: true }).click(),
        cardB.getByRole("button", { name: "Xác nhận", exact: true }).click(),
      ]);
      await Promise.all([
        cardA.getByRole("button", { name: "Xác nhận đơn này" }).click(),
        cardB.getByRole("button", { name: "Xác nhận đơn này" }).click(),
      ]);

      const outcome = new RegExp(`Đã xác nhận đơn của ${escapeRegExp(name)}\\.|Đơn của ${escapeRegExp(name)} đã được xử lý trước đó\\.`);
      await expect(staffA.page.getByText(outcome)).toBeVisible({ timeout: 30_000 });
      await expect(staffB.page.getByText(outcome)).toBeVisible({ timeout: 30_000 });
      const texts = await Promise.all([staffA.page, staffB.page].map((p) => p.getByText(outcome).innerText()));
      expect(texts.filter((text) => text.startsWith("Đã xác nhận đơn của")), texts.join(" | ")).toHaveLength(1);
      expect(texts.filter((text) => text.includes("đã được xử lý trước đó")), texts.join(" | ")).toHaveLength(1);

      await expect.poll(() => stockOf(v.variantId)).toBe(v.stock - 1);
      const [order] = await ordersWhere(shopId, { customer_name: name });
      expect(order.status).toBe("confirmed");
    } finally {
      await Promise.all([staffA.context.close(), staffB.context.close()]);
    }
  });

  test("an order for another shop's product is refused and writes nothing", async ({ request }) => {
    test.skip(!db, NEEDS_DB);
    const shopId = await shopIdBySlug(SLUG);
    const evalId = await shopIdBySlug(EVAL_SLUG);
    const ve = await pickVariant(evalId, 1);
    const snapshot = async () => ({
      orders: [await count("orders", shopId), await count("orders", evalId)],
      shoppers: [await count("shoppers", shopId), await count("shoppers", evalId)],
      conversations: [await count("conversations", shopId), await count("conversations", evalId)],
      messages: [await count("messages", shopId), await count("messages", evalId)],
      stock: await stockOf(ve.variantId),
    });
    const before = await snapshot();

    // 1. The eval shop's product, ordered through the demo shop's endpoint.
    const response = await request.post(ORDERS_PATH, { data: orderBody(ve, `Khách ${uid("E2E")}`) });
    expect(response.status()).toBe(409);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const json = await response.json();
    expect(json.code).toBe("unavailable");
    expect(json.message).toBe(MSG.unavailable);
    expect(json.lines).toEqual([expect.objectContaining({ productId: ve.productId, color: ve.color, size: ve.size })]);

    // Nothing was written in either shop.
    expect(await snapshot()).toEqual(before);
  });
});

// =====================================================================
// Worst cases: refusals (read-only, safe on production)
// =====================================================================

test.describe("refusals", () => {
  // Locally every refusal must leave the orders table as it was.
  async function ordersTotal(): Promise<number | null> {
    if (!db) return null;
    const { count: total, error } = await db.from("orders").select("id", { count: "exact", head: true });
    if (error) throw error;
    return total;
  }

  test("@smoke the staff order endpoint refuses a caller without a session", async ({ request }) => {
    const before = await ordersTotal();

    // 1. A valid-looking body, no session.
    const response = await request.post("/api/admin/orders", {
      data: {
        clientOrderId: randomUUID(),
        conversationId: null,
        items: [{ variantId: randomUUID(), quantity: 1, unitPrice: 100_000 }],
        customer: { name: `Khách ${uid("E2E")}`, phone: "0912345678", address: "12 Lê Lợi, Q1" },
      },
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe(MSG.notStaff);
    expect(await ordersTotal()).toBe(before);
  });

  // The 401 above comes without Cache-Control: no-store (src/app/api/admin/orders/route.ts
  // sets it only on the GET list), while the plan wants it on every order response.
  test.fail("@smoke every order response is sent with Cache-Control: no-store", async ({ request }) => {
    const response = await request.post("/api/admin/orders", {
      data: {
        clientOrderId: randomUUID(),
        conversationId: null,
        items: [{ variantId: randomUUID(), quantity: 1, unitPrice: 100_000 }],
        customer: { name: `Khách ${uid("E2E")}`, phone: "0912345678", address: "12 Lê Lợi, Q1" },
      },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  });

  test("@smoke the shopper order endpoint refuses an unknown shop, a bad phone and a body that is not JSON", async ({ request }) => {
    const before = await ordersTotal();
    const valid = () => ({
      clientOrderId: randomUUID(),
      items: [{ productId: randomUUID(), color: "be", size: "S", quantity: 1, unitPrice: 100_000 }],
      customer: { name: `Khách ${uid("E2E")}`, phone: "0912345678", address: "12 Lê Lợi, Q1" },
    });

    // 2. A shop that does not exist.
    const unknownShop = await request.post(`/api/shops/${UNKNOWN_SHOP}/orders`, { data: valid() });
    expect(unknownShop.status()).toBe(404);
    expect(unknownShop.headers()["cache-control"]).toContain("no-store");

    // 3. A bad phone, then a body that is not JSON.
    const badPhone = await request.post(ORDERS_PATH, { data: { ...valid(), customer: { ...valid().customer, phone: "123" } } });
    expect(badPhone.status()).toBe(400);
    expect((await badPhone.json()).error).toBe(MSG.phone);
    expect(badPhone.headers()["cache-control"]).toContain("no-store");

    const notJson = await request.post(ORDERS_PATH, { data: Buffer.from("not json"), headers: { "content-type": "application/json" } });
    expect(notJson.status()).toBe(400);
    expect(notJson.headers()["cache-control"]).toContain("no-store");

    expect(await ordersTotal()).toBe(before);
  });

  test("@smoke the search endpoint refuses empty, short, long and non-photo input, and an unknown shop", async ({ request }) => {
    // 4. Each answer is a 400 with its own message, in this order.
    const empty = await request.post(SEARCH_PATH, { multipart: { q: "" } });
    expect(empty.status()).toBe(400);
    expect((await empty.json()).error).toBe("Vui lòng nhập mô tả hoặc chọn ảnh.");

    const short = await request.post(SEARCH_PATH, { multipart: { q: "a" } });
    expect(short.status()).toBe(400);
    expect((await short.json()).error).toBe("Vui lòng nhập ít nhất 2 ký tự.");

    const long = await request.post(SEARCH_PATH, { multipart: { q: "a".repeat(201) } });
    expect(long.status()).toBe(400);
    expect((await long.json()).error).toBe("Mô tả tối đa 200 ký tự.");

    const notPhoto = await request.post(SEARCH_PATH, {
      multipart: { q: "", photo: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("this is not a photo") } },
    });
    expect(notPhoto.status()).toBe(400);
    expect((await notPhoto.json()).error).toBe("Chỉ gửi được ảnh JPEG, PNG hoặc WebP.");

    // 5. A shop that does not exist.
    const unknownShop = await request.post(`/api/shops/${UNKNOWN_SHOP}/search`, { multipart: { q: "váy" } });
    expect(unknownShop.status()).toBe(404);

    for (const response of [empty, short, long, notPhoto, unknownShop]) expect(response.status()).toBeLessThan(500);
  });

  test("@smoke a signed-out visitor of /admin/orders/new goes to the login page", async ({ page }) => {
    // 6. Redirect to the login page, keeping the way back.
    await page.goto("/admin/orders/new");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Forders%2Fnew/);
    await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
  });
});
