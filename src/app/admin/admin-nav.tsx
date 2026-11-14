"use client";

import Link from "next/link";
import { Suspense, use } from "react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ADMIN_NAV, isNavItemActive } from "@/lib/admin-nav";
import { Icon } from "@/components/ui/icon";
import { createClient } from "@/lib/supabase/client";

const NAV_ICONS = { "/admin": "grid", "/admin/inbox": "chat", "/admin/orders": "box", "/admin/products": "hanger", "/admin/reply-assistant": "spark", "/admin/ai-da-hoc": "book" } as const;

type Counts = Partial<Record<(typeof ADMIN_NAV)[number]["href"], number>>;

// What waits for the team: shoppers asking for a person, orders to confirm.
// Head-only counts (no rows); RLS keeps them to the signed-in user's shop.
async function readCounts(): Promise<Counts> {
  const db = createClient();
  const [inbox, orders] = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }).eq("mode", "needs_human"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("status", "draft"),
  ]);
  return {
    "/admin/inbox": inbox.error ? undefined : inbox.count ?? undefined,
    "/admin/orders": orders.error ? undefined : orders.count ?? undefined,
  };
}

const countLabel = (href: keyof Counts, count: number) =>
  href === "/admin/inbox" ? `${count} khách cần nhân viên` : `${count} đơn chờ xác nhận`;

// pendingFacts: the count on "AI đã học" (PB-35a). A promise, so no page waits for it.
export function AdminNav({ previewPath, pendingFacts }: { previewPath?: string; pendingFacts?: Promise<number> } = {}) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Counts>({});

  // Refetched on every page change and every 30 seconds; the preview has no session.
  useEffect(() => {
    if (previewPath) return;
    let active = true;
    const load = () => void readCounts().then((next) => { if (active) setCounts(next); }, () => {});
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pathname, previewPath]);

  return (
    <nav
      aria-label="Menu quản lý"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-[#e3dfd8] bg-white px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-20px_#171717] lg:sticky lg:inset-auto lg:top-0 lg:h-[calc(100dvh-4.5rem)] lg:w-60 lg:shrink-0 lg:grid-cols-1 lg:content-start lg:gap-1 lg:border-r lg:border-t-0 lg:border-[#292929] lg:bg-[#171717] lg:px-3 lg:py-7 lg:shadow-none"
    >
      {ADMIN_NAV.map(({ href, label }) => {
        const active = isNavItemActive(previewPath ?? pathname, href);
        const count = counts[href];
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-xs transition-colors lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:text-sm ${
              active ? "bg-[#efebe4] font-bold text-[#171717] lg:bg-[#c2412b] lg:text-white" : "text-[#5c5954] hover:bg-[#efebe4] hover:text-[#171717] lg:text-[#c9c5bd] lg:hover:bg-[#292929] lg:hover:text-white"
            }`}
          >
            <span className="relative">
              <Icon name={NAV_ICONS[href]} className="size-5 shrink-0" />
              {count ? (
                <span aria-hidden="true" className="absolute -right-2.5 -top-2 min-w-4.5 rounded-full bg-[#c2412b] px-1 text-center text-[10px] font-bold leading-4.5 text-white ring-2 ring-white tabular-nums lg:hidden">
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </span>
            <span className="lg:flex-1 lg:text-left">{label}</span>
            {count ? (
              <>
                <span aria-hidden="true" className={`hidden min-w-6 rounded-full px-1.5 text-center text-xs font-bold leading-5 tabular-nums lg:block ${active ? "bg-white text-[#c2412b]" : "bg-[#c2412b] text-white"}`}>
                  {count > 99 ? "99+" : count}
                </span>
                <span className="sr-only">, {countLabel(href as keyof Counts, count)}</span>
              </>
            ) : null}
            {href === "/admin/ai-da-hoc" && pendingFacts && (
              <Suspense fallback={null}>
                <PendingBadge count={pendingFacts} active={active} />
              </Suspense>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function PendingBadge({ count, active }: { count: Promise<number>; active: boolean }) {
  const n = use(count);
  if (n <= 0) return null;
  return (
    <span className={`absolute left-[calc(50%+4px)] top-2 min-w-4 rounded-full bg-[#c2412b] px-1 text-[10px] font-bold leading-4 text-white lg:static lg:ml-auto lg:min-w-5 lg:text-xs lg:leading-5 ${active ? "lg:bg-white lg:text-[#c2412b]" : ""}`}>
      {n}
      <span className="sr-only"> mục chờ duyệt</span>
    </span>
  );
}
