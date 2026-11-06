import { z } from "zod";
import { vndSchema, type OrderStatus } from "@/contract";

const draftOrderSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  customer: z.object({ name: z.string(), phone: z.string(), address: z.string() }),
  items: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    size: z.string(),
    color: z.string(),
    quantity: z.int().positive(),
    unitPrice: vndSchema,
  })),
  total: vndSchema,
});
const ordersResponseSchema = z.object({ orders: z.array(draftOrderSchema) });
const decisionSuccessSchema = z.object({ ok: z.literal(true) });
const decisionConflictSchema = z.object({ code: z.enum(["insufficient_stock", "not_draft"]) });

export type DraftOrder = z.infer<typeof draftOrderSchema>;
export type OrderDecision = Extract<OrderStatus, "confirmed" | "cancelled">;
export type OrdersMode = "api" | "demo";

export type OrderDecisionResult =
  | z.infer<typeof decisionSuccessSchema>
  | ({ ok: false } & z.infer<typeof decisionConflictSchema>);

const ordersEndpoint = "/api/admin/orders";

// Dates use ISO timestamps and all amounts are in đồng.
const mockOrders: DraftOrder[] = [
  {
    id: "demo-01",
    createdAt: "2026-11-05T09:20:00+07:00",
    customer: { name: "Hà My", phone: "0900000001", address: "Phường Bến Thành, TP. Hồ Chí Minh" },
    items: [
      { id: "demo-01-1", name: "Áo sơ mi linen", size: "M", color: "Trắng", quantity: 1, unitPrice: 320_000 },
    ],
    total: 320_000,
  },
  {
    id: "demo-02",
    createdAt: "2026-11-06T09:05:00+07:00",
    customer: { name: "Ngọc Thảo", phone: "0900000002", address: "Phường Thủ Đức, TP. Hồ Chí Minh" },
    items: [
      { id: "demo-02-1", name: "Áo thun cổ tròn", size: "S", color: "Kem", quantity: 2, unitPrice: 180_000 },
      { id: "demo-02-2", name: "Quần jeans ống suông", size: "M", color: "Xanh đậm", quantity: 1, unitPrice: 390_000 },
    ],
    total: 750_000,
  },
  {
    id: "demo-03",
    createdAt: "2026-11-06T08:30:00+07:00",
    customer: { name: "Minh Anh", phone: "0900000003", address: "Phường Hòa Hưng, TP. Hồ Chí Minh" },
    items: [
      { id: "demo-03-1", name: "Chân váy xếp ly", size: "M", color: "Đen", quantity: 2, unitPrice: 290_000 },
    ],
    total: 580_000,
  },
];

const outOfStockOrderId = "demo-03";
// In-memory demo state resets when the browser reloads the page.
const draftOrders = new Map(mockOrders.map((order) => [order.id, order]));

function simulateRequest() {
  return new Promise<void>((resolve) => setTimeout(resolve, 250));
}

export async function listDraftOrders(mode: OrdersMode): Promise<DraftOrder[]> {
  let orders: DraftOrder[];
  if (mode === "demo") {
    await simulateRequest();
    orders = [...draftOrders.values()];
  } else {
    const response = await fetch(`${ordersEndpoint}?status=draft`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load draft orders (${response.status})`);
    ({ orders } = ordersResponseSchema.parse(await response.json()));
  }

  return orders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function decideDraftOrder(
  id: string,
  decision: OrderDecision,
  mode: OrdersMode,
): Promise<OrderDecisionResult> {
  if (mode === "api") {
    const response = await fetch(`${ordersEndpoint}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: decision }),
    });

    if (response.status === 409) {
      const { code } = decisionConflictSchema.parse(await response.json());
      return { ok: false, code };
    }
    if (!response.ok) throw new Error(`Could not update the order (${response.status})`);
    return decisionSuccessSchema.parse(await response.json());
  }

  await simulateRequest();

  if (!draftOrders.has(id)) return { ok: false, code: "not_draft" };
  if (decision === "confirmed" && id === outOfStockOrderId) {
    return { ok: false, code: "insufficient_stock" };
  }

  draftOrders.delete(id);
  return { ok: true };
}
