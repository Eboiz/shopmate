import { DraftOrders } from "./draft-orders";

export default function OrdersPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">Đơn hàng</h1>
        <p className="mt-1 text-sm text-zinc-500">Kiểm tra và xử lý các đơn hàng nháp.</p>
      </header>
      <DraftOrders />
    </section>
  );
}
