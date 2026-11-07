import { ToolError, type ToolHandler } from "../types";
import { mergeItems } from "./order-items";

// Every number comes from the database: the model never does this arithmetic.
export const quoteOrder: ToolHandler<"quote_order"> = async (input, ctx, db) => {
  const items = mergeItems(input.items);
  const { data: variants, error } = await db
    .from("variants")
    .select("id, product_id, size, color, products!inner(name, price)")
    .eq("shop_id", ctx.shopId)
    .in(
      "id",
      items.map((i) => i.variantId),
    );
  if (error) throw new Error(`variants: ${error.message}`);

  const lines = items.map(({ variantId, quantity }) => {
    const v = variants.find((row) => row.id === variantId);
    if (!v) throw new ToolError("variant_not_found");
    return {
      variantId,
      productId: v.product_id,
      name: v.products.name,
      size: v.size,
      color: v.color,
      quantity,
      unitPrice: v.products.price,
      lineTotal: quantity * v.products.price,
    };
  });
  return { lines, total: lines.reduce((sum, l) => sum + l.lineTotal, 0) };
};
