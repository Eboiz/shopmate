import "server-only";
import { redirect } from "next/navigation";
import type { PolicyKind, ProfileRole } from "@/contract";
import { LOGIN_PATH } from "@/lib/auth-routes";
import { POLICY_KINDS } from "@/lib/shop-data-validation";
import { compareSizes } from "@/lib/size-order";
import { createClient } from "@/lib/supabase/server";

// Catalog reads and writes for /admin/products (PB-16). Everything goes through
// the signed-in user's Supabase client, so Row Level Security (PB-00) decides
// what they can read and that only the owner can write. Nothing here is cached:
// the AI tools read the same tables, so the next answer sees the new values.

export type StaffContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  shopId: string;
  role: ProfileRole;
};

export async function requireStaff(): Promise<StaffContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(LOGIN_PATH);

  const { data: profile } = await supabase
    .from("profiles")
    .select("shop_id, role")
    .eq("id", user.id)
    .maybeSingle();
  // A user without a profile belongs to no shop.
  if (!profile) redirect(LOGIN_PATH);

  return { supabase, shopId: profile.shop_id, role: profile.role };
}

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

export async function getCatalog({ supabase, shopId }: StaffContext) {
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
