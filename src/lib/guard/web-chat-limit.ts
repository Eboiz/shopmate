import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// PB-04 on top of PB-17: limits the web chat client cannot reset.
//
// PB-17 counts per conversation, and a web shopper is only a cookie: dropping it
// gives a new shopper and a new conversation. So the web chat route asks this
// first, before it creates a shopper or calls the AI, counting per client IP
// (stored as an HMAC, never the raw IP) and per shop. Stored in Postgres
// (web_chat_hits, web_chat_take), because serverless instances share no memory.
//
// Sized for a shared IP: a class demo on one Wi-Fi, a café, a mobile carrier's
// NAT. PB-17 still allows each conversation only 10 messages per minute.
export const WEB_CHAT_LIMIT = {
  // Messages from one IP, all shops together.
  clientPerMinute: 30,
  // Requests without the shopper cookie (each may create a shopper and an AI turn).
  newShoppersPerHour: 20,
  // Messages from one IP to one shop: a quarter of the shop's ceiling, so one
  // client (or two) can't use up the shop's chat for everyone.
  clientShopPerMinute: 15,
  // Ceiling for the whole shop, many IPs together: bounds AI spend per shop.
  shopPerMinute: 60,
} as const;

export type WebChatLimitResult = "ok" | "client" | "client_shop" | "new_shopper" | "shop";

export const WEB_CHAT_LIMIT_ERROR: Record<Exclude<WebChatLimitResult, "ok">, string> = {
  client: "Bạn nhắn hơi nhanh rồi ạ. Bạn chờ khoảng một phút rồi nhắn tiếp nhé!",
  client_shop: "Bạn nhắn hơi nhanh rồi ạ. Bạn chờ khoảng một phút rồi nhắn tiếp nhé!",
  new_shopper: "Có quá nhiều cuộc trò chuyện mới từ mạng của bạn. Vui lòng thử lại sau ít phút.",
  shop: "Shop đang nhận quá nhiều tin nhắn. Vui lòng thử lại sau một phút.",
};

// The client's IP as Vercel reports it: x-real-ip, else the first hop of
// x-forwarded-for (Vercel overwrites both, so the client can't spoof them there).
// Requests with neither (local dev) share one bucket.
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

// Keyed hash: an IPv4 address is easy to brute-force from a plain SHA-256.
// The secret key is always set on the server and never leaves it.
export function clientHash(ip: string): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createHmac("sha256", key).update(`web-chat-ip:${ip}`).digest("base64url");
}

// Records the request and returns "ok", or returns the limit it is over and
// records nothing. Throws when the database can't answer: the route then
// refuses the message rather than call the paid AI unchecked.
export async function takeWebChatSlot(input: {
  shopId: string;
  clientHash: string;
  newShopper: boolean;
}): Promise<WebChatLimitResult> {
  const { data, error } = await createAdminClient().rpc("web_chat_take", {
    p_shop_id: input.shopId,
    p_client_hash: input.clientHash,
    p_new_shopper: input.newShopper,
    p_client_per_minute: WEB_CHAT_LIMIT.clientPerMinute,
    p_new_shoppers_per_hour: WEB_CHAT_LIMIT.newShoppersPerHour,
    p_shop_per_minute: WEB_CHAT_LIMIT.shopPerMinute,
    p_client_shop_per_minute: WEB_CHAT_LIMIT.clientShopPerMinute,
  });
  if (error) throw new Error(`web_chat_take: ${error.message}`);
  if (data === "ok" || data === "client" || data === "client_shop" || data === "new_shopper" || data === "shop") {
    return data;
  }
  throw new Error(`web_chat_take: unexpected result ${String(data)}`);
}
