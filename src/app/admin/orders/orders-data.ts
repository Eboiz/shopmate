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
const decisionSuccessSchema = z.object({ ok: z.literal(true), notificationSent: z.boolean() });
const decisionConflictSchema = z.object({ code: z.enum(["insufficient_stock", "not_draft"]) });

export type DraftOrder = z.infer<typeof draftOrderSchema>;
export type OrderDecision = Extract<OrderStatus, "confirmed" | "cancelled">;

const ordersEndpoint = "/api/admin/orders";

export async function listDraftOrders(): Promise<DraftOrder[]> {
  const response = await fetch(`${ordersEndpoint}?status=draft`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load draft orders (${response.status})`);
  return ordersResponseSchema.parse(await response.json()).orders;
}

export async function decideDraftOrder(id: string, decision: OrderDecision) {
  const response = await fetch(`${ordersEndpoint}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: decision }),
  });

  if (response.status === 409) {
    const { code } = decisionConflictSchema.parse(await response.json());
    return { ok: false as const, code };
  }
  if (!response.ok) throw new Error(`Could not update the order (${response.status})`);
  return decisionSuccessSchema.parse(await response.json());
}
