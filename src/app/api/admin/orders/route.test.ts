import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { PATCH } from "./[id]/route";

const db = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(),
  rpc: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ ...db, auth: { getUser: db.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: db.rpc }) }));
vi.mock("@/lib/channels/send", () => ({ sendToConversation: db.send }));

const staffId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
const conversationId = "30000000-0000-4000-8000-000000000001";
const ordersUrl = "https://example.test/api/admin/orders";

function patch(body: object, id = orderId) {
  return PATCH(new Request(`${ordersUrl}/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.getUser.mockResolvedValue({ data: { user: { id: staffId } } });
  db.from.mockReturnValue({ select: db.select });
  db.select.mockReturnValue({ eq: db.eq });
  db.eq.mockReturnValue({ order: db.order });
  db.rpc.mockResolvedValue({ data: conversationId, error: null });
  db.send.mockResolvedValue({ ok: true, messageId: "message" });
});

describe("admin order routes", () => {
  it("returns draft orders from the session client with their original unit prices", async () => {
    db.order.mockResolvedValue({ error: null, data: [{
      id: orderId, created_at: "2026-11-06T00:00:00+00:00", total: 80000,
      customer_name: "Lan", customer_phone: "0900000000", customer_address: "Đà Nẵng",
      order_items: [{ id: "item", quantity: 2, unit_price: 40000, variants: { size: "M", color: "Đỏ", products: { name: "Áo" } } }],
    }] });

    const response = await GET(new Request(`${ordersUrl}?status=draft`));

    expect(db.from).toHaveBeenCalledWith("orders");
    expect(db.eq).toHaveBeenCalledWith("status", "draft");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ orders: [{
      id: orderId, createdAt: "2026-11-06T00:00:00+00:00", total: 80000,
      customer: { name: "Lan", phone: "0900000000", address: "Đà Nẵng" },
      items: [{ id: "item", quantity: 2, unitPrice: 40000, size: "M", color: "Đỏ", name: "Áo" }],
    }] });
  });

  it("rejects unauthenticated reads and writes", async () => {
    db.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(new Request(ordersUrl))).status).toBe(401);
    expect((await patch({ status: "confirmed" })).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied shop or staff identifier", async () => {
    expect((await patch({ status: "confirmed", staffId })).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(["confirmed", "cancelled"])("sends a system reply only after the order is %s", async (status) => {
    const response = await patch({ status });
    expect(db.rpc).toHaveBeenCalledWith("decide_draft_order", {
      p_order_id: orderId, p_staff_id: staffId, p_status: status,
    });
    expect(db.send).toHaveBeenCalledWith(conversationId, {
      text: expect.stringContaining(status === "confirmed" ? "xác nhận" : "hủy"), products: [], quickReplies: [],
    }, { from: "system" });
    expect(db.rpc.mock.invocationCallOrder[0]).toBeLessThan(db.send.mock.invocationCallOrder[0]);
    expect(await response.json()).toEqual({ ok: true, notificationSent: true });
  });

  it.each([
    ["PT409", "not_draft", 409],
    ["PT409", "insufficient_stock", 409],
    ["PT404", "order_not_found", 404],
    ["PT403", "staff_required", 403],
  ])("does not send a system reply on %s / %s", async (code, message, status) => {
    db.rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await patch({ status: "confirmed" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code: message });
    expect(db.send).not.toHaveBeenCalled();
  });

  it("reports delivery failure without treating the committed order as failed", async () => {
    db.send.mockResolvedValue({ ok: false, messageId: "stored", error: "delivery failed" });
    const response = await patch({ status: "confirmed" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, notificationSent: false });
  });
});
