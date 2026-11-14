import type { PolicyKind } from "@/contract";
import type { Db } from "./types";

// PB-35a: what the AI learned from staff replies (learned_facts, status active)
// reaches it through the data it already reads: a policy fact is appended to
// get_policy's text of that kind, a product fact to that product's description.
// Pending and removed facts never do. Callers filter by their own shop.

export function withFacts(text: string | null | undefined, facts: string[]): string | null {
  const parts = [text?.trim() ? text : null, ...facts].filter((part): part is string => part !== null);
  return parts.length ? parts.join("\n") : null;
}

export async function activePolicyFacts(db: Db, shopId: string, kind: PolicyKind): Promise<string[]> {
  const { data, error } = await db
    .from("learned_facts")
    .select("text")
    .eq("shop_id", shopId)
    .eq("policy_kind", kind)
    .eq("status", "active")
    .order("created_at");
  if (error) throw new Error(`learned_facts: ${error.message}`);
  return data.map((row) => row.text);
}

// productId -> its active facts, oldest first.
export async function activeProductFacts(db: Db, shopId: string, productIds: string[]): Promise<Map<string, string[]>> {
  const facts = new Map<string, string[]>();
  if (productIds.length === 0) return facts;
  const { data, error } = await db
    .from("learned_facts")
    .select("product_id, text")
    .eq("shop_id", shopId)
    .in("product_id", productIds)
    .eq("status", "active")
    .order("created_at");
  if (error) throw new Error(`learned_facts: ${error.message}`);
  for (const row of data) {
    if (row.product_id) facts.set(row.product_id, [...(facts.get(row.product_id) ?? []), row.text]);
  }
  return facts;
}
