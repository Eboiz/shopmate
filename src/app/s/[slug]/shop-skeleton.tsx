import { ProductCardSkeleton } from "@/components/ui/product-card";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

// Shop pages while the route resolves and the catalog is fetched. Server-safe,
// so the page's Suspense fallback and ShopFront itself show the same frame.
// Each block copies the size classes of the real section in shop-front.tsx and
// product-detail-view.tsx, so nothing below moves when the data arrives.

function ShopHeaderSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div className="border-b border-[#e3dfd8] bg-white">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-none" />
          <Skeleton className="h-6 w-36" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className={detail ? "h-11 w-24 rounded-lg" : "h-11 w-20 rounded-none sm:w-40"} />
        </div>
      </div>
    </div>
  );
}

export function ShopFrontSkeleton() {
  return (
    <LoadingRegion label="Đang tải cửa hàng…" className="flex-1">
      {/* The announcement bar is fixed text: show it as is. */}
      <div aria-hidden="true" className="bg-[#171717] px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[.08em] text-white sm:text-xs sm:tracking-[.16em]">Tìm đúng món đồ bạn yêu · Tư vấn 24/7</div>
      <ShopHeaderSkeleton />

      <div className="bg-[#171717]">
        <div className="mx-auto grid min-h-[560px] max-w-[1400px] lg:grid-cols-[1.05fr_.95fr]">
          <div className="flex flex-col justify-center px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
            {/* Three lines of the hero headline: clamp(2.25rem,6vw,5.5rem) at leading 1.02. */}
            <div className="max-w-2xl space-y-[.27em] py-[.135em] text-[clamp(2.25rem,6vw,5.5rem)]">
              {["w-[4em]", "w-[7em]", "w-[5em]"].map((width) => (
                <Skeleton key={width} tone="dark" className={`h-[.75em] max-w-full ${width}`} />
              ))}
            </div>
            <div className="mt-7 max-w-md space-y-3 py-1.5">
              <Skeleton tone="dark" className="h-4 w-full" />
              <Skeleton tone="dark" className="h-4 w-11/12" />
              <Skeleton tone="dark" className="h-4 w-2/3" />
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Skeleton tone="dark" className="h-12 w-44 rounded-none" />
              <Skeleton tone="dark" className="h-12 w-52 rounded-none" />
            </div>
          </div>
          <div aria-hidden="true" className="min-h-[320px] animate-pulse bg-[#33312d] lg:min-h-full" />
        </div>
      </div>
      <div aria-hidden="true" className="border-y border-[#171717] bg-[#e9573f] py-3"><div className="h-4" /></div>

      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20 lg:px-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Skeleton className="h-10 w-72 max-w-full sm:h-12" />
            <Skeleton className="mt-3 h-4 w-64 max-w-full" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mb-7 flex flex-col gap-3 border-y border-[#e3dfd8] py-4 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-11 w-full sm:w-72" />
          <Skeleton className="h-11 w-52" />
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
      <ShopHeaderSkeleton detail />
      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <Skeleton className="mb-6 h-4 w-60 max-w-full" />
        <div className="grid overflow-hidden rounded-xl border border-[#e3dfd8] bg-white lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
          <div className="p-4 sm:p-6">
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="mt-3 h-4 w-48" />
          </div>
          <div className="flex flex-col border-t border-[#e3dfd8] p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
            <Skeleton className="h-9 w-4/5 sm:h-10" />
            <Skeleton className="mt-6 h-[5.5rem] w-full rounded-lg sm:h-24" />
            <Skeleton className="mt-7 mb-3 h-5 w-28" />
            <div className="flex gap-2">
              {[0, 1, 2].map((option) => (
                <Skeleton key={option} className="h-11 w-20 rounded-lg" />
              ))}
            </div>
            <Skeleton className="mt-6 mb-3 h-5 w-24" />
            <div className="flex gap-2">
              {[0, 1, 2, 3].map((option) => (
                <Skeleton key={option} className="h-11 w-12 rounded-lg" />
              ))}
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
