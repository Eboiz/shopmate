import { fold, sortSizes } from "../text";
import { ToolError, type ToolHandler } from "../types";

export const getStock: ToolHandler<"get_stock"> = async (input, ctx, db) => {
  const { data: product, error } = await db
    .from("products")
    .select("id, name, price")
    .eq("id", input.productId)
    .eq("shop_id", ctx.shopId)
    .maybeSingle();
  if (error) throw new Error(`products: ${error.message}`);
  if (!product) throw new ToolError("product_not_found");

  const { data: variants, error: variantError } = await db
    .from("variants")
    .select("id, size, color, stock")
    .eq("product_id", product.id)
    .eq("shop_id", ctx.shopId);
  if (variantError) throw new Error(`variants: ${variantError.message}`);

  // Sold-out variants stay in the list so the reply can offer another size or color.
  const matches = variants.filter(
    (v) =>
      (input.size === undefined || fold(v.size) === fold(input.size)) &&
      (input.color === undefined || fold(v.color) === fold(input.color)),
  );
  const sizeOrder = sortSizes(matches.map((v) => v.size));
  matches.sort(
    (x, y) => sizeOrder.indexOf(x.size) - sizeOrder.indexOf(y.size) || x.color.localeCompare(y.color),
  );

  return {
    productId: product.id,
    name: product.name,
    price: product.price,
    variants: matches.map((v) => ({ variantId: v.id, size: v.size, color: v.color, stock: v.stock })),
  };
};
