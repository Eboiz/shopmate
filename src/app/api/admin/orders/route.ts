import type { NextRequest } from "next/server";
import { z } from "zod";
import { idSchema } from "@/contract";
import { sendToConversation } from "@/lib/channels/send";
import { listDraftOrders } from "@/lib/orders/draft-orders";
import {
  clientOrderIdSchema,
  customerSchema,
  ensureConversation,
  orderPlacedMessage,
  placeManualOrder,
} from "@/lib/orders/manual-order";
import { staffSession } from "@/lib/staff-api";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/orders?status=draft (PB-12): the signed-in staff member's draft
// orders, newest first. Only drafts are listed; the page has nothing else to show.
const querySchema = z.object({ status: z.literal("draft", { error: "Chỉ hỗ trợ lọc đơn nháp (status=draft)." }) });

export async function GET(request: NextRequest) {
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return Response.json({ error: query.error.issues[0].message }, { status: 400 });

  const session = await staffSession();
  if (!session) return Response.json({ error: "Vui lòng đăng nhập bằng tài khoản nhân viên." }, { status: 401 });

  try {
    const orders = await listDraftOrders(session.db, session.staff.shopId);
    return Response.json({ orders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("orders: list failed", error);
    return Response.json({ error: "Không tải được danh sách đơn nháp." }, { status: 500 });
  }
}

// POST /api/admin/orders: an order staff take outside the chat (phone, Zalo,
// at the counter) or for a conversation in the inbox (conversationId). Written
// as a draft through the same RPC as the AI and the checkout, at the prices
// the form showed, so staff still confirm it (and take stock) on the list.
//   200 {orderId, total}
//   409 {code: "price_changed" | "out_of_stock" | "unavailable", message, variantIds?}
//   400 bad input, 401 not signed in as staff, 404 conversation not in this shop
const createSchema = z.object({
  clientOrderId: clientOrderIdSchema,
  conversationId: idSchema.nullish(),
  items: z
    .array(z.object({ variantId: idSchema, quantity: z.int().min(1, "Số lượng tối thiểu là 1.").max(99, "Số lượng tối đa là 99."), unitPrice: z.int().positive() }))
    .min(1, "Thêm ít nhất một sản phẩm.")
    .max(20, "Mỗi đơn tối đa 20 dòng."),
  customer: customerSchema,
});

const createConflict = {
  price_changed: "Giá sản phẩm vừa thay đổi. Tải lại trang để lấy giá mới rồi tạo lại đơn.",
  out_of_stock: "Một vài sản phẩm không còn đủ tồn kho.",
  unavailable: "Một vài sản phẩm không còn trong cửa hàng. Tải lại trang rồi chọn lại.",
} as const;

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }
  const body = createSchema.safeParse(raw);
  if (!body.success) return Response.json({ error: body.error.issues[0].message }, { status: 400 });
  const { clientOrderId, conversationId, items, customer } = body.data;

  const session = await staffSession();
  if (!session) return Response.json({ error: "Vui lòng đăng nhập bằng tài khoản nhân viên." }, { status: 401 });
  const shopId = session.staff.shopId;

  try {
    // Read with the staff member's own client: Row Level Security keeps the
    // conversation and the products to their shop. Only the write below uses
    // the secret key (the RPC is server-only), with the shop from the session.
    if (conversationId) {
      const { data, error } = await session.db.from("conversations").select("id").eq("id", conversationId).eq("shop_id", shopId).maybeSingle();
      if (error) throw new Error(`conversation: ${error.message}`);
      if (!data) return Response.json({ error: "Không tìm thấy hội thoại này." }, { status: 404 });
    }
    const { data: variants, error } = await session.db
      .from("variants")
      .select("id, color, size, products!inner(name)")
      .eq("shop_id", shopId)
      .in("id", [...new Set(items.map((item) => item.variantId))]);
    if (error) throw new Error(`variants: ${error.message}`);

    const db = createAdminClient();
    // No conversation: a web "shopper" of its own, in staff mode, so the AI never
    // answers it and the order still links to a thread in the inbox.
    const targetId = conversationId ?? await ensureConversation(db, {
      shopId,
      externalId: `staff-order:${clientOrderId}`,
      displayName: customer.name,
      mode: "staff",
    });
    const result = await placeManualOrder(db, {
      shopId,
      conversationId: targetId,
      quoteKey: `staff:${clientOrderId}`,
      lines: items,
      customer,
    });

    if (result.status !== "created") {
      const code = result.status === "variant_not_found" ? "unavailable" : result.status;
      return Response.json(
        { code, message: createConflict[code], ...(result.status === "out_of_stock" ? { variantIds: result.variantIds } : {}) },
        { status: 409 },
      );
    }
    // Tell the shopper in their own chat when the order was taken for one.
    if (conversationId && !result.replayed) {
      const lines = items.map((item) => {
        const variant = variants.find((v) => v.id === item.variantId);
        return { name: variant?.products.name ?? "Sản phẩm", color: variant?.color ?? "", size: variant?.size ?? "", quantity: item.quantity, unitPrice: item.unitPrice };
      });
      try {
        const sent = await sendToConversation(conversationId, orderPlacedMessage("staff", lines, result.total, customer), { from: "system" });
        if (!sent.ok) console.warn(`orders: notice for order ${result.orderId} not sent: ${sent.error}`);
      } catch (sendError) {
        console.error(`orders: notice for order ${result.orderId} failed`, sendError);
      }
    }
    return Response.json({ orderId: result.orderId, total: result.total, conversationId: targetId });
  } catch (error) {
    console.error("orders: create failed", error);
    return Response.json({ error: "Chưa tạo được đơn hàng. Vui lòng thử lại." }, { status: 500 });
  }
}
