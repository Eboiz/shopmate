import "server-only";
import { z } from "zod";
import { idSchema, type Reply } from "@/contract";
import type { Db } from "@/lib/engine/types";
import { formatPrice } from "@/lib/format";

// Manual orders: the shopper's checkout form on the shop page and the order
// staff type in on /admin/orders/new. Both write through the same RPC as the
// AI (engine_create_draft_order), so an order is still one transaction that
// checks prices and stock and never takes stock: staff confirm it on the
// orders page as before (PB-12). Every caller passes the secret-key client and
// a shop id it already checked; nothing here trusts the request for the shop.

// Spaces, dots and dashes are dropped and +84 becomes 0, so "0912 345 678" and
// "+84912345678" are both accepted; the database keeps 10 digits.
export function normalizePhone(value: string): string {
  const digits = value.replace(/[\s.\-()]/g, "");
  return digits.startsWith("+84") ? `0${digits.slice(3)}` : digits;
}

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập họ tên.").max(100, "Họ tên tối đa 100 ký tự."),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(/^0\d{9}$/, "Số điện thoại gồm 10 số, bắt đầu bằng 0.")),
  address: z.string().trim().min(1, "Vui lòng nhập địa chỉ giao hàng.").max(300, "Địa chỉ tối đa 300 ký tự."),
});
export type Customer = z.infer<typeof customerSchema>;

// One id per checkout attempt, made by the browser: a retry of the same
// attempt (double click, network retry) returns the order already written.
export const clientOrderIdSchema = z.uuid("Mã đơn không hợp lệ.");

export type ManualOrderLine = { variantId: string; quantity: number; unitPrice: number };

export type ManualOrderResult =
  | { status: "created"; orderId: string; total: number; replayed: boolean }
  | { status: "out_of_stock"; variantIds: string[] }
  | { status: "price_changed" }
  | { status: "variant_not_found" };

const rpcResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), orderId: idSchema, total: z.number().int().nonnegative() }),
  z.object({ status: z.literal("out_of_stock"), variantIds: z.array(idSchema) }),
  z.object({ status: z.literal("price_changed") }),
]);

// Writes the draft order. quoteKey is "checkout:<id>" or "staff:<id>", so it
// can never match an AI quote key (an ai_turns id). unitPrice is the price the
// person saw: a price that changed since returns price_changed, nothing written.
export async function placeManualOrder(
  db: Db,
  input: { shopId: string; conversationId: string; quoteKey: string; lines: ManualOrderLine[]; customer: Customer },
): Promise<ManualOrderResult> {
  // A replay is told apart so the caller sends its chat notice only once.
  const { data: existing, error: readError } = await db
    .from("orders")
    .select("id, total")
    .eq("shop_id", input.shopId)
    .eq("conversation_id", input.conversationId)
    .eq("quote_key", input.quoteKey)
    .maybeSingle();
  if (readError) throw new Error(`manual order: ${readError.message}`);
  if (existing) return { status: "created", orderId: existing.id, total: existing.total, replayed: true };

  const { data, error } = await db.rpc("engine_create_draft_order", {
    p_shop_id: input.shopId,
    p_conversation_id: input.conversationId,
    p_items: input.lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
    p_customer_name: input.customer.name,
    p_customer_phone: input.customer.phone,
    p_customer_address: input.customer.address,
    p_quote_key: input.quoteKey,
    p_expected_prices: input.lines.map(({ variantId, unitPrice }) => ({ variantId, unitPrice })),
  });
  if (error) {
    if (error.message.includes("variant_not_found")) return { status: "variant_not_found" };
    throw new Error(`engine_create_draft_order: ${error.message}`);
  }
  const result = rpcResultSchema.parse(data);
  return result.status === "created" ? { ...result, replayed: false } : result;
}

// The shopper's one conversation in the shop, created when missing (the same
// upsert as receiveChannelMessage). An existing conversation keeps its mode.
export async function ensureConversation(
  db: Db,
  input: { shopId: string; externalId: string; displayName?: string; mode?: "ai" | "staff" },
): Promise<string> {
  const shopperKey = { shop_id: input.shopId, channel: "web" as const, external_id: input.externalId };
  const upserted = await db
    .from("shoppers")
    .upsert({ ...shopperKey, channel_account_id: null, display_name: input.displayName ?? null }, {
      onConflict: "shop_id,channel,external_id",
      ignoreDuplicates: true,
    });
  if (upserted.error) throw new Error(`shopper: ${upserted.error.message}`);
  const shopper = await db.from("shoppers").select("id").match(shopperKey).single();
  if (shopper.error) throw new Error(`shopper read: ${shopper.error.message}`);
  // A web shopper has no name until they give one: the checkout form names
  // them in the inbox. A name staff or a channel already set is kept.
  if (input.displayName) {
    const named = await db.from("shoppers").update({ display_name: input.displayName }).eq("id", shopper.data.id).is("display_name", null);
    if (named.error) console.warn(`shopper name not saved: ${named.error.message}`);
  }

  const conversation = await db
    .from("conversations")
    .upsert({ shop_id: input.shopId, shopper_id: shopper.data.id, mode: input.mode ?? "ai" }, {
      onConflict: "shopper_id",
      ignoreDuplicates: true,
    });
  if (conversation.error) throw new Error(`conversation: ${conversation.error.message}`);
  const read = await db
    .from("conversations")
    .select("id")
    .eq("shop_id", input.shopId)
    .eq("shopper_id", shopper.data.id)
    .single();
  if (read.error) throw new Error(`conversation read: ${read.error.message}`);
  return read.data.id;
}

export type OrderLineView = { name: string; color: string; size: string; quantity: number; unitPrice: number };

// The note left in the conversation, so the shopper and the inbox both see
// what was ordered. Sent from "system": it shows in any conversation mode.
export function orderPlacedMessage(
  by: "shopper" | "staff",
  lines: OrderLineView[],
  total: number,
  customer: Customer,
): Reply {
  const items = lines
    .map((line) => `• ${line.name} (${[line.color, line.size && `size ${line.size}`].filter(Boolean).join(", ")}) × ${line.quantity}: ${formatPrice(line.unitPrice * line.quantity)}`)
    .join("\n");
  // A reply holds 1000 characters: a long order is counted instead of listed.
  const listed = items.length <= 600 ? items : `• ${lines.reduce((sum, line) => sum + line.quantity, 0)} sản phẩm (${lines.length} món)`;
  const head = by === "shopper" ? "Đã nhận đơn đặt hàng của bạn:" : "Shop đã tạo đơn hàng cho bạn:";
  const text = [
    head,
    listed,
    `Tổng tiền hàng: ${formatPrice(total)} (chưa gồm phí giao hàng).`,
    `Giao tới: ${customer.name}, ${customer.phone}, ${customer.address}.`.slice(0, 250),
    "Shop sẽ kiểm tra tồn kho và nhắn xác nhận đơn cho bạn.",
  ].join("\n");
  return { text, products: [], quickReplies: [] };
}
