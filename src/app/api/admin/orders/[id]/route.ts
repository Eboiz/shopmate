import type { NextRequest } from "next/server";
import { z } from "zod";
import { idSchema } from "@/contract";
import { decideDraftOrder } from "@/lib/orders/draft-orders";
import { staffSession } from "@/lib/staff-api";

// PATCH /api/admin/orders/:id {status: "confirmed" | "cancelled"} (PB-12).
//   200 {ok: true, notificationSent}   decided; notificationSent is false when the
//                                      shopper's channel refused the message
//   409 {code: "insufficient_stock" | "not_draft", message}
//   400 bad input, 401 not signed in as staff, 404 no such order in this shop
const bodySchema = z.object({
  status: z.enum(["confirmed", "cancelled"], { error: "Trạng thái phải là xác nhận hoặc hủy." }),
});

const conflictMessages = {
  insufficient_stock: "Không đủ tồn kho để xác nhận đơn này.",
  not_draft: "Đơn này đã được xử lý trước đó.",
} as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "Mã đơn hàng không hợp lệ." }, { status: 400 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return Response.json({ error: body.error.issues[0].message }, { status: 400 });

  const session = await staffSession();
  if (!session) return Response.json({ error: "Vui lòng đăng nhập bằng tài khoản nhân viên." }, { status: 401 });

  let result;
  try {
    result = await decideDraftOrder(session.db, id, body.data.status);
  } catch (error) {
    console.error(`orders: deciding order ${id} failed`, error);
    return Response.json({ error: "Chưa xử lý được đơn hàng. Vui lòng thử lại." }, { status: 500 });
  }

  switch (result.status) {
    case "confirmed":
    case "cancelled":
      return Response.json({ ok: true, notificationSent: result.notificationSent });
    case "insufficient_stock":
    case "not_draft":
      return Response.json({ code: result.status, message: conflictMessages[result.status] }, { status: 409 });
    case "not_found":
      return Response.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
  }
}
