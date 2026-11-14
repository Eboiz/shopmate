import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// PB-34: limits the search bar cannot reset. A web shopper is only a cookie, so
// the search route counts per client IP (stored as an HMAC, never the raw IP)
// and per shop. Stored in Postgres (search_hits, search_take), because
// serverless instances share no memory.
export const SEARCH_LIMIT = {
  // Searches from one IP to one shop: a sixth of the shop's ceiling, so one
  // client can't use up search for everyone.
  clientShopPerMinute: 20,
  // Ceiling for the whole shop, many IPs together: bounds embedder spend.
  shopPerMinute: 120,
} as const;

export type SearchLimitResult = "ok" | "client_shop" | "shop";

// Web chat uses "web-chat-ip:" as its prefix, so the same address counts in a
// separate search bucket. The secret key never leaves the server.
export function searchClientHash(ip: string): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createHmac("sha256", key).update(`search-ip:${ip}`).digest("base64url");
}

// Records the search and returns "ok", or the limit it is over and records
// nothing. Throws when the database can't answer: the route then refuses the
// search rather than call the embedder unchecked.
export async function takeSearchSlot(input: {
  shopId: string;
  clientHash: string;
}): Promise<SearchLimitResult> {
  const { data, error } = await createAdminClient().rpc("search_take", {
    p_shop_id: input.shopId,
    p_client_hash: input.clientHash,
    p_client_shop_per_minute: SEARCH_LIMIT.clientShopPerMinute,
    p_shop_per_minute: SEARCH_LIMIT.shopPerMinute,
  });
  if (error) throw new Error(`search_take: ${error.message}`);
  if (data === "ok" || data === "client_shop" || data === "shop") return data;
  throw new Error(`search_take: unexpected result ${String(data)}`);
}
