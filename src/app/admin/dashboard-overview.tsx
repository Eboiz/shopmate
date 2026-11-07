"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/format";
import { listLiveConversations, type InboxConversation } from "./inbox/inbox-live";
import { listDraftOrders, type DraftOrder } from "./orders/orders-data";

type DashboardData = { conversations: InboxConversation[] | null; orders: DraftOrder[] | null };
type DashboardOverviewProps = { previewData?: { conversations: InboxConversation[]; orders: DraftOrder[] } };

const quickLinks = [
  { href: "/admin/inbox", icon: "chat" as const, title: "Hộp thư", description: "Xem và tiếp quản hội thoại cần hỗ trợ" },
  { href: "/admin/orders", icon: "box" as const, title: "Đơn hàng", description: "Xác nhận hoặc huỷ các đơn đang chờ" },
  { href: "/admin/products", icon: "hanger" as const, title: "Sản phẩm", description: "Cập nhật giá, tồn kho và phối đồ" },
  { href: "/admin/reply-assistant", icon: "spark" as const, title: "Trợ lý trả lời", description: "Soạn bản nháp cho câu hỏi của khách" },
];

export function DashboardOverview({ previewData }: DashboardOverviewProps) {
  const [data, setData] = useState<DashboardData | null>(previewData ?? null);
  const [loading, setLoading] = useState(!previewData);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (previewData) return;
    let active = true;
    Promise.allSettled([listLiveConversations(), listDraftOrders()]).then(([inbox, orders]) => {
      if (!active) return;
      setData({
        conversations: inbox.status === "fulfilled" ? inbox.value : null,
        orders: orders.status === "fulfilled" ? orders.value : null,
      });
      setLoading(false);
    });
    return () => { active = false; };
  }, [reload, previewData]);

  const conversations = data?.conversations;
  const orders = data?.orders;
  const urgent = conversations?.filter(({ mode }) => mode === "needs_human") ?? [];
  const total = orders?.reduce((sum, order) => sum + order.total, 0);
  const stats = [
    { label: "Cần hỗ trợ", value: conversations ? String(urgent.length) : "—", detail: "Hội thoại cần nhân viên", icon: "chat" as const },
    { label: "Đơn nháp", value: orders ? String(orders.length) : "—", detail: "Đang chờ xử lý", icon: "box" as const },
    { label: "Hội thoại gần đây", value: conversations ? `${conversations.length}${conversations.length === 50 ? "+" : ""}` : "—", detail: "Tối đa 50 hội thoại", icon: "grid" as const },
    { label: "Giá trị đơn nháp", value: total === undefined ? "—" : formatPrice(total), detail: "Tổng giá trị đơn đang chờ", icon: "hanger" as const },
  ];

  return (
    <section className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ui-eyebrow mb-3">ShopMate / Dashboard</p>
          <h1 className="ui-page-title">Tổng quan cửa hàng<span className="text-[#e9573f]">.</span></h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#706d67]">Một nơi để theo dõi hội thoại, đơn hàng và những việc cần xử lý hôm nay.</p>
        </div>
        {!previewData && <Button variant="secondary" loading={loading} loadingText="Đang làm mới…" onClick={() => { setLoading(true); setReload((value) => value + 1); }}><Icon name="refresh" className="size-4" /> Làm mới</Button>}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-live="polite">
        {stats.map(({ label, value, detail, icon }) => (
          <article key={label} className="ui-card ui-hover-lift min-h-44 p-5">
            <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-[#706d67]">{label}</p><span className="flex size-10 items-center justify-center rounded-lg bg-[#efebe4] text-[#171717]"><Icon name={icon} className="size-5" /></span></div>
            {loading ? <Skeleton className="mt-5 h-9 w-20" /> : <p className="mt-5 truncate text-3xl font-bold tracking-[-.05em] tabular-nums text-[#171717]" title={value}>{value}</p>}
            <p className="mt-1 text-xs text-[#706d67]">{detail}</p>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(19rem,1fr)]">
        <section className="ui-card min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e3dfd8] px-5 py-5 sm:px-6"><div><p className="ui-eyebrow mb-1">Ưu tiên hôm nay</p><h2 className="text-lg font-bold">Khách cần bạn hỗ trợ</h2></div><Link className="text-sm font-semibold text-[#e9573f] hover:underline" href="/admin/inbox">Xem hộp thư ↗</Link></div>
          {loading ? <LoadingRegion label="Đang tải hội thoại…" className="divide-y divide-[#e3dfd8]">{[0, 1, 2].map((row) => <div key={row} className="flex items-center gap-3 px-5 py-4 sm:px-6"><Skeleton className="size-10 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-3/4" /></div><Skeleton className="h-6 w-20 rounded-full" /></div>)}</LoadingRegion> : conversations === null ? <p className="p-6 text-sm text-[#706d67]">Chưa tải được hộp thư. Hãy thử làm mới.</p> : urgent.length === 0 ? <div className="p-8 text-center"><span className="text-3xl text-[#e9573f]">✳</span><p className="mt-3 font-semibold">Chưa có hội thoại cần tiếp quản</p><p className="mt-1 text-sm text-[#706d67]">Các yêu cầu mới sẽ xuất hiện ở đây.</p></div> : <ul className="divide-y divide-[#e3dfd8]">{urgent.slice(0, 4).map((conversation) => <li key={conversation.id} className="flex items-center gap-3 px-5 py-4 sm:px-6"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#efebe4] font-bold text-[#171717]">{conversation.customerName.trim().charAt(0).toUpperCase() || "K"}</span><div className="min-w-0 flex-1"><p className="truncate font-semibold">{conversation.customerName}</p><p className="truncate text-xs text-[#706d67]">{conversation.latestMessage || "Chưa có nội dung văn bản"}</p></div><span className="shrink-0 rounded-full bg-[#fff0eb] px-2 py-1 text-[11px] font-semibold text-[#bf442e]">Cần trả lời</span></li>)}</ul>}
        </section>
        <section className="ui-card p-5 sm:p-6"><p className="ui-eyebrow mb-1">Truy cập nhanh</p><h2 className="mb-5 text-lg font-bold">Công việc của bạn</h2><div className="space-y-2">{quickLinks.map(({ href, icon, title, description }) => <Link key={href} href={href} className="group flex items-center gap-3 rounded-lg border border-[#e3dfd8] p-3 transition-colors hover:border-[#171717] hover:bg-[#f5f3ef]"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#efebe4]"><Icon name={icon} className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="block truncate text-xs text-[#706d67]">{description}</span></span><Icon name="arrow" className="size-4 shrink-0 text-[#706d67] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></Link>)}</div></section>
      </div>
    </section>
  );
}
