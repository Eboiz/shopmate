import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { idSchema } from "@/contract";
import { sendToConversation } from "@/lib/channels/send";
import { chatErrors, shopSlugSchema } from "@/lib/chat/request";
import {
  SHOPPER_COOKIE,
  SHOPPER_COOKIE_MAX_AGE,
  SHOPPER_COOKIE_PATH,
  findShop,
  newShopperToken,
  readShopperToken,
  shopperExternalId,
} from "@/lib/chat/web-chat";
import { WEB_CHAT_LIMIT_ERROR, clientHash, clientIp, takeWebChatSlot } from "@/lib/guard/web-chat-limit";
import {
  clientOrderIdSchema,
  customerSchema,
  ensureConversation,
  orderPlacedMessage,
  placeManualOrder,
} from "@/lib/orders/manual-order";
import { createAdminClient } from "@/lib/supabase/admin";

// Checkout from the shop page's basket, without the AI: the shopper fills in
// name, phone and address and the order is written as a draft at once, in the
// shopper's web chat conversation (made here for a visitor who never wrote).
// Staff confirm it on /admin/orders exactly like an order the AI took.
//
// POST { clientOrderId, items: [{productId, color, size, quantity, unitPrice}], customer: {name, phone, address} }
//   200 { orderId, total }
//   409 { code: "price_changed" | "out_of_stock" | "unavailable", message, lines? }
//   400 bad input, 404 no such shop, 429 rate limit, 500 failure

type Ctx = RouteContext<"/api/shops/[slug]/orders">;

const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

const lineSchema = z.object({
  productId: idSchema,
  color: z.string().max(60),
  size: z.string().max(30),
  quantity: z.int().min(1).max(99),
  unitPrice: z.int().positive(),
});
const bodySchema = z.object({
  clientOrderId: clientOrderIdSchema,
  items: z.array(lineSchema).min(1, "Giỏ hàng đang trống.").max(10, "Mỗi đơn tối đa 10 món."),
  customer: customerSchema,
});

const conflict = {
  price_changed: "Giá một vài món vừa thay đổi. Bạn mở lại giỏ để xem giá mới rồi đặt lại nhé.",
  out_of_stock: "Một vài món không còn đủ hàng. Bạn giảm số lượng hoặc bỏ món đó rồi đặt lại nhé.",
  unavailable: "Một vài món không còn bán. Bạn bỏ món đó khỏi giỏ rồi đặt lại nhé.",
} as const;

type Line = z.infer<typeof lineSchema>;
const lineLabel = (line: Line, name: string) => ({ productId: line.productId, color: line.color, size: line.size, name });

export async function POST(request: NextRequest, ctx: Ctx) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(chatErrors.invalidBody, 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0].message, 400);
  const { clientOrderId, items, customer } = parsed.data;

  const { slug } = await ctx.params;
  if (!shopSlugSchema.safeParse(slug).success) return fail(chatErrors.shopNotFound, 404);

  try {
    const shop = await findShop(slug);
    if (!shop) return fail(chatErrors.shopNotFound, 404);

    // The same per-IP and per-shop limits as the chat: an order is a write any
    // visitor can make.
    const existing = readShopperToken(request.cookies.get(SHOPPER_COOKIE)?.value);
    const limit = await takeWebChatSlot({ shopId: shop.id, clientHash: clientHash(clientIp(request.headers)), newShopper: !existing });
    if (limit !== "ok") return fail(WEB_CHAT_LIMIT_ERROR[limit], 429);

    // The basket keeps product, color and size; the variant is looked up here,
    // in this shop only.
    const db = createAdminClient();
    const { data: variants, error } = await db
      .from("variants")
      .select("id, color, size, product_id, products!inner(name)")
      .eq("shop_id", shop.id)
      .in("product_id", [...new Set(items.map((item) => item.productId))]);
    if (error) throw new Error(`variants: ${error.message}`);
    const variantOf = (line: Line) =>
      variants.find((v) => v.product_id === line.productId && v.color === line.color && v.size === line.size);
    const missing = items.filter((line) => !variantOf(line));
    if (missing.length > 0) {
      return NextResponse.json(
        { code: "unavailable", message: conflict.unavailable, lines: missing.map((line) => lineLabel(line, "")) },
        { status: 409, headers: noStore },
      );
    }
    const resolved = items.map((line) => ({ line, variant: variantOf(line)! }));

    const token = existing ?? newShopperToken();
    const conversationId = await ensureConversation(db, {
      shopId: shop.id,
      externalId: shopperExternalId(token),
      displayName: customer.name,
    });
    const result = await placeManualOrder(db, {
      shopId: shop.id,
      conversationId,
      quoteKey: `checkout:${clientOrderId}`,
      lines: resolved.map(({ line, variant }) => ({ variantId: variant.id, quantity: line.quantity, unitPrice: line.unitPrice })),
      customer,
    });

    let response: NextResponse;
    if (result.status === "created") {
      if (!result.replayed) {
        const lines = resolved.map(({ line, variant }) => ({
          name: variant.products.name,
          color: line.color,
          size: line.size,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }));
        // The order is written; a lost chat notice never fails the checkout.
        try {
          const sent = await sendToConversation(conversationId, orderPlacedMessage("shopper", lines, result.total, customer), { from: "system" });
          if (!sent.ok) console.warn(`checkout: notice for order ${result.orderId} not stored: ${sent.error}`);
        } catch (sendError) {
          console.error(`checkout: notice for order ${result.orderId} failed`, sendError);
        }
      }
      response = NextResponse.json({ orderId: result.orderId, total: result.total }, { headers: noStore });
    } else {
      const code = result.status === "variant_not_found" ? "unavailable" : result.status;
      const short = result.status === "out_of_stock"
        ? resolved.filter(({ variant }) => result.variantIds.includes(variant.id)).map(({ line, variant }) => lineLabel(line, variant.products.name))
        : undefined;
      response = NextResponse.json({ code, message: conflict[code], ...(short ? { lines: short } : {}) }, { status: 409, headers: noStore });
    }

    // A first-time visitor gets the chat cookie, so the chat shows the notice
    // and the shop's confirmation later.
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
  } catch (error) {
    console.error("checkout: failed", error);
    return fail("Chưa gửi được đơn hàng. Bạn thử lại sau ít phút nhé.", 500);
  }
}
