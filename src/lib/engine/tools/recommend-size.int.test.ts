import { beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "../test/two-shops";
import { recommendSizeTool } from "./recommend-size";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };
const ctxB = { shopId: FX.b.shop, conversationId: FX.b.conversation };

describe("recommend_size", () => {
  beforeAll(() => seedTwoShops(db));

  it("uses the product's chart", async () => {
    expect(await recommendSizeTool({ productId: FX.a.vay01, heightCm: 160, weightKg: 50 }, ctxA, db)).toMatchObject({
      status: "ok",
      size: "M",
    });
  });

  it("has no chart for a product without one", async () => {
    expect(await recommendSizeTool({ productId: FX.a.quan05, heightCm: 160, weightKg: 50 }, ctxA, db)).toEqual({
      status: "no_chart",
    });
  });

  it("does not find another shop's product", async () => {
    await expect(
      recommendSizeTool({ productId: FX.b.vay01, heightCm: 160, weightKg: 50 }, ctxA, db),
    ).rejects.toMatchObject({ code: "product_not_found" });
  });

  it("reads shop B's own chart", async () => {
    expect(await recommendSizeTool({ productId: FX.b.vay01, heightCm: 175, weightKg: 75 }, ctxB, db)).toMatchObject({
      status: "ok",
      size: "M",
    });
  });
  // PB-24: the tool reads size_charts with no cache, so an edited chart applies
  // to the very next question.
  it("uses an edited chart on the next call", async () => {
    const product = { productId: FX.a.quan05, heightCm: 160, weightKg: 50 };
    expect(await recommendSizeTool(product, ctxA, db)).toEqual({ status: "no_chart" });
    const { error } = await db.from("size_charts").insert({
      shop_id: FX.a.shop, product_id: FX.a.quan05, size: "M", height_min_cm: 155, height_max_cm: 165, weight_min_kg: 45, weight_max_kg: 55,
    });
    expect(error).toBeNull();
    try {
      expect(await recommendSizeTool(product, ctxA, db)).toMatchObject({ status: "ok", size: "M" });
    } finally {
      await db.from("size_charts").delete().eq("product_id", FX.a.quan05).eq("shop_id", FX.a.shop);
    }
  });
});

