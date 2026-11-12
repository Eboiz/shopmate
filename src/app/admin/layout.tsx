import { Suspense, type ReactNode } from "react";
import { findStaffProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LoadingRegion, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";
import { AdminShell } from "./admin-shell";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[#f5f3ef]">
      <Suspense fallback={<AdminShellSkeleton />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
    </div>
  );
}

// Checks the session on the server before rendering any admin page; the
// proxy redirect alone is only an optimistic check.
async function AdminGate({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const staff = await findStaffProfile();
  const badges = staff ? { "/admin/ai-da-hoc": await countPendingFacts(staff.shopId) } : undefined;
  return <AdminShell email={user.email ?? ""} showNav={Boolean(staff)} badges={badges}>{staff ? children : <NoShopNotice />}</AdminShell>;
}

// PB-35a: the nav badge. A failed count shows no badge rather than breaking every page.
async function countPendingFacts(shopId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("learned_facts")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("status", "pending");
  return count ?? 0;
}

// A signed-in account with no profiles row belongs to no shop: every admin page
// would fail to load its data, so say what is wrong instead.
function NoShopNotice() {
  return (
    <section className="mx-auto max-w-md space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <h1 className="font-semibold">Tài khoản chưa được gắn với shop nào</h1>
      <p className="text-sm">
        Bạn đã đăng nhập, nhưng tài khoản này chưa thuộc shop nào nên chưa xem được hộp thư, đơn hàng và sản phẩm.
        Hãy nhờ chủ shop thêm tài khoản của bạn, hoặc đăng xuất rồi đăng nhập bằng tài khoản của shop.
      </p>
    </section>
  );
}

// The admin frame (header, nav, a page of cards) while the session is checked,
// so the screen keeps its layout instead of flashing a line of text.
function AdminShellSkeleton() {
  return (
    <LoadingRegion label="Đang tải trang quản lý…" className="flex flex-1 flex-col">
      <div className="flex min-h-18 items-center justify-between gap-4 border-b border-[#e3dfd8] bg-white px-4 py-3 sm:px-7 lg:px-9">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="h-6 w-28" />
        </div>
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="mx-auto flex w-full max-w-[1700px] flex-1">
        <div className="hidden w-60 shrink-0 space-y-2 bg-[#171717] px-3 py-7 lg:block">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} aria-hidden="true" className="h-12 w-full animate-pulse rounded-lg bg-[#292929]" />
          ))}
        </div>
        <div className="min-w-0 flex-1 px-4 py-8 sm:px-7 lg:px-10 lg:py-10">
          <PageHeaderSkeleton />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((card) => (
              <Skeleton key={card} className="h-44 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
