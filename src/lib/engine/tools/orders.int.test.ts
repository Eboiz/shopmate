import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseStore } from "../store";
import { FX, seedTwoShops } from "../test/two-shops";
import { createDraftOrder } from "./create-draft-order";
import { quoteOrder } from "./quote-order";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };
const customer = { customerName: "Thảo", customerPhone: "0912345678", customerAddress: "Q1" };
// Every write needs a confirmed quote (key + prices): a fresh key per call, and
// the fixture's product prices for its variants.
const PRICES: Record<string, number> = { [FX.a.vay01MBe]: 350000, [FX.a.vay01LBe]: 350000 };
const confirmed = (items: { variantId: string }[]) => ({
  ...ctxA,
  order: {
    quoteKey: randomUUID(),
    expectedPrices: items.map(({ variantId }) => ({ variantId, unitPrice: PRICES[variantId] ?? 0 })),
  },
});

async function count(table: "orders" | "order_items", shopId: string) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("shop_id", shopId);
  if (error) throw error;
  return count;
}
const counts = async () => ({
  ordersA: await count("orders", FX.a.shop),
  itemsA: await count("order_items", FX.a.shop),
  ordersB: await count("orders", FX.b.shop),
  itemsB: await count("order_items", FX.b.shop),
});

describe("quote_order", () => {
  beforeAll(() => seedTwoShops(db));

  it("prices every line from the database", async () => {
    const out = await quoteOrder(
      {
        items: [
          { variantId: FX.a.vay01MBe, quantity: 2 },
          { variantId: FX.a.ao03STrang, quantity: 1 },
        ],
      },
      ctxA,
      db,
    );
    expect(out.total).toBe(950000);
    expect(out.lines).toEqual([
      {
        variantId: FX.a.vay01MBe,
        productId: FX.a.vay01,
        name: "Váy suông linen",
        size: "M",
        color: "be",
        quantity: 2,
        unitPrice: 350000,
        lineTotal: 700000,
      },
      {
        variantId: FX.a.ao03STrang,
        productId: FX.a.ao03,
        name: "Áo sơ mi trắng",
        size: "S",
        color: "trắng",
        quantity: 1,
        unitPrice: 250000,
        lineTotal: 250000,
      },
    ]);
  });

  it("merges repeated variants", async () => {
    const out = await quoteOrder(
      {
        items: [
          { variantId: FX.a.vay01MBe, quantity: 1 },
          { variantId: FX.a.vay01MBe, quantity: 1 },
        ],
      },
      ctxA,
      db,
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].quantity).toBe(2);
    expect(out.total).toBe(700000);
  });

  it("does not price another shop's variant", async () => {
    await expect(quoteOrder({ items: [{ variantId: FX.b.vay01MBe, quantity: 1 }] }, ctxA, db)).rejects.toMatchObject({
      code: "variant_not_found",
    });
  });
});

describe("create_draft_order", () => {
  beforeEach(() => seedTwoShops(db));

  it("creates a draft order without taking stock", async () => {
    const out = await createDraftOrder({ items: [{ variantId: FX.a.vay01MBe, quantity: 2 }], ...customer }, confirmed([{ variantId: FX.a.vay01MBe }]), db);
    expect(out).toMatchObject({ status: "created", total: 700000 });
    if (out.status !== "created") throw new Error("not created");

    const { data: order } = await db.from("orders").select("*").eq("id", out.orderId).single();
    expect(order).toMatchObject({ shop_id: FX.a.shop, conversation_id: FX.a.conversation, status: "draft", total: 700000 });
    const { data: items } = await db.from("order_items").select("*").eq("order_id", out.orderId);
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ variant_id: FX.a.vay01MBe, quantity: 2, unit_price: 350000 });
    const { data: variant } = await db.from("variants").select("stock").eq("id", FX.a.vay01MBe).single();
    expect(variant?.stock).toBe(2);
  });

  it("refuses a sold-out variant and writes nothing", async () => {
    const before = await counts();
    expect(await createDraftOrder({ items: [{ variantId: FX.a.vay01LBe, quantity: 1 }], ...customer }, confirmed([{ variantId: FX.a.vay01LBe }]), db)).toEqual({
      status: "out_of_stock",
      variantIds: [FX.a.vay01LBe],
    });
    expect(await counts()).toEqual(before);
  });

  it("checks stock after merging repeats", async () => {
    const out = await createDraftOrder(
      {
        items: [
          { variantId: FX.a.vay01MBe, quantity: 1 },
          { variantId: FX.a.vay01MBe, quantity: 2 },
        ],
        ...customer,
      },
      confirmed([{ variantId: FX.a.vay01MBe }]),
      db,
    );
    expect(out).toEqual({ status: "out_of_stock", variantIds: [FX.a.vay01MBe] });
  });

  it("refuses another shop's variant", async () => {
    const before = await counts();
    await expect(
      createDraftOrder({ items: [{ variantId: FX.b.vay01MBe, quantity: 1 }], ...customer }, confirmed([{ variantId: FX.b.vay01MBe }]), db),
    ).rejects.toMatchObject({ code: "variant_not_found" });
    expect(await counts()).toEqual(before);
  });

  it("writes nothing when the last item belongs to another shop", async () => {
    const before = await counts();
    await expect(
      createDraftOrder(
        {
          items: [
            { variantId: FX.a.vay01MBe, quantity: 1 },
            { variantId: FX.b.vay01MBe, quantity: 1 },
          ],
          ...customer,
        },
        confirmed([{ variantId: FX.a.vay01MBe }, { variantId: FX.b.vay01MBe }]),
        db,
      ),
    ).rejects.toMatchObject({ code: "variant_not_found" });
    expect(await counts()).toEqual(before);
  });

  it("needs a conversation", async () => {
    await expect(
      createDraftOrder(
        { items: [{ variantId: FX.a.vay01MBe, quantity: 1 }], ...customer },
        { shopId: FX.a.shop, conversationId: null },
        db,
      ),
    ).rejects.toMatchObject({ code: "no_conversation" });
  });

  it("refuses a write without a confirmed quote and writes nothing", async () => {
    const before = await counts();
    await expect(
      createDraftOrder({ items: [{ variantId: FX.a.vay01MBe, quantity: 1 }], ...customer }, ctxA, db),
    ).rejects.toMatchObject({ code: "quote_required" });
    expect(await counts()).toEqual(before);
  });

  it("refuses an unknown variant id", async () => {
    await expect(
      createDraftOrder({ items: [{ variantId: randomUUID(), quantity: 1 }], ...customer }, confirmed([]), db),
    ).rejects.toMatchObject({ code: "variant_not_found" });
  });

  describe("with the confirmed quote (ctx.order)", () => {
    const quoteCtx = (quoteKey: string, unitPrice = 350000) => ({
      shopId: FX.a.shop,
      conversationId: FX.a.conversation,
      order: {
        quoteKey,
        expectedPrices: [{ variantId: FX.a.vay01MBe, unitPrice }],
      },
    });
    const items = [{ variantId: FX.a.vay01MBe, quantity: 2 }];

    it("replays the same quote key as the same order", async () => {
      const ctx = quoteCtx("pb-quote-replay");
      const first = await createDraftOrder({ items, ...customer }, ctx, db);
      const second = await createDraftOrder({ items, ...customer }, ctx, db);
      if (first.status !== "created" || second.status !== "created") throw new Error("not created");
      expect(second.orderId).toBe(first.orderId);
      const { count } = await db
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", FX.a.conversation);
      expect(count).toBe(1);
    });

    it("lets three concurrent confirmations of one quote produce one order", async () => {
      const ctx = quoteCtx("pb-quote-concurrent");
      const out = await Promise.all(
        Array.from({ length: 3 }, () => createDraftOrder({ items, ...customer }, ctx, db)),
      );
      const orderIds = out.map((r) => (r.status === "created" ? r.orderId : null));
      expect(new Set(orderIds)).toHaveLength(1);
      const { data: order } = await db
        .from("orders")
        .select("*", { count: "exact" })
        .eq("conversation_id", FX.a.conversation)
        .single();
      if (!order) throw new Error("no order");
      expect(order).toMatchObject({ status: "draft", total: 700000 });
      const { data: itemsRows } = await db.from("order_items").select("*").eq("order_id", order.id);
      expect(itemsRows).toHaveLength(1);
      expect(itemsRows?.[0]).toMatchObject({ variant_id: FX.a.vay01MBe, quantity: 2, unit_price: 350000 });
    });

    it("finds the order written under a quote key, and nothing for an unused or other-shop key", async () => {
      const store = createSupabaseStore(db);
      const ctx = quoteCtx("pb-quote-lookup");
      const out = await createDraftOrder({ items, ...customer }, ctx, db);
      if (out.status !== "created") throw new Error("not created");
      expect(await store.orderForQuote!(ctxA, "pb-quote-lookup", false)).toEqual({ status: "created", orderId: out.orderId, total: 700000 });
      expect(await store.orderForQuote!(ctxA, "pb-quote-unused", false)).toBeNull();
      expect(await store.orderForQuote!({ shopId: FX.b.shop, conversationId: FX.a.conversation }, "pb-quote-lookup", false)).toBeNull();
    });

    it("a quote superseded before its create starts is never written (#1)", async () => {
      const store = createSupabaseStore(db);
      const before = await counts();
      expect(await store.orderForQuote!(ctxA, "pb-quote-superseded", true)).toBeNull();
      expect(await createDraftOrder({ items, ...customer }, quoteCtx("pb-quote-superseded"), db)).toEqual({ status: "price_changed" });
      expect(await counts()).toEqual(before);
      // A lookup without supersede leaves the quote usable.
      expect(await store.orderForQuote!(ctxA, "pb-quote-retry", false)).toBeNull();
      expect(await createDraftOrder({ items, ...customer }, quoteCtx("pb-quote-retry"), db)).toMatchObject({ status: "created" });
    });

    it("writes nothing when a product price changed after the quote", async () => {
      const before = await counts();
      await db.from("products").update({ price: 400000 }).eq("id", FX.a.vay01);
      const ctx = quoteCtx("pb-quote-stale");
      expect(await createDraftOrder({ items, ...customer }, ctx, db)).toEqual({ status: "price_changed" });
      expect(await counts()).toEqual(before);
    });

    it("creates the order when the confirmed prices still match", async () => {
      await db.from("products").update({ price: 400000 }).eq("id", FX.a.vay01);
      const ctx = quoteCtx("pb-quote-fresh", 400000);
      const out = await createDraftOrder({ items, ...customer }, ctx, db);
      if (out.status !== "created") throw new Error("not created");
      expect(out).toMatchObject({ status: "created", total: 800000 });
      const { data: order } = await db.from("orders").select("*").eq("id", out.orderId).single();
      expect(order).toMatchObject({ quote_key: "pb-quote-fresh", total: 800000 });
      const { data: itemsRows } = await db.from("order_items").select("*").eq("order_id", out.orderId);
      expect(itemsRows?.[0]).toMatchObject({ unit_price: 400000 });
    });
  });
});
