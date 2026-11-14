import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { replySchema, type ConversationMode } from "@/contract";
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

// "<random id>.<HMAC of the id>": only the server can make a valid token, so a
// script can't skip the new-shopper limit by sending made-up cookies.
const TOKEN = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

function sign(id: string): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createHmac("sha256", key).update(`shopper-token:${id}`).digest("base64url");
}

export function newShopperToken(): string {
  const id = randomBytes(32).toString("base64url");
  return `${id}.${sign(id)}`;
}

// The cookie value if we issued it (valid signature), else null: the request
// is then treated as a new shopper.
export function readShopperToken(value: string | undefined): string | null {
  const match = value ? TOKEN.exec(value) : null;
  if (!match) return null;
  const expected = Buffer.from(sign(match[1]));
  const given = Buffer.from(match[2]);
  return given.length === expected.length && timingSafeEqual(given, expected) ? value! : null;
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

// The product's name for the browser tab; null when it isn't in this shop.
export async function productName(shopId: string, productId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("products")
    .select("name")
    .eq("shop_id", shopId)
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(`products: ${error.message}`);
  return data?.name ?? null;
}

// Every product with its in-stock colors and sizes, description, size chart
// and the shop's return and shipping policies. Prices and stock come from the
// database, the same rows the AI tools read. `variants` keeps sold-out rows
// (stock 0) so the page can show a size as "Hết hàng" instead of hiding it.
export async function loadCatalog(shop: Shop): Promise<ShopCatalog> {
  const db = createAdminClient();
  const [products, policies] = await Promise.all([
    db
      .from("products")
      .select(
        "id, name, price, image_url, category, description, variants(color, size, stock), size_charts(size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)",
      )
      .eq("shop_id", shop.id)
      .order("code"),
    db.from("policies").select("kind, content").eq("shop_id", shop.id).in("kind", ["doi_tra", "giao_hang"]),
  ]);
  if (products.error) throw new Error(`products: ${products.error.message}`);
  if (policies.error) throw new Error(`policies: ${policies.error.message}`);
  const policy = (kind: "doi_tra" | "giao_hang") =>
    policies.data.find((row) => row.kind === kind)?.content.trim() ?? "";

  return {
    shop: { name: shop.name, policies: { returns: policy("doi_tra"), shipping: policy("giao_hang") } },
    products: products.data.map((product) => {
      const inStock = product.variants.filter((variant) => variant.stock > 0);
      return {
        id: product.id,
        name: product.name,
        price: product.price,
        imageUrl: product.image_url,
        category: product.category,
        description: product.description,
        colors: [...new Set(inStock.map((variant) => variant.color))].toSorted((a, b) => a.localeCompare(b, "vi")),
        sizesInStock: sortSizes(inStock.map((variant) => variant.size)),
        variants: product.variants.map(({ color, size, stock }) => ({ color, size, stock })),
        sizeChart: product.size_charts
          .map((row) => ({
            size: row.size,
            heightMinCm: row.height_min_cm,
            heightMaxCm: row.height_max_cm,
            weightMinKg: row.weight_min_kg,
            weightMaxKg: row.weight_max_kg,
          }))
          .toSorted((a, b) => a.heightMinCm - b.heightMinCm || a.weightMinKg - b.weightMinKg),
      };
    }),
  };
}

// The shopper's messages in this shop, oldest first, and the conversation's
// mode (PB-42); no messages and "ai" when they never wrote.
export async function loadHistory(
  shopId: string,
  externalId: string,
): Promise<{ messages: ChatMessage[]; mode: ConversationMode }> {
  const db = createAdminClient();
  // One conversation per shopper (conversations.shopper_id is unique).
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("id, mode, shoppers!inner(id)")
    .eq("shop_id", shopId)
    .eq("shoppers.shop_id", shopId)
    .eq("shoppers.channel", "web")
    .eq("shoppers.external_id", externalId)
    .maybeSingle();
  if (conversationError) throw new Error(`conversations: ${conversationError.message}`);
  if (!conversation) return { messages: [], mode: "ai" };
  const conversationId = conversation.id;

  const { data, error } = await db
    .from("messages")
    .select("id, sender, text, reply, created_at")
    .eq("shop_id", shopId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_SHOWN);
  if (error) throw new Error(`messages: ${error.message}`);

  const messages = data.toReversed().map((message) => {
    const reply = message.reply === null ? null : replySchema.safeParse(message.reply);
    return {
      id: message.id,
      sender: message.sender,
      text: message.text,
      reply: reply?.success ? reply.data : null,
      createdAt: message.created_at,
    };
  });
  return { messages, mode: conversation.mode };
}
