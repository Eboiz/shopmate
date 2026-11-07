import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "../test/two-shops";
import { createDraftOrder } from "./create-draft-order";
import { quoteOrder } from "./quote-order";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };
const customer = { customerName: "Thảo", customerPhone: "0912345678", customerAddress: "Q1" };

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
    const out = await createDraftOrder({ items: [{ variantId: FX.a.vay01MBe, quantity: 2 }], ...customer }, ctxA, db);
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
    expect(await createDraftOrder({ items: [{ variantId: FX.a.vay01LBe, quantity: 1 }], ...customer }, ctxA, db)).toEqual({
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
      ctxA,
      db,
    );
    expect(out).toEqual({ status: "out_of_stock", variantIds: [FX.a.vay01MBe] });
  });

  it("refuses another shop's variant", async () => {
    const before = await counts();
    await expect(
      createDraftOrder({ items: [{ variantId: FX.b.vay01MBe, quantity: 1 }], ...customer }, ctxA, db),
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
        ctxA,
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

  it("refuses an unknown variant id", async () => {
    await expect(
      createDraftOrder({ items: [{ variantId: randomUUID(), quantity: 1 }], ...customer }, ctxA, db),
    ).rejects.toMatchObject({ code: "variant_not_found" });
  });
});
