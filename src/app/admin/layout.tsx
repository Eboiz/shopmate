import { Suspense, type ReactNode } from "react";
import { requireUser } from "@/lib/auth";
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
      <main className="flex-1 px-4 py-6">{children}</main>
      <AdminNav />
    </>
  );
}
