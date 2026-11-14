import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SearchDoc } from "./semantic-search";

// The shop's catalog as the embedder indexes it: name, category, description
// and colors. Used by the mock until PB-30 is merged (spec section 3.4).

export async function loadSearchDocs(shopId: string): Promise<SearchDoc[]> {
  const { data, error } = await createAdminClient()
    .from("products")
    .select("id, name, category, description, variants(color)")
    .eq("shop_id", shopId);
  if (error) throw new Error(`products: ${error.message}`);

  return data.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.description,
    colors: distinctColors(product.variants.map((variant) => variant.color)),
  }));
}

// Non-empty colors only, in the order they first appear.
function distinctColors(colors: string[]): string[] {
  return [...new Set(colors.filter((color) => color.trim() !== ""))];
}
