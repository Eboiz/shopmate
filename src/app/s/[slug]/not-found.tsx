import { EmptyState } from "@/components/ui/empty-state";

export default function ShopNotFound() {
  return (
    <main className="flex-1 p-4">
      <EmptyState title="Không tìm thấy cửa hàng" description="Vui lòng kiểm tra lại đường dẫn." />
    </main>
  );
}
