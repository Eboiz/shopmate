"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, isNavItemActive } from "@/lib/admin-nav";
import { Icon } from "@/components/ui/icon";

const NAV_ICONS = { "/admin": "grid", "/admin/inbox": "chat", "/admin/orders": "box", "/admin/products": "hanger" } as const;

export function AdminNav({ previewPath }: { previewPath?: string } = {}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Menu quản lý"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[#e3dfd8] bg-white px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-20px_#171717] lg:sticky lg:inset-auto lg:top-0 lg:h-[calc(100dvh-4.5rem)] lg:w-60 lg:shrink-0 lg:grid-cols-1 lg:content-start lg:gap-1 lg:border-r lg:border-t-0 lg:border-[#292929] lg:bg-[#171717] lg:px-3 lg:py-7 lg:shadow-none"
    >
      <p className="mb-2 hidden px-4 text-[10px] font-bold uppercase tracking-[.2em] text-[#99958e] lg:block">Điều hướng</p>
      {ADMIN_NAV.map(({ href, label }) => {
        const active = isNavItemActive(previewPath ?? pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[10px] transition-colors sm:text-xs lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:text-sm ${
              active ? "bg-[#efebe4] font-bold text-[#171717] lg:bg-[#e9573f] lg:text-white" : "text-[#706d67] hover:bg-[#efebe4] hover:text-[#171717] lg:text-[#b6b3ad] lg:hover:bg-[#292929] lg:hover:text-white"
            }`}
          >
            <Icon name={NAV_ICONS[href]} className="size-5 shrink-0" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
