import { compareSizes } from "@/lib/size-order";
import type { ShopProduct } from "@/lib/shop/types";

// "missing": this colour is not made in that size at all.
export type SizeState = "available" | "sold_out" | "missing";

// Every colour and size of a product, and which of them can still be bought.
// Sold-out sizes stay listed so shoppers can tell "hết hàng" from "không có".
export function productOptions(product: ShopProduct) {
  const variants = product.variants;
  const variantOf = (color: string, size: string) => variants?.find((variant) => variant.color === color && variant.size === size);
  const colors = variants ? [...new Set(variants.map((variant) => variant.color))] : product.colors;
  const sizes = [...new Set(variants ? variants.map((variant) => variant.size) : product.sizesInStock)].sort(compareSizes);

  function sizeState(color: string, size: string): SizeState {
    if (!variants) return product.sizesInStock.includes(size) ? "available" : "missing";
    const variant = variantOf(color, size);
    if (!variant) return "missing";
    return variant.stock > 0 ? "available" : "sold_out";
  }
  // Sizes this colour is made in, sold out or not.
  const sizesFor = (color: string) => sizes.filter((size) => sizeState(color, size) !== "missing");
  const inStockSizesFor = (color: string) => sizes.filter((size) => sizeState(color, size) === "available");
  const isColorSoldOut = (color: string) => inStockSizesFor(color).length === 0;
  const defaultSizeFor = (color: string) => inStockSizesFor(color)[0] ?? "";
  // Without variant data the catalog only knows which sizes are in stock, not how many.
  const stockOf = (color: string, size: string) =>
    variants ? (variantOf(color, size)?.stock ?? 0) : sizeState(color, size) === "available" ? 99 : 0;
  const defaultColor = colors.find((color) => !isColorSoldOut(color)) ?? colors[0] ?? "";

  return { colors, sizes, sizeState, sizesFor, inStockSizesFor, isColorSoldOut, defaultSizeFor, defaultColor, stockOf };
}

// The one choice left when only a single colour and size are in stock.
export function onlyChoice(product: ShopProduct): { color: string; size: string } | null {
  const { colors, inStockSizesFor } = productOptions(product);
  const slots = colors.length > 0 ? colors : [""];
  const choices = slots.flatMap((color) => inStockSizesFor(color).map((size) => ({ color, size })));
  return choices.length === 1 ? choices[0] : null;
}
