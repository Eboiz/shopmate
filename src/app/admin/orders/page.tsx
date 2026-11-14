import { DraftOrders } from "./draft-orders";

export default function OrdersPage() {
  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-7">
        <h1 className="ui-page-title">Đơn hàng</h1>
        <p className="mt-2 text-sm text-[#706d67]">Đơn khách chốt qua chat, chờ shop kiểm tra rồi xác nhận.</p>
      </header>
      <DraftOrders />
    </section>
  );
}
