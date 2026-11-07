import { DraftOrders } from "./draft-orders";

export default function OrdersPage() {
  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-7">
        <p className="ui-eyebrow mb-2">Quản lý bán hàng</p>
        <h1 className="ui-page-title">Đơn hàng</h1>
        <p className="mt-2 text-sm text-[#706d67]">Kiểm tra và xử lý các đơn hàng nháp.</p>
      </header>
      <DraftOrders />
    </section>
  );
}
