import { describe, expect, it } from "vitest";
import {
  addPairingSchema,
  updatePolicySchema,
  updatePriceSchema,
  updateStockSchema,
} from "./shop-data-validation";

const price = (value: string) =>
  updatePriceSchema.safeParse({ productId: "p1", price: value });
const stock = (value: string) =>
  updateStockSchema.safeParse({ variantId: "v1", stock: value });
const pairing = (productId1: string, productId2: string, reason = "Hợp màu") =>
  addPairingSchema.safeParse({ productId1, productId2, reason });

describe("updatePriceSchema", () => {
  it("accepts a whole number greater than 0", () => {
    expect(price("350000").data?.price).toBe(350000);
    expect(price(" 1 ").data?.price).toBe(1);
    expect(price("99999999").data?.price).toBe(99999999);
  });

  it.each(["0", "-1", "", "  ", "350k", "350.000", "12.5", "1e3", "100000000", "99999999999999999"])(
    "rejects %j",
    (value) => {
      expect(price(value).success).toBe(false);
    },
  );
});

describe("updateStockSchema", () => {
  it("accepts 0 and above", () => {
    expect(stock("0").data?.stock).toBe(0);
    expect(stock("12").data?.stock).toBe(12);
    expect(stock("99999").data?.stock).toBe(99999);
  });

  it.each(["-1", "", "1.5", "abc", "100000", "99999999999999999999"])("rejects %j", (value) => {
    expect(stock(value).success).toBe(false);
  });

  it("explains the stock limit instead of a database error (review #8)", () => {
    expect(stock("100000").error?.issues[0].message).toBe("Tồn kho tối đa là 99.999");
  });
});

describe("updatePolicySchema", () => {
  it("allows empty content, which means the shop has no such policy", () => {
    const result = updatePolicySchema.safeParse({ type: "khuyen_mai", content: "  " });
    expect(result.data?.content).toBe("");
  });

  it("rejects an unknown policy type", () => {
    expect(updatePolicySchema.safeParse({ type: "khac", content: "x" }).success).toBe(false);
  });
});

describe("addPairingSchema", () => {
  it("accepts two different products with a reason", () => {
    expect(pairing("p1", "p2").success).toBe(true);
  });

  it("rejects pairing a product with itself", () => {
    expect(pairing("p1", "p1").success).toBe(false);
  });

  it("rejects a missing product or a blank reason", () => {
    expect(pairing("", "p2").success).toBe(false);
    expect(pairing("p1", "p2", "   ").success).toBe(false);
  });
});
