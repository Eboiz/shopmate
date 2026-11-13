"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/format";
import { LOW_STOCK } from "@/lib/stock";
import { createClient } from "@/lib/supabase/client";
import { avatarInitial } from "./inbox/inbox-filter";
import { listLiveConversations, type InboxConversation } from "./inbox/inbox-live";
import { formatWaiting, waitingMs } from "./inbox/waiting";
import { listDraftOrders, type DraftOrder } from "./orders/orders-data";

type DashboardData = {
  conversations: InboxConversation[] | null;
  orders: DraftOrder[] | null;
  // Variants with LOW_STOCK or fewer left, out of stock included.
  lowStock: number | null;
  // When the data was read: the clock for "waiting" labels, so render stays pure.
  now: number | null;
};
type DashboardOverviewProps = { previewData?: Omit<DashboardData, "lowStock" | "now"> & { lowStock?: number } };

const quickLinks = [
  { href: "/admin/inbox", icon: "chat" as const, title: "Hộp thư", description: "Xem và tiếp quản hội thoại cần hỗ trợ" },
  { href: "/admin/orders", icon: "box" as const, title: "Đơn hàng", description: "Xác nhận hoặc huỷ các đơn đang chờ" },
  { href: "/admin/products", icon: "hanger" as const, title: "Sản phẩm", description: "Cập nhật giá, tồn kho và phối đồ" },
  { href: "/admin/reply-assistant", icon: "spark" as const, title: "Trợ lý trả lời", description: "Soạn bản nháp cho câu hỏi của khách" },
];

async function countLowStock() {
  const { count, error } = await createClient()
    .from("variants")
    .select("id", { count: "exact", head: true })
    .lte("stock", LOW_STOCK);
  if (error) throw error;
  return count ?? 0;
}

export function DashboardOverview({ previewData }: DashboardOverviewProps) {
  const [data, setData] = useState<DashboardData | null>(
    previewData ? { ...previewData, lowStock: previewData.lowStock ?? null, now: null } : null,
  );
  const [loading, setLoading] = useState(!previewData);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (previewData) return;
    let active = true;
    Promise.allSettled([listLiveConversations(), listDraftOrders(), countLowStock()]).then(([inbox, orders, lowStock]) => {
      if (!active) return;
      setData({
        conversations: inbox.status === "fulfilled" ? inbox.value : null,
        orders: orders.status === "fulfilled" ? orders.value : null,
        lowStock: lowStock.status === "fulfilled" ? lowStock.value : null,
        now: Date.now(),
      });
      setLoading(false);
    });
    return () => { active = false; };
  }, [reload, previewData]);

  const conversations = data?.conversations;
  const orders = data?.orders;
  const now = data?.now ?? null;
  const urgent = conversations?.filter(({ mode }) => mode === "needs_human") ?? [];
  const total = orders?.reduce((sum, order) => sum + order.total, 0);
  const oldestOrder = orders?.reduce<string | undefined>((oldest, order) => (!oldest || order.createdAt < oldest ? order.createdAt : oldest), undefined);
  const stats: { label: string; value: string; detail: string; icon: IconName; href: string }[] = [
    {
      label: "Cần hỗ trợ",
      value: conversations ? String(urgent.length) : "—",
      detail: urgent.length ? "Khách đang chờ người thật trả lời" : "Không khách nào đang chờ",
      icon: "chat",
      href: "/admin/inbox",
    },
    {
      label: "Đơn chờ xác nhận",
      value: orders ? String(orders.length) : "—",
      detail: oldestOrder && now !== null ? `Đơn cũ nhất đã chờ ${formatWaiting(waitingMs(oldestOrder, now))}` : "Đơn khách chốt qua chat",
      icon: "box",
      href: "/admin/orders",
    },
    {
      label: "Giá trị đơn chờ",
      value: total === undefined ? "—" : formatPrice(total),
      detail: "Tổng tiền các đơn chưa xác nhận",
      icon: "cart",
      href: "/admin/orders",
    },
    {
      label: "Sắp hết hàng",
      value: data?.lowStock == null ? "—" : String(data.lowStock),
      detail: `Mẫu còn ${LOW_STOCK} cái trở xuống`,
      icon: "hanger",
      href: "/admin/products?stock=low",
    },
  ];

  return (
    <section className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="ui-page-title">Tổng quan cửa hàng<span className="text-[#e9573f]">.</span></h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#706d67]">Việc cần xử lý hôm nay: khách đang chờ, đơn cần xác nhận và mẫu sắp hết.</p>
        </div>
        {!previewData && <Button variant="secondary" loading={loading} loadingText="Đang làm mới…" onClick={() => { setLoading(true); setReload((value) => value + 1); }}><Icon name="refresh" className="size-4" /> Làm mới</Button>}
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, detail, icon, href }) => (
          <li key={label}>
            <Link href={href} className="ui-card ui-hover-lift group flex min-h-44 flex-col p-5 transition-colors hover:border-[#171717]">
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium text-[#5c5954]">{label}</span>
                <span className="flex size-10 items-center justify-center rounded-lg bg-[#efebe4] text-[#171717]"><Icon name={icon} className="size-5" /></span>
              </span>
              {loading ? <Skeleton className="mt-5 h-9 w-20" /> : <span className="mt-5 block truncate text-3xl font-bold tracking-[-.05em] tabular-nums text-[#171717]" title={value}>{value}</span>}
              <span className="mt-1 flex items-center justify-between gap-2 text-xs text-[#706d67]">
                {detail}
                <Icon name="arrow" className="size-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(19rem,1fr)]">
        <section className="ui-card min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[#e3dfd8] px-5 py-5 sm:px-6">
            <h2 className="text-lg font-bold">Khách cần bạn hỗ trợ</h2>
            <Link className="shrink-0 text-sm font-semibold text-[#c2412b] underline-offset-4 hover:underline" href="/admin/inbox">
              {urgent.length > 4 ? `Xem cả ${urgent.length} hội thoại` : "Mở hộp thư"}
            </Link>
          </div>
          {loading ? (
            <LoadingRegion label="Đang tải hội thoại…" className="divide-y divide-[#e3dfd8]">
              {[0, 1, 2].map((row) => <div key={row} className="flex items-center gap-3 px-5 py-4 sm:px-6"><Skeleton className="size-10 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-3/4" /></div><Skeleton className="h-6 w-20 rounded-full" /></div>)}
            </LoadingRegion>
          ) : conversations === null ? (
            <p className="p-6 text-sm text-[#706d67]">Chưa tải được hộp thư. Hãy thử làm mới.</p>
          ) : urgent.length === 0 ? (
            <div className="flex flex-col items-center p-8 text-center">
              <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-[#eef4ea] text-[#2f6b3a]"><Icon name="check" className="size-6" /></span>
              <p className="mt-3 font-semibold">Không khách nào đang chờ</p>
              <p className="mt-1 text-sm text-[#706d67]">Khi AI chuyển một cuộc chat cho shop, khách sẽ hiện ở đây.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#e3dfd8]">
              {urgent.slice(0, 4).map((conversation) => (
                <li key={conversation.id}>
                  <Link href={`/admin/inbox?c=${conversation.id}`} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[#f5f3ef] sm:px-6">
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#efebe4] font-bold text-[#171717]">{avatarInitial(conversation)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{conversation.customerName}</span>
                      <span className="block truncate text-xs text-[#706d67]">{conversation.customerMessage ?? (conversation.latestMessage || "Chưa có nội dung văn bản")}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#fff0eb] px-2 py-1 text-[11px] font-semibold text-[#b2382a]">
                      <Icon name="clock" className="size-3.5" />
                      {now === null ? "Cần trả lời" : `Chờ ${formatWaiting(waitingMs(conversation.customerMessageAt ?? conversation.lastMessageAt, now))}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ui-card p-5 sm:p-6">
          <h2 className="mb-5 text-lg font-bold">Công việc của bạn</h2>
          <div className="space-y-2">
            {quickLinks.map(({ href, icon, title, description }) => (
              <Link key={href} href={href} className="group flex items-center gap-3 rounded-lg border border-[#e3dfd8] p-3 transition-colors hover:border-[#171717] hover:bg-[#f5f3ef]">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#efebe4]"><Icon name={icon} className="size-5" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="block truncate text-xs text-[#706d67]">{description}</span></span>
                <Icon name="arrow" className="size-4 shrink-0 text-[#706d67] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
