import { NextResponse, type NextRequest } from "next/server";
import { receiveChannelMessage } from "@/lib/channels/receive";
import { chatErrors, chatPostSchema, firstIssue, shopSlugSchema } from "@/lib/chat/request";
import {
  SHOPPER_COOKIE,
  SHOPPER_COOKIE_MAX_AGE,
  SHOPPER_COOKIE_PATH,
  findShop,
  loadHistory,
  newShopperToken,
  productInShop,
  readShopperToken,
  shopperExternalId,
} from "@/lib/chat/web-chat";
import { WEB_CHAT_LIMIT_ERROR, clientHash, clientIp, takeWebChatSlot } from "@/lib/guard/web-chat-limit";

// Web chat (PB-04). The shop page polls GET every 3 seconds while the chat is
// open, so staff replies (PB-13) and order updates (PB-12), which
// sendToConversation stores as messages, show without a reload. The browser
// never reads Supabase itself.

// POST runs a whole AI turn (up to 5 tool calls, plus the after() turn log)
// before it answers. 120 s leaves room for a slow turn and stays within Vercel
// Hobby's 300 s limit (Fluid compute).
export const maxDuration = 120;

type Ctx = RouteContext<"/api/shops/[slug]/chat">;

const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

async function shopFrom(ctx: Ctx) {
  const { slug } = await ctx.params;
  return shopSlugSchema.safeParse(slug).success ? findShop(slug) : null;
}

// GET: the shopper's conversation in this shop (empty for a new visitor).
export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const shop = await shopFrom(ctx);
    if (!shop) return fail(chatErrors.shopNotFound, 404);
    const token = readShopperToken(request.cookies.get(SHOPPER_COOKIE)?.value);
    const messages = token ? await loadHistory(shop.id, shopperExternalId(token)) : [];
    return Response.json({ messages }, { headers: noStore });
  } catch (error) {
    console.error("web chat: history failed", error);
    return fail(chatErrors.historyFailed, 500);
  }
}

// POST { text, productId, clientMessageId }: store the shopper's message and,
// while the conversation is in `ai` mode, answer it before responding (the page
// shows its typing indicator meanwhile). Same core as Messenger and Telegram:
// dedupe (by clientMessageId), PB-17 rate limit, mode gate, engine, handoff.
export async function POST(request: NextRequest, ctx: Ctx) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(chatErrors.invalidBody, 400);
  }
  const parsed = chatPostSchema.safeParse(body);
  if (!parsed.success) return fail(firstIssue(parsed.error), 400);
  const { text, productId, clientMessageId } = parsed.data;

  try {
    const shop = await shopFrom(ctx);
    if (!shop) return fail(chatErrors.shopNotFound, 404);
    if (productId && !(await productInShop(shop.id, productId))) {
      return fail(chatErrors.productNotFound, 400);
    }

    const existing = readShopperToken(request.cookies.get(SHOPPER_COOKIE)?.value);
    // Before any shopper, conversation or AI turn: limits per client IP and per
    // shop, which dropping the cookie can't reset (PB-17 counts per conversation).
    const limit = await takeWebChatSlot({
      shopId: shop.id,
      clientHash: clientHash(clientIp(request.headers)),
      newShopper: !existing,
    });
    if (limit !== "ok") {
      console.warn(`web chat: ${limit} limit reached for shop ${shop.id}`);
      return fail(WEB_CHAT_LIMIT_ERROR[limit], 429);
    }

    const token = existing ?? newShopperToken();
    // A new visitor gets the cookie even when the turn fails after their message
    // was stored, so a retry or a reload finds the same conversation.
    const withCookie = (response: NextResponse) => {
      if (!existing) {
        response.cookies.set(SHOPPER_COOKIE, token, {
          httpOnly: true,
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
          path: SHOPPER_COOKIE_PATH,
          maxAge: SHOPPER_COOKIE_MAX_AGE,
        });
      }
      return response;
    };

    try {
      const status = await receiveChannelMessage(
        { channel: "web", shopId: shop.id },
        { externalId: shopperExternalId(token), messageId: clientMessageId, text, productId: productId ?? null },
      );
      return withCookie(NextResponse.json({ status }, { headers: noStore }));
    } catch (error) {
      console.error("web chat: receive failed", error);
      return withCookie(fail(chatErrors.sendFailed, 500));
    }
  } catch (error) {
    console.error("web chat: send failed", error);
    return fail(chatErrors.sendFailed, 500);
  }
}
