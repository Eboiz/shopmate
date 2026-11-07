import type { NextRequest } from "next/server";
import { z } from "zod";
import { listDraftOrders } from "@/lib/orders/draft-orders";
import { staffSession } from "@/lib/staff-api";

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
