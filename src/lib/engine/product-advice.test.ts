import { describe, expect, it } from "vitest";
import { adviceIntent, policyKindFor, shopperMeasurements, sizeReply, stockReply } from "./product-advice";

const shopper = (text: string) => [{ sender: "shopper" as const, text }];

describe("shopper advice", () => {
  it.each([
    ["cao 1m65, nặng 58kg", 165, 58],
    ["cao 165cm nặng 58 ký", 165, 58],
    ["cao 165 nặng 58 cân", 165, 58],
    ["165 58", 165, 58],
  ])("parses %s", (question, heightCm, weightKg) => {
    expect(shopperMeasurements(shopper(question))).toEqual({ heightCm, weightKg });
  });

  it("keeps height from the earlier turn when the shopper adds weight", () => {
    expect(shopperMeasurements([
      { sender: "shopper", text: "Mình cao 165cm, tư vấn size?" },
      { sender: "ai", text: "Bạn cho mình cân nặng nhé" },
      { sender: "shopper", text: "58 cân" },
    ])).toEqual({ heightCm: 165, weightKg: 58 });
  });

  it("recognizes three kinds of policy and does not classify a greeting", () => {
    expect(policyKindFor(shopper("Shop có ship miễn phí không?"))).toBe("giao_hang");
    expect(policyKindFor(shopper("Đổi trả trong bao lâu?"))).toBe("doi_tra");
    expect(policyKindFor(shopper("Có giảm giá không?"))).toBe("khuyen_mai");
    expect(adviceIntent(shopper("Xin chào"))).toBeNull();
  });

  it("uses only stocked variants of the same product when a size is sold out", () => {
    const text = stockReply({ productId: "a0000000-0000-4000-8000-000000000011", name: "Váy suông linen", price: 350000, variants: [
      { variantId: "a0000000-0000-4000-8000-000000000021", size: "M", color: "be", stock: 2 },
      { variantId: "a0000000-0000-4000-8000-000000000022", size: "L", color: "be", stock: 0 },
    ] }, "Váy be size L còn không, giá bao nhiêu?");
    expect(text).toContain("size L đã hết hàng");
    expect(text).toContain("be size M (2 chiếc)");
    expect(text).toContain("350.000đ");
    expect(text).not.toContain("size L (0 chiếc)");
  });

  it("explains when height and weight point to different sizes", () => {
    expect(sizeReply({ status: "ok", size: "XL", sizeByHeight: "L", sizeByWeight: "XL" })).toContain("size lớn hơn");
    expect(sizeReply({ status: "out_of_range" })).toBeNull();
  });
});
