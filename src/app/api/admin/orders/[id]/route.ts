import { z } from "zod";
import { idSchema } from "@/contract";
import { sendToConversation } from "@/lib/channels/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const decisionSchema = z.strictObject({ status: z.enum(["confirmed", "cancelled"]) });

export async function PATCH(request: Request, { params }: RouteContext<"/api/admin/orders/[id]">) {
  const { id } = await params;
  const decision = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(id).success || !decision.success) {
    return Response.json({ code: "invalid_order_decision" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ code: "unauthorized" }, { status: 401 });

  const status = decision.data.status;
  const { data: conversationId, error } = await createAdminClient().rpc("decide_draft_order", {
    p_order_id: id,
    p_staff_id: user.id,
    p_status: status,
  });
  if (error) {
    if (error.code === "PT409") return Response.json({ code: error.message }, { status: 409 });
    if (error.code === "PT404") return Response.json({ code: "order_not_found" }, { status: 404 });
    if (error.code === "PT403") return Response.json({ code: "staff_required" }, { status: 403 });
    return Response.json({ code: "order_update_failed" }, { status: 500 });
  }

  const text = status === "confirmed"
    ? "Shop đã xác nhận đơn hàng của bạn. Cảm ơn bạn đã đặt hàng!"
    : "Shop đã hủy đơn hàng của bạn. Bạn có thể nhắn lại cho shop nếu cần hỗ trợ.";
  // The order is already committed. Delivery failure must not ask the UI to retry it.
  const delivery = await sendToConversation(conversationId, { text, products: [], quickReplies: [] }, { from: "system" })
    .catch(() => ({ ok: false }));

  return Response.json({ ok: true, notificationSent: delivery.ok });
}
