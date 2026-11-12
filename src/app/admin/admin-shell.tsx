import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { signOut } from "../login/actions";
import { AdminNav } from "./admin-nav";

export function AdminShell({ children, email, previewPath, showNav = true, pendingFacts }: { children: ReactNode; email?: string; previewPath?: string; showNav?: boolean; pendingFacts?: Promise<number> }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[#f5f3ef]">
      <header className="sticky top-0 z-30 flex min-h-18 items-center justify-between gap-4 border-b border-[#e3dfd8] bg-white/95 px-4 py-3 backdrop-blur-xl sm:px-7 lg:px-9">
        <Link href="/admin" className="flex shrink-0 items-center gap-3" aria-label="ShopMate - Tổng quan">
          <span aria-hidden="true" className="relative flex size-10 items-center justify-center rounded-lg bg-[#171717] text-xl font-black text-white">S<span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-[#e9573f]" /></span>
          <span className="text-xl font-black tracking-[-.06em]">ShopMate<span className="text-[#e9573f]">.</span></span>
        </Link>
        <span className="hidden rounded-full border border-[#e3dfd8] px-3 py-1 text-[10px] font-bold uppercase tracking-[.18em] text-[#706d67] md:block">Không gian quản lý</span>
        {previewPath ? <Link href="/dev/login" title="Xem giao diện đăng nhập" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#e3dfd8] px-3 text-xs font-bold text-[#171717] hover:border-[#171717]"><Icon name="logout" className="size-4" /><span className="hidden sm:inline">Về đăng nhập</span></Link> : (
          <form action={signOut} className="flex min-w-0 items-center gap-3 text-sm">
            <span className="max-w-28 truncate text-xs text-[#706d67] sm:max-w-52 sm:text-sm">{email}</span>
            <button type="submit" aria-label="Đăng xuất" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#e3dfd8] bg-white px-3 text-xs font-bold text-[#171717] transition-colors hover:border-[#171717] hover:bg-[#f5f3ef]"><Icon name="logout" className="size-4" /><span className="hidden sm:inline">Đăng xuất</span></button>
          </form>
        )}
      </header>
      <div className="mx-auto flex w-full max-w-[1700px] flex-1">
        {showNav && <AdminNav previewPath={previewPath} pendingFacts={pendingFacts} />}
        <main className="min-w-0 flex-1 px-4 py-8 pb-28 sm:px-7 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
