import { describe, expect, it } from "vitest";
import {
  addPairingSchema,
  priceError,
  saveProductSchema,
  stockError,
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

describe("saveProductSchema", () => {
  const save = (priceText: string, stocks: unknown) =>
    saveProductSchema.safeParse({ productId: "p1", price: priceText, stocks: typeof stocks === "string" ? stocks : JSON.stringify(stocks) });

  it("reads the price and every stock row as numbers", () => {
    expect(save("350000", [{ variantId: "v1", stock: "4" }, { variantId: "v2", stock: " 0 " }]).data).toEqual({
      productId: "p1",
      price: 350000,
      stocks: [{ variantId: "v1", stock: 4 }, { variantId: "v2", stock: 0 }],
    });
  });

  it("refuses the whole save when one row is wrong, with the stock message", () => {
    expect(save("350000", [{ variantId: "v1", stock: "4" }, { variantId: "v2", stock: "-1" }]).error?.issues[0].message).toBe(
      "Tồn kho phải là số nguyên từ 0 trở lên",
    );
  });

  it("checks the price with the same rule as before", () => {
    expect(save("0", []).error?.issues[0].message).toBe("Giá phải là số nguyên lớn hơn 0, ví dụ 350000");
  });

  it.each(["not json", "{}", '[{"stock": "1"}]'])("refuses a body the editor never sends: %s", (body) => {
    expect(save("350000", body).error?.issues[0].message).toBe("Dữ liệu tồn kho không đọc được, hãy tải lại trang.");
  });
});

describe("priceError / stockError", () => {
  it("returns the field message or null", () => {
    expect(priceError("350000")).toBeNull();
    expect(priceError("350k")).toBe("Giá phải là số nguyên lớn hơn 0, ví dụ 350000");
    expect(stockError("12")).toBeNull();
    expect(stockError("100000")).toBe("Tồn kho tối đa là 99.999");
  });
});
