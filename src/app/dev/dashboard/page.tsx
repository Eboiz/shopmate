import { notFound } from "next/navigation";
import { AdminShell } from "@/app/admin/admin-shell";
import { DashboardOverview } from "@/app/admin/dashboard-overview";

export default function DashboardPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AdminShell previewPath="/admin" shopName="Hạnh Boutique"><DashboardOverview previewData={{
    lowStock: 4,
    conversations: [
      { id: "1", customerName: "Nguyễn Thảo", channel: "web", mode: "needs_human", lastMessageAt: "2026-11-07T09:30:00+07:00", latestMessage: "Mình muốn hỏi size M còn không ạ?" },
      { id: "2", customerName: "Trần Minh Anh", channel: "messenger", mode: "needs_human", lastMessageAt: "2026-11-07T09:12:00+07:00", latestMessage: "Shop tư vấn giúp mình phối đồ nhé" },
      { id: "3", customerName: "Lê Mai", channel: "web", mode: "ai", lastMessageAt: "2026-11-07T08:40:00+07:00", latestMessage: "Cảm ơn shop" },
    ],
    orders: [
      { id: "1", conversationId: "1", createdAt: "2026-11-07T09:10:00+07:00", customer: { name: "Nguyễn Thảo", phone: "", address: "" }, items: [], total: 459000 },
      { id: "2", conversationId: "2", createdAt: "2026-11-07T08:50:00+07:00", customer: { name: "Trần Minh Anh", phone: "", address: "" }, items: [], total: 789000 },
    ],
  }} /></AdminShell>;
}
