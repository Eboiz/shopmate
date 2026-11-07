"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { formatPrice } from "@/lib/format";
import {
  decideDraftOrder,
  listDraftOrders,
  type DraftOrder,
  type OrderDecision,
} from "./orders-data";

type OrdersState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unavailable" }
  | { status: "ready"; orders: DraftOrder[] };
type ProcessedOrder = OrderDecision | "not_draft";

const orderDate = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export function DraftOrders() {
  const [state, setState] = useState<OrdersState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<{ outcome: ProcessedOrder; customer: string; notificationSent?: boolean }>();

  useEffect(() => {
    let ignore = false;

    void listDraftOrders().then(
      (orders) => {
        if (!ignore) setState(orders ? { status: "ready", orders } : { status: "unavailable" });
      },
      () => {
        if (!ignore) setState({ status: "error" });
      },
    );

    return () => {
      ignore = true;
    };
  }, [attempt]);

  function removeProcessedOrder(order: DraftOrder, outcome: ProcessedOrder, notificationSent?: boolean) {
    setState((current) => {
      if (current.status !== "ready") return current;
      return { status: "ready", orders: current.orders.filter(({ id }) => id !== order.id) };
    });
    setNotice({ outcome, customer: order.customer.name, notificationSent });
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="ui-card p-5 text-sm text-[#706d67]">
        Đang tải đơn nháp…
      </p>
    );
  }

  if (state.status === "unavailable") {
    return <EmptyState title="Chưa kết nối dữ liệu đơn hàng" description="Đơn nháp sẽ xuất hiện khi API đơn hàng được triển khai." />;
  }

  if (state.status === "error") {
    return (
      <div className="ui-card space-y-3 p-5">
        <ErrorMessage>Không tải được danh sách đơn nháp.</ErrorMessage>
        <Button
          variant="secondary"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((current) => current + 1);
          }}
        >
          Thử lại
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice?.outcome === "not_draft" && (
        <ErrorMessage>Đơn của {notice.customer} đã được xử lý trước đó.</ErrorMessage>
      )}
      <div role="status">
        {notice && notice.outcome !== "not_draft" && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {notice.outcome === "confirmed" ? "Đã xác nhận" : "Đã hủy"} đơn của {notice.customer}.
          </p>
        )}
      </div>
      {notice?.notificationSent === false && (
        <ErrorMessage>Đơn đã được xử lý. Chưa gửi được thông báo tự động, vui lòng nhắn trực tiếp cho khách.</ErrorMessage>
      )}
      {state.orders.length === 0 ? (
        <EmptyState title="Không có đơn nháp" description="Đơn mới cần xử lý sẽ xuất hiện tại đây." />
      ) : (
        <ul aria-label="Đơn nháp" className="space-y-3">
          {state.orders.map((order) => (
            <li key={order.id}>
              <DraftOrderCard order={order} onProcessed={removeProcessedOrder} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftOrderCard({
  order,
  onProcessed,
}: {
  order: DraftOrder;
  onProcessed: (order: DraftOrder, outcome: ProcessedOrder, notificationSent?: boolean) => void;
}) {
  const [pending, setPending] = useState<OrderDecision | null>(null);
  const [error, setError] = useState<string>();

  async function submit(decision: OrderDecision) {
    if (pending) return;

    setPending(decision);
    setError(undefined);

    try {
      const result = await decideDraftOrder(order.id, decision);
      if (result.ok) {
        onProcessed(order, decision, result.notificationSent);
      } else if (result.code === "not_draft") {
        onProcessed(order, result.code);
      } else {
        setError("Không đủ tồn kho để xác nhận đơn này.");
      }
    } catch {
      setError("Chưa kiểm tra được kết quả. Vui lòng tải lại trang để kiểm tra trạng thái đơn.");
    } finally {
      setPending(null);
    }
  }

  return (
    <article className="ui-card space-y-4 p-5 wrap-anywhere sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="ui-eyebrow mb-2">Đơn hàng chờ xử lý</p><h2 className="text-lg font-bold">{order.customer.name}</h2>
        <p className="mt-1 text-sm">{order.customer.phone}</p>
        <p className="text-sm">{order.customer.address}</p>
        <time className="mt-1 block text-xs text-[#706d67]" dateTime={order.createdAt}>
          {orderDate.format(new Date(order.createdAt))}
        </time></div><span className="rounded-full bg-[#fff0eb] px-3 py-1 text-xs font-semibold text-[#b2382a]">Chờ xác nhận</span>
      </header>

      <ul aria-label="Mặt hàng" className="space-y-2 border-y border-[#e3dfd8] py-3 text-sm">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{item.name}</p>
              <p className="text-[#706d67]">{item.color} · Cỡ {item.size} · SL {item.quantity}</p>
            </div>
            <span className="shrink-0 tabular-nums">{formatPrice(item.unitPrice * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <div className="flex justify-between gap-3 text-sm font-semibold">
        <span>Tổng tiền</span>
        <span className="tabular-nums">{formatPrice(order.total)}</span>
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Button variant="secondary" disabled={pending !== null} onClick={() => void submit("cancelled")}>
          {pending === "cancelled" ? "Đang hủy…" : "Hủy đơn"}
        </Button>
        <Button disabled={pending !== null} onClick={() => void submit("confirmed")}>
          {pending === "confirmed" ? "Đang xác nhận…" : "Xác nhận"}
        </Button>
      </div>
    </article>
  );
}
