import { beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "../test/two-shops";
import { ToolError } from "../types";
import { getStock } from "./get-stock";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };

describe("get_stock", () => {
  beforeAll(() => seedTwoShops(db));

  it("returns every variant, sold out ones too", async () => {
    const out = await getStock({ productId: FX.a.vay01 }, ctxA, db);
    expect(out.price).toBe(350000);
    expect(out.name).toBe("Váy suông linen");
    expect(out.variants).toHaveLength(3);
    expect(out.variants).toContainEqual({ variantId: FX.a.vay01MBe, size: "M", color: "be", stock: 2 });
    expect(out.variants).toContainEqual({ variantId: FX.a.vay01LBe, size: "L", color: "be", stock: 0 });
  });

  it("filters size and color ignoring case", async () => {
    const out = await getStock({ productId: FX.a.vay01, size: "m", color: "Be" }, ctxA, db);
    expect(out.variants).toEqual([{ variantId: FX.a.vay01MBe, size: "M", color: "be", stock: 2 }]);
  });

  it("matches a color typed without diacritics", async () => {
    const out = await getStock({ productId: FX.a.vay01, color: "den" }, ctxA, db);
    expect(out.variants).toEqual([{ variantId: FX.a.vay01MDen, size: "M", color: "đen", stock: 5 }]);
  });

  it("returns no variants for a size the product doesn't have", async () => {
    const out = await getStock({ productId: FX.a.vay01, size: "XXL" }, ctxA, db);
    expect(out.variants).toEqual([]);
  });

  it("does not find another shop's product", async () => {
    const run = getStock({ productId: FX.b.vay01 }, ctxA, db);
    await expect(run).rejects.toBeInstanceOf(ToolError);
    await expect(run).rejects.toMatchObject({ code: "product_not_found" });
  });
});
