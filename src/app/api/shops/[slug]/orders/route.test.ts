import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualOrderResult } from "@/lib/orders/manual-order";

// Checkout from the basket: validation, variant lookup by product/color/size,
// the idempotency key, the chat notice and the visitor cookie.

const PRODUCT = "a0000000-0000-4000-8000-000000000021";
const VARIANT = "a0000000-0000-4000-8000-000000000071";
const ORDER = "a0000000-0000-4000-8000-000000000011";
const CLIENT_ORDER = "b0000000-0000-4000-8000-000000000001";

let shop: { id: string; name: string } | null = { id: "shop-a", name: "Hạnh" };
let limit = "ok";
let hasCookie = false;
vi.mock("@/lib/chat/web-chat", () => ({
  SHOPPER_COOKIE: "shopmate_shopper",
  SHOPPER_COOKIE_MAX_AGE: 100,
  SHOPPER_COOKIE_PATH: "/api/shops",
  findShop: async () => shop,
  newShopperToken: () => "new-token",
  readShopperToken: (value: string | undefined) => (value ? "old-token" : null),
  shopperExternalId: (token: string) => `ext:${token}`,
}));
vi.mock("@/lib/guard/web-chat-limit", () => ({
  WEB_CHAT_LIMIT_ERROR: { client: "Chậm lại nhé" },
  clientHash: () => "h",
  clientIp: () => "1.1.1.1",
  takeWebChatSlot: async () => limit,
}));

const variants = [{ id: VARIANT, color: "be", size: "M", product_id: PRODUCT, products: { name: "Váy linen" } }];
vi.mock("@/lib/supabase/admin", () => {
  const query = { select: () => query, eq: () => query, in: async () => ({ data: variants, error: null }) };
  return { createAdminClient: () => ({ from: () => query }) };
});

const placeCalls: Record<string, unknown>[] = [];
const ensureCalls: Record<string, unknown>[] = [];
let result: ManualOrderResult = { status: "created", orderId: ORDER, total: 700000, replayed: false };
vi.mock("@/lib/orders/manual-order", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/orders/manual-order")>()),
  ensureConversation: async (_db: unknown, input: Record<string, unknown>) => {
    ensureCalls.push(input);
    return "conv-1";
  },
  placeManualOrder: async (_db: unknown, input: Record<string, unknown>) => {
    placeCalls.push(input);
    return result;
  },
}));
vi.mock("server-only", () => ({}));
const sent: unknown[][] = [];
vi.mock("@/lib/channels/send", () => ({
  sendToConversation: async (...args: unknown[]) => {
    sent.push(args);
    return { ok: true, messageId: "m1" };
  },
}));

const { POST } = await import("./route");

const body = (over: Record<string, unknown> = {}) => ({
  clientOrderId: CLIENT_ORDER,
  items: [{ productId: PRODUCT, color: "be", size: "M", quantity: 2, unitPrice: 350000 }],
  customer: { name: "Thảo", phone: "0912 345 678", address: "12 Lê Lợi" },
  ...over,
});
const post = (data: unknown) =>
  POST(
    new NextRequest("http://localhost/api/shops/hanh/orders", {
      method: "POST",
      body: JSON.stringify(data),
      headers: { "content-type": "application/json", ...(hasCookie ? { cookie: "shopmate_shopper=x" } : {}) },
    }),
    { params: Promise.resolve({ slug: "hanh" }) },
  );

beforeEach(() => {
  shop = { id: "shop-a", name: "Hạnh" };
  limit = "ok";
  hasCookie = false;
  result = { status: "created", orderId: ORDER, total: 700000, replayed: false };
  placeCalls.length = 0;
  ensureCalls.length = 0;
  sent.length = 0;
});

describe("POST /api/shops/[slug]/orders", () => {
  it("writes the draft order, notes it in the chat and gives a new visitor the cookie", async () => {
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orderId: ORDER, total: 700000 });
    expect(ensureCalls[0]).toEqual({ shopId: "shop-a", externalId: "ext:new-token", displayName: "Thảo" });
    expect(placeCalls[0]).toMatchObject({
      shopId: "shop-a",
      conversationId: "conv-1",
      quoteKey: `checkout:${CLIENT_ORDER}`,
      lines: [{ variantId: VARIANT, quantity: 2, unitPrice: 350000 }],
      customer: { phone: "0912345678" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0][2]).toEqual({ from: "system" });
    expect(response.headers.get("set-cookie")).toContain("shopmate_shopper=new-token");
  });

  it("does not send the chat notice again for a replayed checkout", async () => {
    hasCookie = true;
    result = { status: "created", orderId: ORDER, total: 700000, replayed: true };
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a line whose color or size the shop does not have", async () => {
    const response = await post(body({ items: [{ productId: PRODUCT, color: "đen", size: "M", quantity: 1, unitPrice: 350000 }] }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("unavailable");
    expect(placeCalls).toHaveLength(0);
  });

  it("answers 409 with the short lines when stock ran out, and price_changed as such", async () => {
    result = { status: "out_of_stock", variantIds: [VARIANT] };
    let response = await post(body());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "out_of_stock", lines: [{ name: "Váy linen", color: "be", size: "M" }] });

    result = { status: "price_changed" };
    response = await post(body());
    expect((await response.json()).code).toBe("price_changed");
    expect(sent).toHaveLength(0);
  });

  it("checks the input before touching the shop", async () => {
    expect((await post(body({ customer: { name: "Thảo", phone: "123", address: "Q1" } }))).status).toBe(400);
    expect((await post(body({ items: [] }))).status).toBe(400);
    expect((await post(body({ clientOrderId: "nope" }))).status).toBe(400);
    expect(placeCalls).toHaveLength(0);
  });

  it("answers 404 for an unknown shop and 429 over the limit", async () => {
    shop = null;
    expect((await post(body())).status).toBe(404);
    shop = { id: "shop-a", name: "Hạnh" };
    limit = "client";
    expect((await post(body())).status).toBe(429);
  });
});
