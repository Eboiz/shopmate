import { describe, expect, it } from "vitest";
import { cartLineMax, reconcileCart, stockChangeMessage, variantStock, type CartItem } from "./cart";
import { trapTarget } from "./use-modal";

const shirt: CartItem = {
  productId: "p1",
  name: "Áo sơ mi trắng công sở",
  price: 350000,
  imageUrl: null,
  color: "xanh nhạt",
  size: "S",
  quantity: 1,
};

const products = [
  {
    id: "p1",
    variants: [
      { color: "xanh nhạt", size: "S", stock: 10 },
      { color: "xanh nhạt", size: "M", stock: 0 },
    ],
  },
  { id: "p2" },
];

describe("cartLineMax", () => {
  it("caps at the stored stock, and at 99 for baskets saved before the fix", () => {
    expect(cartLineMax({ ...shirt, maxQuantity: 10 })).toBe(10);
    expect(cartLineMax(shirt)).toBe(99);
  });
});

describe("variantStock", () => {
  it("reads the stock of the line's colour and size", () => {
    expect(variantStock(products, shirt)).toBe(10);
    expect(variantStock(products, { ...shirt, size: "M" })).toBe(0);
  });

  it("treats a variant missing from the catalog as sold out", () => {
    expect(variantStock(products, { ...shirt, size: "XL" })).toBe(0);
  });

  it("does not know when the product or its variants are missing", () => {
    expect(variantStock(products, { ...shirt, productId: "p2" })).toBeNull();
    expect(variantStock(products, { ...shirt, productId: "gone" })).toBeNull();
  });
});

describe("reconcileCart", () => {
  const stockOf = (item: CartItem) => variantStock(products, item);

  it("caps an old basket (no maxQuantity) above stock and stores the stock", () => {
    const { items, changes } = reconcileCart([{ ...shirt, quantity: 11 }], stockOf);
    expect(items).toEqual([{ ...shirt, quantity: 10, maxQuantity: 10 }]);
    expect(changes).toEqual([{ name: shirt.name, color: "xanh nhạt", size: "S", kind: "capped", stock: 10 }]);
  });

  it("adds maxQuantity without reporting a change when the quantity fits", () => {
    const { items, changes } = reconcileCart([{ ...shirt, quantity: 3 }], stockOf);
    expect(items).toEqual([{ ...shirt, quantity: 3, maxQuantity: 10 }]);
    expect(changes).toEqual([]);
  });

  it("lowers maxQuantity when the stock dropped since the line was added", () => {
    const { items } = reconcileCart([{ ...shirt, quantity: 2, maxQuantity: 50 }], stockOf);
    expect(items[0].maxQuantity).toBe(10);
  });

  it("drops sold-out lines and keeps lines it cannot check", () => {
    const unknown = { ...shirt, productId: "p2", quantity: 40 };
    const { items, changes } = reconcileCart([{ ...shirt, size: "M" }, unknown], stockOf);
    expect(items).toEqual([unknown]);
    expect(changes).toEqual([{ name: shirt.name, color: "xanh nhạt", size: "M", kind: "sold_out" }]);
  });

  it("never stores more than 99", () => {
    const { items } = reconcileCart([{ ...shirt, quantity: 99 }], () => 500);
    expect(items[0]).toMatchObject({ quantity: 99, maxQuantity: 99 });
  });
});

describe("stockChangeMessage", () => {
  it("names the variant and what changed", () => {
    expect(stockChangeMessage([
      { name: "Áo", color: "xanh nhạt", size: "S", kind: "capped", stock: 10 },
      { name: "Quần", color: "", size: "M", kind: "sold_out" },
    ])).toBe("Áo (Xanh nhạt, size S) chỉ còn 10, đã giảm số lượng về 10. Quần (size M) đã hết hàng, đã bỏ khỏi giỏ.");
  });
});

describe("trapTarget", () => {
  const [close, plus, send] = ["close", "plus", "send"];
  const focusable = [close, plus, send];

  it("Shift+Tab on the first control wraps to the last (BUG-02)", () => {
    expect(trapTarget(focusable, close, true, true)).toBe(send);
  });

  it("Tab on the last control wraps to the first", () => {
    expect(trapTarget(focusable, send, true, false)).toBe(close);
  });

  it("lets the browser move between controls inside", () => {
    expect(trapTarget(focusable, plus, true, true)).toBeNull();
    expect(trapTarget(focusable, plus, true, false)).toBeNull();
  });

  it("pulls focus back in when it is outside the dialog", () => {
    expect(trapTarget(focusable, "page", false, true)).toBe(send);
    expect(trapTarget(focusable, "page", false, false)).toBe(close);
  });
});
