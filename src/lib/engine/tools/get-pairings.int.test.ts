import { beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX, seedTwoShops } from "../test/two-shops";
import { getPairings } from "./get-pairings";

const db = createAdminClient();
const ctxA = { shopId: FX.a.shop, conversationId: FX.a.conversation };

describe("get_pairings", () => {
  beforeAll(() => seedTwoShops(db));

  it("finds the pairing stored on the other side", async () => {
    expect(await getPairings({ productId: FX.a.vay01 }, ctxA, db)).toEqual({
      pairings: [
        {
          productId: FX.a.ao03,
          name: "Áo sơ mi trắng",
          price: 250000,
          imageUrl: null,
          reason: "Áo trắng hợp váy be",
          sizesInStock: ["S"],
        },
      ],
    });
  });

  it("works both ways", async () => {
    const { pairings } = await getPairings({ productId: FX.a.ao03 }, ctxA, db);
    expect(pairings).toHaveLength(1);
    expect(pairings[0].productId).toBe(FX.a.vay01);
    expect(pairings[0].sizesInStock).toEqual(["M"]);
  });

  it("drops items sold out in the shopper's size", async () => {
    expect(await getPairings({ productId: FX.a.vay01, size: "M" }, ctxA, db)).toEqual({ pairings: [] });
  });

  it("is empty for a product without pairings", async () => {
    expect(await getPairings({ productId: FX.a.quan05 }, ctxA, db)).toEqual({ pairings: [] });
  });

  it("is empty for another shop's product", async () => {
    expect(await getPairings({ productId: FX.b.vay01 }, ctxA, db)).toEqual({ pairings: [] });
  });
});
