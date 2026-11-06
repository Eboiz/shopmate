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
  type OrdersMode,
} from "./orders-data";

type OrdersState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; orders: DraftOrder[] };
type ProcessedOrder = OrderDecision | "not_draft";

const orderDate = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export function DraftOrders({ mode }: { mode: OrdersMode }) {
  const [state, setState] = useState<OrdersState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<{ outcome: ProcessedOrder; customer: string }>();

  useEffect(() => {
    let ignore = false;

    void listDraftOrders(mode).then(
      (orders) => {
        if (!ignore) setState({ status: "ready", orders });
      },
      () => {
        if (!ignore) setState({ status: "error" });
      },
    );

    return () => {
      ignore = true;
    };
  }, [attempt, mode]);

  function removeProcessedOrder(order: DraftOrder, outcome: ProcessedOrder) {
    setState((current) => {
      if (current.status !== "ready") return current;
      return { status: "ready", orders: current.orders.filter(({ id }) => id !== order.id) };
    });
    setNotice({ outcome, customer: order.customer.name });
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="rounded-md border border-zinc-200 p-4 text-sm">
        Đang tải đơn nháp…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3 rounded-md border border-zinc-200 p-4">
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
      {state.orders.length === 0 ? (
        <EmptyState title="Không có đơn nháp" description="Đơn mới cần xử lý sẽ xuất hiện tại đây." />
      ) : (
        <ul aria-label="Đơn nháp" className="space-y-3">
          {state.orders.map((order) => (
            <li key={order.id}>
              <DraftOrderCard order={order} mode={mode} onProcessed={removeProcessedOrder} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftOrderCard({
  order,
  mode,
  onProcessed,
}: {
  order: DraftOrder;
  mode: OrdersMode;
  onProcessed: (order: DraftOrder, outcome: ProcessedOrder) => void;
}) {
  const [pending, setPending] = useState<OrderDecision | null>(null);
  const [error, setError] = useState<string>();

  async function submit(decision: OrderDecision) {
    if (pending) return;

    setPending(decision);
    setError(undefined);

    try {
      const result = await decideDraftOrder(order.id, decision, mode);
      if (result.ok) {
        onProcessed(order, decision);
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
    <article className="space-y-3 rounded-lg border border-zinc-200 p-4 wrap-anywhere">
      <header>
        <h2 className="font-semibold">{order.customer.name}</h2>
        <p className="mt-1 text-sm">{order.customer.phone}</p>
        <p className="text-sm">{order.customer.address}</p>
        <time className="mt-1 block text-xs text-zinc-500" dateTime={order.createdAt}>
          {orderDate.format(new Date(order.createdAt))}
        </time>
      </header>

      <ul aria-label="Mặt hàng" className="space-y-2 border-y border-zinc-200 py-3 text-sm">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{item.name}</p>
              <p className="text-zinc-500">{item.color} · Cỡ {item.size} · SL {item.quantity}</p>
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
