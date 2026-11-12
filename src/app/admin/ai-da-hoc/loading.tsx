import { LoadingRegion, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

// Shown while the page reads the role and what the AI learned. The admin
// header and nav stay on screen; only this area waits.
export default function LearningLoading() {
  return (
    <LoadingRegion label="Đang tải AI đã học…">
      <PageHeaderSkeleton />
      <Skeleton className="mb-5 h-16 w-full rounded-2xl" />
      <div className="mb-6 flex gap-2 border-b border-[#e3dfd8] pb-2">
        {[0, 1, 2, 3].map((tab) => (
          <Skeleton key={tab} className="h-11 w-28 shrink-0 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {[0, 1].map((card) => (
          <div key={card} className="ui-card flex flex-col gap-3 p-5">
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
            <div className="flex gap-2 self-end">
              <Skeleton className="h-11 w-16 rounded-lg" />
              <Skeleton className="h-11 w-16 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
