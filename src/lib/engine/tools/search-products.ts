import { activeProductFacts, withFacts } from "../learned-facts";
import { rankProducts } from "../product-match";
import { sortSizes } from "../text";
import type { ToolHandler } from "../types";

// PB-31: ranked in code over the shop's products (a small shop has a few dozen),
// so a near match ("áo khoác da") still returns the closest products, marked
// match "close", and the AI asks "Ý bạn là A hay B?" instead of handing off.
export const searchProducts: ToolHandler<"search_products"> = async (input, ctx, db) => {
  const { data: all, error } = await db
    .from("products")
    .select("id, name, category, price, image_url, description")
    .eq("shop_id", ctx.shopId)
    .order("name");
  if (error) throw new Error(`products: ${error.message}`);
  const { match, products } = rankProducts(input.query, all, input.limit);
  if (products.length === 0) return { match, products: [] };

  // Colors and sizes of every variant, in stock or not: stock is get_stock's job.
  const ids = products.map((p) => p.id);
  const [{ data: variants, error: variantError }, facts] = await Promise.all([
    db.from("variants").select("product_id, size, color").eq("shop_id", ctx.shopId).in("product_id", ids),
    activeProductFacts(db, ctx.shopId, ids),
  ]);
  if (variantError) throw new Error(`variants: ${variantError.message}`);

  return {
    match,
    products: products.map((p) => {
      const own = variants.filter((v) => v.product_id === p.id);
      return {
        productId: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        imageUrl: p.image_url,
        description: withFacts(p.description, facts.get(p.id) ?? []),
        colors: [...new Set(own.map((v) => v.color))],
        sizes: sortSizes(own.map((v) => v.size)),
      };
    }),
  };
};
