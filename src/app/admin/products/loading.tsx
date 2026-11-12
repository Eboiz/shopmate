import { LoadingRegion, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

// Shown while the products page reads the role and the catalog. The admin
// header and nav stay on screen; only this area waits. Same frame as the
// folded product list: search row, then one short row per product.
export default function ProductsLoading() {
  return (
    <LoadingRegion label="Đang tải sản phẩm…">
      <PageHeaderSkeleton />
      <div className="mb-6 flex gap-2 border-b border-[#e3dfd8] pb-2">
        {[0, 1, 2, 3].map((tab) => (
          <Skeleton key={tab} className="h-11 w-24 rounded-xl" />
        ))}
      </div>
      <div className="mb-4 flex gap-3">
        <Skeleton className="h-11 flex-1 rounded-lg" />
        <Skeleton className="h-11 w-36 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="ui-card flex items-center gap-3 px-4 py-3 sm:px-5">
            <Skeleton className="size-12 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
