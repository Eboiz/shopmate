import { sortSizes } from "../text";
import type { ToolHandler } from "../types";

export const searchProducts: ToolHandler<"search_products"> = async (input, ctx, db) => {
  const { data: products, error } = await db.rpc("engine_search_products", {
    p_shop_id: ctx.shopId,
    p_query: input.query,
    p_limit: input.limit,
  });
  if (error) throw new Error(`engine_search_products: ${error.message}`);
  if (products.length === 0) return { products: [] };

  // Colors and sizes of every variant, in stock or not: stock is get_stock's job.
  const { data: variants, error: variantError } = await db
    .from("variants")
    .select("product_id, size, color")
    .eq("shop_id", ctx.shopId)
    .in(
      "product_id",
      products.map((p) => p.id),
    );
  if (variantError) throw new Error(`variants: ${variantError.message}`);

  return {
    products: products.map((p) => {
      const own = variants.filter((v) => v.product_id === p.id);
      return {
        productId: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        imageUrl: p.image_url,
        colors: [...new Set(own.map((v) => v.color))],
        sizes: sortSizes(own.map((v) => v.size)),
      };
    }),
  };
};
