import { EmptyState } from "@/components/ui/empty-state";

export default function ShopNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center p-4">
      <div className="w-full"><EmptyState title="Không tìm thấy cửa hàng" description="Vui lòng kiểm tra lại đường dẫn." /></div>
    </main>
  );
}
