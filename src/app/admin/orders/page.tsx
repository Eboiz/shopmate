import Link from "next/link";
import { DraftOrders } from "./draft-orders";

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const { created } = await searchParams;
  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="ui-page-title">Đơn hàng</h1>
          <p className="mt-2 text-sm text-[#706d67]">Đơn khách chốt qua chat, đặt từ giỏ hàng hoặc shop tạo thủ công, chờ shop kiểm tra rồi xác nhận.</p>
        </div>
        <Link
          href="/admin/orders/new"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#171717] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#c2412b]"
        >
          + Tạo đơn
        </Link>
      </header>
      <DraftOrders justCreated={created === "1"} />
    </section>
  );
}
