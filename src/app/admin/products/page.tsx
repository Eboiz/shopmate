import { EmptyState } from "@/components/ui/empty-state";

export default function ProductsPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Sản phẩm</h1>
      <EmptyState title="Sắp ra mắt" description="Giá, tồn kho, chính sách và món phối sẽ được quản lý ở đây." />
    </>
  );
}
