import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { requireStaff } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { isUnnamed } from "../../inbox/inbox-filter";
import { NewOrderForm, type OrderFormProduct } from "./new-order-form";

// /admin/orders/new: staff type in an order taken outside the AI chat. With
// ?c=<conversation id> (the inbox's "Tạo đơn"), the order belongs to that
// conversation and the customer fields start from what the shop already knows.
export default async function NewOrderPage({ searchParams }: PageProps<"/admin/orders/new">) {
  const params = await searchParams;
  const { shopId } = await requireStaff();
  const requested = typeof params.c === "string" ? params.c : null;

  const db = await createClient();
  const [{ products }, conversation] = await Promise.all([
    getCatalog(shopId),
    requested
      ? db.from("conversations").select("id, shoppers!inner(display_name)").eq("id", requested).eq("shop_id", shopId).maybeSingle()
      : null,
  ]);
  const conversationId = conversation?.data?.id ?? null;
  const lastOrder = conversationId
    ? (await db
        .from("orders")
        .select("customer_name, customer_phone, customer_address")
        .eq("shop_id", shopId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()).data
    : null;
  const shopperName = conversation?.data?.shoppers.display_name;

  const formProducts: OrderFormProduct[] = products.map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    price: product.price,
    variants: product.variants.map(({ id, color, size, stock }) => ({ id, color, size, stock })),
  }));

  return (
    <section className="mx-auto max-w-3xl">
      <Link href="/admin/orders" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[#706d67] hover:text-[#171717]">
        <Icon name="chevron" className="size-4 rotate-90" />
        Đơn hàng
      </Link>
      <header className="mb-7">
        <h1 className="ui-page-title">Tạo đơn thủ công</h1>
        <p className="mt-2 text-sm text-[#706d67]">
          {conversationId
            ? "Đơn cho khách trong hội thoại này. Khách sẽ nhận tin báo đơn trong chat."
            : "Đơn khách đặt qua điện thoại, Zalo hoặc tại cửa hàng. Đơn vào danh sách chờ xác nhận như đơn từ chat."}
        </p>
      </header>
      <NewOrderForm
        products={formProducts}
        conversationId={conversationId}
        initialCustomer={{
          name: lastOrder?.customer_name ?? (shopperName && !isUnnamed(shopperName) ? shopperName.trim() : ""),
          phone: lastOrder?.customer_phone ?? "",
          address: lastOrder?.customer_address ?? "",
        }}
      />
    </section>
  );
}
