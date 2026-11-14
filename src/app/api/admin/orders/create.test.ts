import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualOrderResult } from "@/lib/orders/manual-order";

// POST /api/admin/orders: an order staff type in, with or without a conversation.

const VARIANT = "a0000000-0000-4000-8000-000000000071";
const ORDER = "a0000000-0000-4000-8000-000000000011";
const CONVERSATION = "a0000000-0000-4000-8000-000000000031";
const CLIENT_ORDER = "b0000000-0000-4000-8000-000000000002";

let signedIn = true;
let conversationFound = true;
function userDb() {
  const query = {
    select: () => query,
    eq: () => query,
    in: async () => ({ data: [{ id: VARIANT, color: "be", size: "M", products: { name: "Váy linen" } }], error: null }),
    maybeSingle: async () => ({ data: conversationFound ? { id: CONVERSATION } : null, error: null }),
  };
  return { from: () => query };
}
vi.mock("@/lib/staff-api", () => ({
  staffSession: async () => (signedIn ? { db: userDb(), staff: { userId: "u1", shopId: "shop-a", role: "staff" } } : null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/orders/draft-orders", () => ({ listDraftOrders: async () => [] }));
vi.mock("server-only", () => ({}));

const ensureCalls: Record<string, unknown>[] = [];
const placeCalls: Record<string, unknown>[] = [];
let result: ManualOrderResult = { status: "created", orderId: ORDER, total: 700000, replayed: false };
vi.mock("@/lib/orders/manual-order", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/orders/manual-order")>()),
  ensureConversation: async (_db: unknown, input: Record<string, unknown>) => {
    ensureCalls.push(input);
    return "staff-conv";
  },
  placeManualOrder: async (_db: unknown, input: Record<string, unknown>) => {
    placeCalls.push(input);
    return result;
  },
}));
const sent: unknown[][] = [];
vi.mock("@/lib/channels/send", () => ({
  sendToConversation: async (...args: unknown[]) => {
    sent.push(args);
    return { ok: true, messageId: "m1" };
  },
}));

const { POST } = await import("./route");
const ordersData = await import("@/app/admin/orders/orders-data");

const body = (over: Record<string, unknown> = {}) => ({
  clientOrderId: CLIENT_ORDER,
  conversationId: null,
  items: [{ variantId: VARIANT, quantity: 2, unitPrice: 350000 }],
  customer: { name: "Thảo", phone: "0912345678", address: "12 Lê Lợi" },
  ...over,
});
const post = (data: unknown) =>
  POST(new NextRequest("http://localhost/api/admin/orders", { method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  signedIn = true;
  conversationFound = true;
  result = { status: "created", orderId: ORDER, total: 700000, replayed: false };
  ensureCalls.length = 0;
  placeCalls.length = 0;
  sent.length = 0;
});

describe("POST /api/admin/orders", () => {
  it("without a conversation, makes a staff-mode thread named after the customer", async () => {
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orderId: ORDER, total: 700000, conversationId: "staff-conv" });
    expect(ensureCalls[0]).toEqual({ shopId: "shop-a", externalId: `staff-order:${CLIENT_ORDER}`, displayName: "Thảo", mode: "staff" });
    expect(placeCalls[0]).toMatchObject({ shopId: "shop-a", conversationId: "staff-conv", quoteKey: `staff:${CLIENT_ORDER}` });
    expect(sent).toHaveLength(0);
  });

  it("for an inbox conversation, writes into it and tells the shopper", async () => {
    const response = await post(body({ conversationId: CONVERSATION }));
    expect(response.status).toBe(200);
    expect(ensureCalls).toHaveLength(0);
    expect(placeCalls[0]).toMatchObject({ conversationId: CONVERSATION });
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(CONVERSATION);
    expect((sent[0][1] as { text: string }).text).toContain("Váy linen (be, size M) × 2");
  });

  it("answers 404 for a conversation outside the shop", async () => {
    conversationFound = false;
    expect((await post(body({ conversationId: CONVERSATION }))).status).toBe(404);
    expect(placeCalls).toHaveLength(0);
  });

  it("answers 401 signed out, 400 on bad input, 409 on stock", async () => {
    signedIn = false;
    expect((await post(body())).status).toBe(401);
    signedIn = true;
    expect((await post(body({ items: [] }))).status).toBe(400);
    result = { status: "out_of_stock", variantIds: [VARIANT] };
    const response = await post(body());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "out_of_stock", variantIds: [VARIANT] });
  });

  it("is read by the page's client: success and refusal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementationOnce(async () => post(body()));
    await expect(ordersData.createManualOrder({ ...body(), conversationId: null })).resolves.toMatchObject({ ok: true, orderId: ORDER });
    result = { status: "price_changed" };
    fetchMock.mockImplementationOnce(async () => post(body()));
    const refused = await ordersData.createManualOrder({ ...body(), conversationId: null });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok === false && refused.message).toContain("Giá sản phẩm vừa thay đổi");
    fetchMock.mockRestore();
  });
});
