import { Suspense, type ReactNode } from "react";
import { findStaffProfile, requireUser } from "@/lib/auth";
import { signOut } from "../login/actions";
import { AdminNav } from "./admin-nav";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<p className="px-4 py-6 text-zinc-500">Đang tải...</p>}>
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

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <span className="font-semibold">ShopMate</span>
        <form action={signOut} className="flex min-w-0 items-center gap-3 text-sm">
          <span className="truncate text-zinc-500">{user.email}</span>
          <button type="submit" className="shrink-0 underline">
            Đăng xuất
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 py-6">{staff ? children : <NoShopNotice />}</main>
      {staff && <AdminNav />}
    </>
  );
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
