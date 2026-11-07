import { ProductCardSkeleton } from "@/components/ui/product-card";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

// Shop pages while the route resolves and the catalog is fetched. Server-safe,
// so the page's Suspense fallback and ShopFront itself show the same frame.

function ShopHeaderSkeleton() {
  return (
    <div className="border-b border-[#e3dfd8] bg-white">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-none" />
          <Skeleton className="h-6 w-36" />
        </div>
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}

export function ShopFrontSkeleton() {
  return (
    <LoadingRegion label="Đang tải cửa hàng…" className="flex-1">
      <ShopHeaderSkeleton />
      <div aria-hidden="true" className="min-h-[420px] animate-pulse bg-[#2a2926] lg:min-h-[560px]" />
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="mb-8 space-y-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-10 w-72 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function ProductDetailSkeleton() {
  return (
    <LoadingRegion label="Đang tải sản phẩm…" className="min-h-dvh flex-1 bg-[#f5f3ef]">
      <ShopHeaderSkeleton />
      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <Skeleton className="mb-6 h-3 w-60" />
        <div className="grid overflow-hidden rounded-xl border border-[#e3dfd8] bg-white lg:grid-cols-2">
          <div className="p-4 sm:p-6">
            <Skeleton className="aspect-square w-full rounded-lg" />
          </div>
          <div className="space-y-6 border-t border-[#e3dfd8] p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <div className="flex gap-2">
              {[0, 1, 2].map((option) => (
                <Skeleton key={option} className="h-11 w-20 rounded-lg" />
              ))}
            </div>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map((option) => (
                <Skeleton key={option} className="h-11 w-12 rounded-lg" />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
