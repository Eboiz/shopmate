import { Suspense } from "react";
import { DraftOrders } from "./draft-orders";

export default function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  return (
    <section className="mx-auto max-w-2xl">
      <Suspense fallback={<p role="status">Đang tải đơn nháp…</p>}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function OrdersContent({ searchParams }: Pick<PageProps<"/admin/orders">, "searchParams">) {
  const { demo } = await searchParams;
  const mode = demo === "1" ? "demo" : "api";

  return (
    <>
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">Đơn hàng</h1>
          {mode === "demo" && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
              Dữ liệu mẫu
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">Kiểm tra và xử lý các đơn hàng nháp.</p>
      </header>
      <DraftOrders key={mode} mode={mode} />
    </>
  );
}
