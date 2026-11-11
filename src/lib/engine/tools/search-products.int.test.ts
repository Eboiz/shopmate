import { beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "../test/two-shops";
import { searchProducts } from "./search-products";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };
const ctxB = { shopId: FX.b.shop, conversationId: FX.b.conversation };

describe("search_products", () => {
  beforeAll(() => seedTwoShops(db));

  it("finds names typed without diacritics", async () => {
    const { products } = await searchProducts({ query: "vay suong linen", limit: 5 }, ctxA, db);
    expect(products).toHaveLength(1);
    expect(products[0].productId).toBe(FX.a.vay01);
    expect(products[0].price).toBe(350000);
    expect([...products[0].colors].sort()).toEqual(["be", "đen"]);
    expect(products[0].sizes).toEqual(["M", "L"]);
  });

  it("matches all words in any order", async () => {
    const { products } = await searchProducts({ query: "linen vay", limit: 5 }, ctxA, db);
    expect(products.map((p) => p.productId)).toEqual([FX.a.vay01]);
  });

  it("matches category", async () => {
    const { products } = await searchProducts({ query: "áo", limit: 5 }, ctxA, db);
    expect(products.map((p) => p.productId)).toContain(FX.a.ao03);
  });

  it("returns empty for no match", async () => {
    expect(await searchProducts({ query: "giày cao gót", limit: 5 }, ctxA, db)).toEqual({ match: "none", products: [] });
  });

  it("respects limit", async () => {
    const { products } = await searchProducts({ query: "a", limit: 1 }, ctxA, db);
    expect(products.length).toBeLessThanOrEqual(1);
  });

  it("product without variants", async () => {
    const { products } = await searchProducts({ query: "quan ong rong", limit: 5 }, ctxA, db);
    expect(products).toHaveLength(1);
    expect(products[0].colors).toEqual([]);
    expect(products[0].sizes).toEqual([]);
  });

  it("shop B sees its own price", async () => {
    const { products } = await searchProducts({ query: "vay", limit: 5 }, ctxB, db);
    expect(products).toHaveLength(1);
    expect(products[0].productId).toBe(FX.b.vay01);
    expect(products[0].price).toBe(420000);
  });
});
