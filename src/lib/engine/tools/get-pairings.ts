import { fold, sortSizes } from "../text";
import type { ToolHandler } from "../types";

// Pairings work both ways (PB-08, A8): the product can be on either side of the row.
// No cap on the number of items: the reply picks at most two (PB-08).
export const getPairings: ToolHandler<"get_pairings"> = async (input, ctx, db) => {
  const id = input.productId; // a guid (validated by the tool's input schema), safe inside .or()
  const { data: rows, error } = await db
    .from("pairings")
    .select("product_a_id, product_b_id, reason")
    .eq("shop_id", ctx.shopId)
    .or(`product_a_id.eq.${id},product_b_id.eq.${id}`);
  if (error) throw new Error(`pairings: ${error.message}`);
  if (rows.length === 0) return { pairings: [] };

  const others = rows.map((r) => ({ id: r.product_a_id === id ? r.product_b_id : r.product_a_id, reason: r.reason }));
  const otherIds = others.map((o) => o.id);
  const [products, variants] = await Promise.all([
    db.from("products").select("id, name, price, image_url").eq("shop_id", ctx.shopId).in("id", otherIds),
    db
      .from("variants")
      .select("product_id, size")
      .eq("shop_id", ctx.shopId)
      .in("product_id", otherIds)
      .gt("stock", 0),
  ]);
  if (products.error) throw new Error(`products: ${products.error.message}`);
  if (variants.error) throw new Error(`variants: ${variants.error.message}`);

  const pairings = others.flatMap(({ id: otherId, reason }) => {
    const product = products.data.find((p) => p.id === otherId);
    if (!product) return [];
    const sizesInStock = sortSizes(
      variants.data
        .filter((v) => v.product_id === otherId && (input.size === undefined || fold(v.size) === fold(input.size)))
        .map((v) => v.size),
    );
    if (sizesInStock.length === 0) return [];
    return [{ productId: product.id, name: product.name, price: product.price, imageUrl: product.image_url, reason, sizesInStock }];
  });
  return { pairings };
};
