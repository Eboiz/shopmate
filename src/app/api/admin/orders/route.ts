import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  if (status !== null && status !== "draft") {
    return Response.json({ code: "invalid_status" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ code: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("orders")
    .select("id, created_at, customer_name, customer_phone, customer_address, total, order_items(id, quantity, unit_price, variants!inner(size, color, products!inner(name)))")
    .eq("status", "draft")
    .order("created_at", { ascending: false });

  if (error) return Response.json({ code: "orders_unavailable" }, { status: 500 });

  const orders = data.map((order) => ({
    id: order.id,
    createdAt: order.created_at,
    customer: { name: order.customer_name, phone: order.customer_phone, address: order.customer_address },
    total: order.total,
    items: order.order_items.map(({ id, quantity, unit_price, variants }) => ({
      id,
      quantity,
      unitPrice: unit_price,
      name: variants.products.name,
      size: variants.size,
      color: variants.color,
    })),
  }));

  return Response.json({ orders }, { headers: { "Cache-Control": "private, no-store" } });
}
