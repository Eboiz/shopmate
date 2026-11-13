import { describe, expect, it } from "vitest";
import type { ShopProduct } from "@/lib/shop/types";
import { onlyChoice, productOptions } from "./product-options";

type Variant = NonNullable<ShopProduct["variants"]>[number];

function product(variants: Variant[] | undefined, extra: Partial<ShopProduct> = {}): ShopProduct {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Áo sơ mi trắng công sở",
    price: 320000,
    imageUrl: null,
    colors: [],
    sizesInStock: [],
    variants,
    ...extra,
  };
}

// Trắng has every size but M is sold out; Đen is fully sold out; Be has no XS.
const shirt = product([
  { color: "Trắng", size: "XL", stock: 2 },
  { color: "Trắng", size: "M", stock: 0 },
  { color: "Trắng", size: "XS", stock: 1 },
  { color: "Trắng", size: "S", stock: 4 },
  { color: "Trắng", size: "L", stock: 3 },
  { color: "Đen", size: "S", stock: 0 },
  { color: "Đen", size: "M", stock: 0 },
  { color: "Be", size: "M", stock: 5 },
  { color: "Be", size: "L", stock: 0 },
]);

describe("productOptions", () => {
  it("lists every size of the product, sold out or not, in size order", () => {
    expect(productOptions(shirt).sizes).toEqual(["XS", "S", "M", "L", "XL"]);
  });

  it("keeps a sold-out size of a colour, marked sold out", () => {
    const { sizeState, sizesFor, inStockSizesFor } = productOptions(shirt);
    expect(sizeState("Trắng", "M")).toBe("sold_out");
    expect(sizeState("Trắng", "S")).toBe("available");
    expect(sizesFor("Trắng")).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(inStockSizesFor("Trắng")).toEqual(["XS", "S", "L", "XL"]);
  });

  it("marks sizes a colour is not made in as missing and leaves them out", () => {
    const { sizeState, sizesFor } = productOptions(shirt);
    expect(sizeState("Be", "XS")).toBe("missing");
    expect(sizesFor("Be")).toEqual(["M", "L"]);
  });

  it("still shows a colour whose sizes are all sold out", () => {
    const { colors, isColorSoldOut, defaultSizeFor } = productOptions(shirt);
    expect(colors).toContain("Đen");
    expect(isColorSoldOut("Đen")).toBe(true);
    expect(isColorSoldOut("Trắng")).toBe(false);
    expect(defaultSizeFor("Đen")).toBe("");
  });

  it("picks the first in-stock size by default, skipping sold-out ones", () => {
    const sizes = product([
      { color: "Trắng", size: "XS", stock: 0 },
      { color: "Trắng", size: "S", stock: 0 },
      { color: "Trắng", size: "M", stock: 3 },
    ]);
    expect(productOptions(sizes).defaultSizeFor("Trắng")).toBe("M");
  });

  it("starts on the first colour that is still in stock", () => {
    const soldOutFirst = product([
      { color: "Đen", size: "M", stock: 0 },
      { color: "Trắng", size: "M", stock: 1 },
    ]);
    expect(productOptions(soldOutFirst).defaultColor).toBe("Trắng");
  });

  it("gives no stock for sold-out or missing variants", () => {
    const { stockOf } = productOptions(shirt);
    expect(stockOf("Trắng", "S")).toBe(4);
    expect(stockOf("Trắng", "M")).toBe(0);
    expect(stockOf("Be", "XS")).toBe(0);
  });

  it("falls back to the in-stock size list when the catalog has no variants", () => {
    const { sizes, sizeState, stockOf } = productOptions(product(undefined, { colors: ["be"], sizesInStock: ["M", "S"] }));
    expect(sizes).toEqual(["S", "M"]);
    expect(sizeState("be", "M")).toBe("available");
    expect(stockOf("be", "M")).toBe(99);
    expect(stockOf("be", "XL")).toBe(0);
  });
});

describe("onlyChoice", () => {
  it("adds straight away when a single colour and size is in stock", () => {
    const one = product([
      { color: "Trắng", size: "M", stock: 2 },
      { color: "Trắng", size: "L", stock: 0 },
      { color: "Đen", size: "M", stock: 0 },
    ]);
    expect(onlyChoice(one)).toEqual({ color: "Trắng", size: "M" });
  });

  it("asks when more than one choice is in stock", () => {
    expect(onlyChoice(shirt)).toBeNull();
  });

  it("works for products without colour data", () => {
    expect(onlyChoice(product(undefined, { sizesInStock: ["Free size"] }))).toEqual({ color: "", size: "Free size" });
  });
});
