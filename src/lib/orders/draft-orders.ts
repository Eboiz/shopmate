import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { idSchema, type Database, type Reply } from "@/contract";
import { sendToConversation } from "@/lib/channels/send";
import { formatPrice } from "@/lib/format";

// Orders page (PB-12). Both functions take the signed-in staff member's client
// (cookie session), so Row Level Security and decide_draft_order scope every
// read and write to their own shop; the shop never comes from the request.
type Db = SupabaseClient<Database>;

export type OrderDecision = "confirmed" | "cancelled";

// The shape /admin/orders reads (src/app/admin/orders/orders-data.ts).
export type DraftOrderView = {
  id: string;
  createdAt: string;
  customer: { name: string; phone: string; address: string };
  items: { id: string; name: string; size: string; color: string; quantity: number; unitPrice: number }[];
  total: number;
};

export async function listDraftOrders(db: Db, shopId: string): Promise<DraftOrderView[]> {
  const { data, error } = await db
    .from("orders")
    .select(
      "id, created_at, customer_name, customer_phone, customer_address, total, order_items(id, quantity, unit_price, variants(size, color, products(name)))",
    )
    .eq("shop_id", shopId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw new Error(`Could not read draft orders: ${error.message}`);

  return data.map((order) => ({
    id: order.id,
    createdAt: order.created_at,
    customer: { name: order.customer_name, phone: order.customer_phone, address: order.customer_address },
    items: order.order_items
      .map((item) => ({
        id: item.id,
        name: item.variants.products.name,
        size: item.variants.size,
        color: item.variants.color,
        quantity: item.quantity,
        unitPrice: item.unit_price,
      }))
      .sort((x, y) => x.name.localeCompare(y.name, "vi") || x.size.localeCompare(y.size) || x.color.localeCompare(y.color)),
    total: order.total,
  }));
}

const rpcResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["confirmed", "cancelled"]), conversationId: idSchema, total: z.int().nonnegative() }),
  z.object({ status: z.literal("insufficient_stock"), variantIds: z.array(idSchema) }),
  z.object({ status: z.literal("not_draft") }),
  z.object({ status: z.literal("not_found") }),
]);

export type DecisionResult =
  | { status: OrderDecision; notificationSent: boolean }
  | { status: "insufficient_stock" | "not_draft" | "not_found" };

// The message the shopper gets in their chat. The total comes from the order row.
export function decisionMessage(decision: OrderDecision, total: number): Reply {
  const text =
    decision === "confirmed"
      ? `Shop đã xác nhận đơn hàng của bạn, tổng tiền hàng ${formatPrice(total)} (chưa gồm phí giao hàng). Cảm ơn bạn đã mua hàng!`
      : "Đơn hàng của bạn đã được hủy. Nếu bạn vẫn muốn mua, cứ nhắn cho shop nhé.";
  return { text, products: [], quickReplies: [] };
}

// Confirms (status + stock in one transaction) or cancels, then tells the
// shopper. A failed notification never undoes the decision: it is reported as
// notificationSent: false so staff can message the shopper themselves.
export async function decideDraftOrder(db: Db, orderId: string, decision: OrderDecision): Promise<DecisionResult> {
  const { data, error } = await db.rpc("decide_draft_order", { p_order_id: orderId, p_decision: decision });
  if (error) throw new Error(`decide_draft_order failed: ${error.message}`);
  const result = rpcResultSchema.parse(data);
  if (result.status !== "confirmed" && result.status !== "cancelled") return { status: result.status };

  let notificationSent = false;
  try {
    const sent = await sendToConversation(result.conversationId, decisionMessage(result.status, result.total), {
      from: "system",
    });
    notificationSent = sent.ok;
    if (!sent.ok) console.warn(`orders: notification for order ${orderId} not sent: ${sent.error}`);
  } catch (sendError) {
    console.error(`orders: notification for order ${orderId} failed`, sendError);
  }
  return { status: result.status, notificationSent };
}
