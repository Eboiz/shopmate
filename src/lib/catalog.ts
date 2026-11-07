import "server-only";
import type { PolicyKind } from "@/contract";
import { POLICY_KINDS } from "@/lib/shop-data-validation";
import { compareSizes } from "@/lib/size-order";
import { createClient } from "@/lib/supabase/server";

// Catalog reads for /admin/products (PB-16). They go through the signed-in
// user's Supabase client, so Row Level Security (PB-00) decides what they can
// read. Nothing here is cached: the AI tools read the same tables, so the next
// answer sees the new values. The shop comes from requireStaff() (src/lib/auth.ts).

export type CatalogVariant = { id: string; size: string; color: string; stock: number };
export type CatalogProduct = {
  id: string;
  code: string;
  name: string;
  price: number;
  variants: CatalogVariant[];
};
export type CatalogPolicy = { kind: PolicyKind; content: string };
export type CatalogPairing = {
  id: string;
  productName1: string;
  productName2: string;
  reason: string;
};

export async function getCatalog(shopId: string) {
  const supabase = await createClient();
  const [products, policies, pairings] = await Promise.all([
    supabase
      .from("products")
      .select("id, code, name, price, variants(id, size, color, stock)")
      .eq("shop_id", shopId)
      .order("code"),
    supabase.from("policies").select("kind, content").eq("shop_id", shopId),
    supabase
      .from("pairings")
      .select("id, product_a_id, product_b_id, reason")
      .eq("shop_id", shopId),
  ]);

  for (const result of [products, policies, pairings]) {
    if (result.error) throw new Error(`Không đọc được dữ liệu shop: ${result.error.message}`);
  }

  const productList: CatalogProduct[] = (products.data ?? []).map((product) => ({
    ...product,
    variants: product.variants.toSorted(
      (a, b) => a.color.localeCompare(b.color, "vi") || compareSizes(a.size, b.size),
    ),
  }));
  const nameById = new Map(productList.map((product) => [product.id, product.name]));

  // Show all three kinds; a missing row is the same as an empty policy (PB-02).
  const policyList: CatalogPolicy[] = POLICY_KINDS.map((kind) => ({
    kind,
    content: (policies.data ?? []).find((policy) => policy.kind === kind)?.content ?? "",
  }));

  const pairingList: CatalogPairing[] = (pairings.data ?? []).map((pairing) => ({
    id: pairing.id,
    productName1: nameById.get(pairing.product_a_id) ?? "?",
    productName2: nameById.get(pairing.product_b_id) ?? "?",
    reason: pairing.reason,
  }));

  return { products: productList, policies: policyList, pairings: pairingList };
}
