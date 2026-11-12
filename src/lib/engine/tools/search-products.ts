import type { ToolContext, ToolOutput } from "@/contract";
import { classifyHits, PHOTO_SIMILAR_MAX, searchByPhoto } from "../photo-search";
import { rankProducts } from "../product-match";
import { sortSizes } from "../text";
import { ToolError, type Db, type ToolHandler } from "../types";

type ProductRow = { id: string; name: string; category: string | null; price: number; image_url: string | null; description: string | null };
type Output = ToolOutput<"search_products">;

// PB-31: ranked in code over the shop's products (a small shop has a few dozen),
// so a near match ("áo khoác da") still returns the closest products, marked
// match "close", and the AI asks "Ý bạn là A hay B?" instead of handing off.
export const searchProducts: ToolHandler<"search_products"> = async (input, ctx, db) => {
  if (input.photo !== undefined) return searchByShopperPhoto(input.photo, input.query, ctx.shopId, ctx.photos ?? [], db);
  const { match, products } = rankProducts(input.query, await shopProducts(db, ctx.shopId), input.limit);
  return withVariants(db, ctx.shopId, match, products);
};

async function shopProducts(db: Db, shopId: string, ids?: string[]): Promise<ProductRow[]> {
  let query = db
    .from("products")
    .select("id, name, category, price, image_url, description")
    .eq("shop_id", shopId);
  if (ids) query = query.in("id", ids);
  const { data, error } = await query.order("name");
  if (error) throw new Error(`products: ${error.message}`);
  return data;
}

// PB-30: the photo search decides exact vs similar (photo-search.ts); the model
// never does. Hits of another shop or of a product deleted since indexing are
// dropped here. When the service is off, slow or failing, the shopper still
// gets an answer: text search on the model's description, never "exact".
async function searchByShopperPhoto(n: number, query: string, shopId: string, photos: ToolContext["photos"] & {}, db: Db): Promise<Output> {
  const photo = photos[n - 1];
  if (!photo) throw new ToolError("photo_not_found");
  let matches;
  try {
    matches = classifyHits(await searchByPhoto({ shopId, photo, text: query, limit: 10 }));
  } catch (error) {
    // searchByPhoto only throws PhotoSearchUnavailable; any failure falls back.
    const why = error instanceof Error ? error.message : String(error);
    console.warn("search_products: photo search unavailable, falling back to text search", why);
    const { match, products } = rankProducts(query, await shopProducts(db, shopId), PHOTO_SIMILAR_MAX);
    return withVariants(db, shopId, match === "none" ? "none" : "close", products);
  }
  if (matches.length === 0) return { match: "none", products: [] };
  const rows = await shopProducts(db, shopId, matches.map((m) => m.productId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kept = matches.flatMap((m) => (byId.has(m.productId) ? [{ row: byId.get(m.productId)!, match: m.match }] : []));
  if (kept.length === 0) return { match: "none", products: [] };
  return withVariants(db, shopId, kept.some((k) => k.match === "exact") ? "exact" : "close", kept.map((k) => k.row));
}

async function withVariants(db: Db, shopId: string, match: Output["match"], products: ProductRow[]): Promise<Output> {
  if (products.length === 0) return { match, products: [] };

  // Colors and sizes of every variant, in stock or not: stock is get_stock's job.
  const { data: variants, error: variantError } = await db
    .from("variants")
    .select("product_id, size, color")
    .eq("shop_id", shopId)
    .in(
      "product_id",
      products.map((p) => p.id),
    );
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
        description: p.description,
        colors: [...new Set(own.map((v) => v.color))],
        sizes: sortSizes(own.map((v) => v.size)),
      };
    }),
  };
}
