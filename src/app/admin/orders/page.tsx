import { EmptyState } from "@/components/ui/empty-state";

export default function OrdersPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Đơn hàng</h1>
      <EmptyState title="Sắp ra mắt" description="Các đơn nháp cần xác nhận sẽ hiện ở đây." />
    </>
  );
}
