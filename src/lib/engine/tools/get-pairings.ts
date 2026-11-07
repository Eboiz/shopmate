import { fold, sortSizes } from "../text.ts";
import type { ToolOutput } from "@/contract";
import type { ToolHandler } from "../types";

type PairingRow = { product_a_id: string; product_b_id: string; reason: string };
type ProductRow = { id: string; name: string; price: number; image_url: string | null };
type VariantRow = { product_id: string; size: string };

// Kept separate from the database reads so the exact filtering logic can run
// against the PB-02 demo seed in CI, without a live Supabase connection.
export function resolvePairings(
  productId: string,
  size: string | undefined,
  rows: PairingRow[],
  products: ProductRow[],
  variants: VariantRow[],
): ToolOutput<"get_pairings"> {
  const byId = new Map(products.map((product) => [product.id, product]));
  const pairings = rows.flatMap((row) => {
    if (row.product_a_id !== productId && row.product_b_id !== productId) return [];
    const otherId = row.product_a_id === productId ? row.product_b_id : row.product_a_id;
    const product = byId.get(otherId);
    if (!product) return [];
    const sizesInStock = sortSizes(
      variants
        .filter((variant) => variant.product_id === otherId && (size === undefined || fold(variant.size) === fold(size)))
        .map((variant) => variant.size),
    );
    if (sizesInStock.length === 0) return [];
    return [{
      productId: product.id,
      name: product.name,
      price: product.price,
      imageUrl: product.image_url,
      reason: row.reason,
      sizesInStock,
    }];
  });
  return { pairings };
}

// Pairings work both ways (PB-08, A8): the product can be on either side of the row.
// No cap on the number of items: the reply picks at most two (PB-08).
export const getPairings: ToolHandler<"get_pairings"> = async (input, ctx, db) => {
  const id = input.productId; // a guid (validated by the tool's input schema), safe inside .or()
  const { data: rows, error } = await db
    .from("pairings")
    .select("product_a_id, product_b_id, reason")
    .eq("shop_id", ctx.shopId)
    .or(`product_a_id.eq.${id},product_b_id.eq.${id}`)
    .order("id");
  if (error) throw new Error(`pairings: ${error.message}`);
  if (rows.length === 0) return { pairings: [] };

  const otherIds = rows.map((row) => row.product_a_id === id ? row.product_b_id : row.product_a_id);
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

  return resolvePairings(id, input.size, rows, products.data, variants.data);
};
