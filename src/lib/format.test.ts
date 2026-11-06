import { describe, expect, it } from "vitest";
import { formatPrice, formatSizesInStock } from "./format";

describe("formatSizesInStock", () => {
  it("lists the sizes in stock, or says the product is sold out", () => {
    expect(formatSizesInStock(["S", "M"])).toBe("Size còn hàng: S, M");
    expect(formatSizesInStock([])).toBe("Hết hàng");
  });
});

describe("formatPrice", () => {
  it("groups thousands with dots and adds the đồng sign", () => {
    expect(formatPrice(350000)).toBe("350.000đ");
    expect(formatPrice(1250000)).toBe("1.250.000đ");
  });

  it("leaves small amounts ungrouped", () => {
    expect(formatPrice(500)).toBe("500đ");
  });
});
