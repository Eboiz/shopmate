"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, isNavItemActive } from "@/lib/admin-nav";

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Menu quản lý"
      className="sticky bottom-0 grid grid-cols-4 border-t border-zinc-200 bg-background pb-[env(safe-area-inset-bottom)]"
    >
      {ADMIN_NAV.map(({ href, label }) => {
        const active = isNavItemActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-12 items-center justify-center px-1 text-center text-sm ${
              active ? "font-semibold" : "text-zinc-500"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
