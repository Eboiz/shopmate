import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseStore } from "../store";
import { FX, seedTwoShops } from "../test/two-shops";
import { getPolicy } from "./get-policy";
import { searchProducts } from "./search-products";

// PB-35a: an active learned fact reaches the AI on the next turn, a pending or
// removed one never does, and one shop's facts never reach another shop.
const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };
const ctxB = { shopId: FX.b.shop, conversationId: FX.b.conversation };

async function addFact(row: { shop_id: string; text: string; status: "active" | "pending" | "removed"; policy_kind?: "doi_tra" | "giao_hang"; product_id?: string }) {
  const { error } = await db.from("learned_facts").insert(row);
  if (error) throw new Error(error.message);
}

describe("learned facts in get_policy and product descriptions", () => {
  beforeAll(() => seedTwoShops(db));
  afterEach(async () => {
    await db.from("learned_facts").delete().in("shop_id", [FX.a.shop, FX.b.shop]);
  });

  it("appends active facts of that kind to the shop's policy", async () => {
    await addFact({ shop_id: FX.a.shop, policy_kind: "doi_tra", text: "Hàng sale không đổi.", status: "active" });
    await addFact({ shop_id: FX.a.shop, policy_kind: "doi_tra", text: "Đang chờ duyệt.", status: "pending" });
    await addFact({ shop_id: FX.a.shop, policy_kind: "doi_tra", text: "Đã gỡ.", status: "removed" });
    expect(await getPolicy({ kind: "doi_tra" }, ctxA, db)).toEqual({ kind: "doi_tra", content: "Đổi trong 7 ngày\nHàng sale không đổi." });
  });

  it("answers from learned facts when the shop wrote no policy of that kind", async () => {
    await addFact({ shop_id: FX.a.shop, policy_kind: "giao_hang", text: "Shop có cho kiểm hàng trước khi nhận.", status: "active" });
    expect(await getPolicy({ kind: "giao_hang" }, ctxA, db)).toEqual({ kind: "giao_hang", content: "Shop có cho kiểm hàng trước khi nhận." });
  });

  it("never gives one shop's facts to another", async () => {
    await addFact({ shop_id: FX.a.shop, policy_kind: "doi_tra", text: "Hàng sale không đổi.", status: "active" });
    expect(await getPolicy({ kind: "doi_tra" }, ctxB, db)).toEqual({ kind: "doi_tra", content: "Shop B không đổi trả" });
  });

  it("appends active product facts to that product's description only", async () => {
    await addFact({ shop_id: FX.a.shop, product_id: FX.a.vay01, text: "Vải linen, không co giãn.", status: "active" });
    await addFact({ shop_id: FX.a.shop, product_id: FX.a.vay01, text: "Chờ duyệt.", status: "pending" });
    const { products } = await searchProducts({ query: "váy suông linen", limit: 5 }, ctxA, db);
    const vay = products.find((p) => p.productId === FX.a.vay01);
    expect(vay?.description?.endsWith("Vải linen, không co giãn.")).toBe(true);
    expect(vay?.description).not.toContain("Chờ duyệt.");
    const store = createSupabaseStore(db);
    const ctx = await store.loadTurnContext({ conversationId: null, shopId: FX.a.shop, productId: FX.a.vay01 });
    expect(ctx.product?.description?.endsWith("Vải linen, không co giãn.")).toBe(true);
    // The Jev router answers product_detail from the catalog.
    const catalog = await store.catalog!(FX.a.shop);
    expect(catalog.find((p) => p.id === FX.a.vay01)?.description?.endsWith("Vải linen, không co giãn.")).toBe(true);
    expect(catalog.find((p) => p.id === FX.a.vay01)?.description).not.toContain("Chờ duyệt.");
    const other = await searchProducts({ query: "váy suông linen", limit: 5 }, ctxB, db);
    expect(other.products[0]?.description ?? "").not.toContain("Vải linen");
  });
});
