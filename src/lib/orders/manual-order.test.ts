import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { customerSchema, normalizePhone, orderPlacedMessage, placeManualOrder } = await import("./manual-order");

const customer = { name: "Thảo", phone: "0912345678", address: "12 Lê Lợi, Q1" };

describe("customer details", () => {
  it("accepts phones written with spaces, dots or +84", () => {
    expect(normalizePhone("0912 345 678")).toBe("0912345678");
    expect(normalizePhone("0912.345.678")).toBe("0912345678");
    expect(normalizePhone("+84912345678")).toBe("0912345678");
    expect(customerSchema.parse({ name: "  Thảo ", phone: "+84 912-345-678", address: " Q1 " })).toEqual({ name: "Thảo", phone: "0912345678", address: "Q1" });
  });

  it("refuses a short phone, an empty name or address, in Vietnamese", () => {
    const result = customerSchema.safeParse({ name: " ", phone: "091234", address: "" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((issue) => issue.message);
    expect(messages).toContain("Vui lòng nhập họ tên.");
    expect(messages).toContain("Số điện thoại gồm 10 số, bắt đầu bằng 0.");
    expect(messages).toContain("Vui lòng nhập địa chỉ giao hàng.");
  });
});

describe("orderPlacedMessage", () => {
  it("lists the lines, the total and where it goes", () => {
    const reply = orderPlacedMessage("shopper", [{ name: "Váy linen", color: "be", size: "M", quantity: 2, unitPrice: 350000 }], 700000, customer);
    expect(reply.text).toContain("Đã nhận đơn đặt hàng của bạn");
    expect(reply.text).toContain("Váy linen (be, size M) × 2");
    expect(reply.text).toContain("12 Lê Lợi, Q1");
    expect(orderPlacedMessage("staff", [], 0, customer).text).toContain("Shop đã tạo đơn hàng cho bạn");
  });

  it("stays within the 1000 characters a reply holds", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ name: `Áo sơ mi dài tay cổ trụ kiểu Hàn Quốc mẫu số ${i}`, color: "xanh navy", size: "XXL", quantity: 9, unitPrice: 990000 }));
    const reply = orderPlacedMessage("shopper", lines, 178200000, { ...customer, address: "x".repeat(300) });
    expect(reply.text.length).toBeLessThanOrEqual(1000);
    expect(reply.text).toContain("180 sản phẩm (20 món)");
  });
});

// A fake client: orders lookup, then the RPC.
function fakeDb(existing: { id: string; total: number } | null, rpc: { data?: unknown; error?: { message: string } | null }) {
  const calls: { rpc?: Record<string, unknown> } = {};
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: existing, error: null }),
  };
  const db = {
    from: () => query,
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.rpc = args;
      return { data: rpc.data ?? null, error: rpc.error ?? null };
    },
  };
  return { db: db as never, calls };
}

const VARIANT = "a0000000-0000-4000-8000-000000000071";
const ORDER = "a0000000-0000-4000-8000-000000000011";
const input = {
  shopId: "shop-a",
  conversationId: "conv-1",
  quoteKey: "checkout:k1",
  lines: [{ variantId: VARIANT, quantity: 2, unitPrice: 350000 }],
  customer,
};

describe("placeManualOrder", () => {
  it("writes through the RPC with the prices the person saw", async () => {
    const { db, calls } = fakeDb(null, { data: { status: "created", orderId: ORDER, total: 700000 } });
    await expect(placeManualOrder(db, input)).resolves.toEqual({ status: "created", orderId: ORDER, total: 700000, replayed: false });
    expect(calls.rpc).toMatchObject({
      p_shop_id: "shop-a",
      p_quote_key: "checkout:k1",
      p_items: [{ variantId: VARIANT, quantity: 2 }],
      p_expected_prices: [{ variantId: VARIANT, unitPrice: 350000 }],
      p_customer_phone: "0912345678",
    });
  });

  it("returns an order already written for the same key without calling the RPC", async () => {
    const { db, calls } = fakeDb({ id: ORDER, total: 700000 }, {});
    await expect(placeManualOrder(db, input)).resolves.toEqual({ status: "created", orderId: ORDER, total: 700000, replayed: true });
    expect(calls.rpc).toBeUndefined();
  });

  it("passes stock and price refusals through", async () => {
    expect(await placeManualOrder(fakeDb(null, { data: { status: "out_of_stock", variantIds: [VARIANT] } }).db, input)).toEqual({ status: "out_of_stock", variantIds: [VARIANT] });
    expect(await placeManualOrder(fakeDb(null, { data: { status: "price_changed" } }).db, input)).toEqual({ status: "price_changed" });
    expect(await placeManualOrder(fakeDb(null, { error: { message: "variant_not_found" } }).db, input)).toEqual({ status: "variant_not_found" });
    await expect(placeManualOrder(fakeDb(null, { error: { message: "boom" } }).db, input)).rejects.toThrow("boom");
  });
});
