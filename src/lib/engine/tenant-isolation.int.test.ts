import { beforeEach, describe, expect, it } from "vitest";
import type { ToolName } from "@/contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeTool } from "./execute-tool";
import { FX, seedTwoShops } from "./test/two-shops";
import { toolHandlers } from "./tools";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };
const customer = { customerName: "Thảo", customerPhone: "0912345678", customerAddress: "Q1" };

async function orderCount(shopId: string) {
  const { count } = await db.from("orders").select("*", { count: "exact", head: true }).eq("shop_id", shopId);
  return count;
}
async function modeOf(id: string) {
  const { data } = await db.from("conversations").select("mode").eq("id", id).single();
  return data?.mode;
}
const run = (name: ToolName, input: unknown, ctx = ctxA) => executeTool(name, input, ctx, "customer", toolHandlers, db);
const errorOf = (content: string) => JSON.parse(content).error;

describe("shop A's tools never reach shop B", () => {
  beforeEach(() => seedTwoShops(db));

  it("every tool, pointed at shop B's ids", async () => {
    const ordersB = await orderCount(FX.b.shop);
    const runs = {
      search_products: await run("search_products", { query: "vay" }),
      get_stock: await run("get_stock", { productId: FX.b.vay01 }),
      recommend_size: await run("recommend_size", { productId: FX.b.vay01, heightCm: 170, weightKg: 60 }),
      get_pairings: await run("get_pairings", { productId: FX.b.vay01 }),
      get_policy: await run("get_policy", { kind: "doi_tra" }),
      quote_order: await run("quote_order", { items: [{ variantId: FX.b.vay01MBe, quantity: 1 }] }),
      create_draft_order: await run("create_draft_order", {
        items: [{ variantId: FX.b.vay01MBe, quantity: 1 }],
        ...customer,
      }),
      handoff_to_staff: await run("handoff_to_staff", { reason: "complaint" }),
    } satisfies Record<ToolName, unknown>;

    for (const [name, r] of Object.entries(runs)) {
      for (const leak of [...Object.values(FX.b), "420000", "Shop B"]) {
        expect(r.content, `${name} leaked ${leak}`).not.toContain(leak);
      }
    }
    expect(JSON.parse(runs.search_products.content).products.map((p: { productId: string }) => p.productId)).toEqual([
      FX.a.vay01,
    ]);
    expect(errorOf(runs.get_stock.content)).toBe("product_not_found");
    expect(errorOf(runs.recommend_size.content)).toBe("product_not_found");
    expect(JSON.parse(runs.get_pairings.content)).toEqual({ pairings: [] });
    expect(errorOf(runs.quote_order.content)).toBe("variant_not_found");
    expect(errorOf(runs.create_draft_order.content)).toBe("variant_not_found");
    expect(JSON.parse(runs.get_policy.content).content).toBe("Đổi trong 7 ngày");

    expect(await orderCount(FX.b.shop)).toBe(ordersB);
    expect(await modeOf(FX.b.conversation)).toBe("ai");
  });

  describe("a server-side ctx bug pointing at shop B's conversation", () => {
    const skewed = { shopId: FX.a.shop, conversationId: FX.b.conversation };

    it("handoff_to_staff leaves B's conversation in mode ai", async () => {
      expect(await modeOf(FX.b.conversation)).toBe("ai");
      const r = await run("handoff_to_staff", { reason: "complaint" }, skewed);
      expect(r.isError).toBe(false);
      expect(await modeOf(FX.b.conversation)).toBe("ai");
    });

    it("create_draft_order fails as a tool error and writes nothing", async () => {
      expect(await modeOf(FX.b.conversation)).toBe("ai");
      const before = [await orderCount(FX.a.shop), await orderCount(FX.b.shop)];
      const r = await run(
        "create_draft_order",
        { items: [{ variantId: FX.a.vay01MBe, quantity: 1 }], ...customer },
        skewed,
      );
      expect(r.isError).toBe(true);
      expect(r.content).not.toContain('"created"');
      expect([await orderCount(FX.a.shop), await orderCount(FX.b.shop)]).toEqual(before);
    });
  });
});
