import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { replySchema } from "@/contract";
import { sortSizes } from "@/lib/engine/text";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShopCatalog } from "@/lib/shop/types";
import type { ChatMessage } from "./types";

// Server side of the customer shop page and web chat (PB-04).
//
// No customer account: the shopper is a random token in an httpOnly cookie.
// The database stores only its SHA-256 (shoppers.external_id), so a staff member
// or a leaked row can't be used to read the shopper's chat. The shop always
// comes from the slug in the URL, never from the request body.
//
// Uses the secret key (no signed-in user), so every query filters by shop_id.

export const SHOPPER_COOKIE = "shopmate_shopper";
export const SHOPPER_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days
// The GET and POST chat routes are the only readers.
export const SHOPPER_COOKIE_PATH = "/api/shops";
// The shop page shows the latest messages; older ones stay in the staff inbox.
export const HISTORY_SHOWN = 100;

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export function newShopperToken(): string {
  return randomBytes(32).toString("base64url");
}

// The cookie value if it looks like one we issued, else null.
export function readShopperToken(value: string | undefined): string | null {
  return value && TOKEN.test(value) ? value : null;
}

export function shopperExternalId(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export type Shop = { id: string; name: string };

export async function findShop(slug: string): Promise<Shop | null> {
  const { data, error } = await createAdminClient()
    .from("shops")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`shops: ${error.message}`);
  return data;
}

export async function productInShop(shopId: string, productId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("products")
    .select("id")
    .eq("shop_id", shopId)
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(`products: ${error.message}`);
  return data !== null;
}

// Every product with its in-stock colors and sizes. Prices and stock come from
// the database, the same rows the AI tools read.
export async function loadCatalog(shop: Shop): Promise<ShopCatalog> {
  const { data, error } = await createAdminClient()
    .from("products")
    .select("id, name, price, image_url, variants(color, size, stock)")
    .eq("shop_id", shop.id)
    .order("code");
  if (error) throw new Error(`products: ${error.message}`);

  return {
    shop: { name: shop.name },
    products: data.map((product) => {
      const inStock = product.variants.filter((variant) => variant.stock > 0);
      return {
        id: product.id,
        name: product.name,
        price: product.price,
        imageUrl: product.image_url,
        colors: [...new Set(inStock.map((variant) => variant.color))].toSorted((a, b) => a.localeCompare(b, "vi")),
        sizesInStock: sortSizes(inStock.map((variant) => variant.size)),
      };
    }),
  };
}

// The shopper's messages in this shop, oldest first; empty when they never wrote.
export async function loadHistory(shopId: string, externalId: string): Promise<ChatMessage[]> {
  const db = createAdminClient();
  // One conversation per shopper (conversations.shopper_id is unique).
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("id, shoppers!inner(id)")
    .eq("shop_id", shopId)
    .eq("shoppers.shop_id", shopId)
    .eq("shoppers.channel", "web")
    .eq("shoppers.external_id", externalId)
    .maybeSingle();
  if (conversationError) throw new Error(`conversations: ${conversationError.message}`);
  if (!conversation) return [];
  const conversationId = conversation.id;

  const { data, error } = await db
    .from("messages")
    .select("id, sender, text, reply, created_at")
    .eq("shop_id", shopId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_SHOWN);
  if (error) throw new Error(`messages: ${error.message}`);

  return data.toReversed().map((message) => {
    const reply = message.reply === null ? null : replySchema.safeParse(message.reply);
    return {
      id: message.id,
      sender: message.sender,
      text: message.text,
      reply: reply?.success ? reply.data : null,
      createdAt: message.created_at,
    };
  });
}
