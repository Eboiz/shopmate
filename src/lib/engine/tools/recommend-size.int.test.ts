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
});
