import { LoadingRegion, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

// Shown while the products page reads the role and the catalog. The admin
// header and nav stay on screen; only this area waits.
export default function ProductsLoading() {
  return (
    <LoadingRegion label="Đang tải sản phẩm…">
      <PageHeaderSkeleton />
      <div className="mb-6 flex gap-2 border-b border-[#e3dfd8] pb-2">
        {[0, 1, 2].map((tab) => (
          <Skeleton key={tab} className="h-11 w-28 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((card) => (
          <div key={card} className="ui-card flex flex-col gap-4 p-5 sm:p-6">
            <Skeleton className="h-6 w-48" />
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-11 w-full rounded-xl" />
                </div>
                <Skeleton className="h-11 w-16 rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
