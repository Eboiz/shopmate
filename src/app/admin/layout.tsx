import { Suspense, type ReactNode } from "react";
import { findStaffProfile, requireUser } from "@/lib/auth";
import { AdminShell } from "./admin-shell";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[#f5f3ef]">
      <Suspense fallback={<p className="px-4 py-6 text-[#706d67]">Đang tải...</p>}>
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
  return <AdminShell email={user.email ?? ""} showNav={Boolean(staff)}>{staff ? children : <NoShopNotice />}</AdminShell>;
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
