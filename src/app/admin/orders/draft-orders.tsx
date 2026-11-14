"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
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
// Both decisions change things the shop cannot take back (stock, a message to
// the shopper), so each one goes through a recap step first.
type Step = "idle" | "confirm" | "cancel";

const orderDate = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export function DraftOrders({ justCreated = false }: { justCreated?: boolean }) {
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
      <LoadingRegion label="Đang tải đơn chờ xác nhận…" className="space-y-3">
        <DraftOrderSkeleton />
        <DraftOrderSkeleton />
      </LoadingRegion>
    );
  }

  if (state.status === "unavailable") {
    return <EmptyState icon="box" title="Chưa kết nối dữ liệu đơn hàng" description="Đơn khách chốt qua chat sẽ hiện ở đây khi API đơn hàng được bật." />;
  }

  if (state.status === "error") {
    return (
      <div className="ui-card space-y-3 p-5">
        <ErrorMessage>Không tải được danh sách đơn chờ xác nhận.</ErrorMessage>
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
      {justCreated && !notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-[#eef4ea] px-3 py-2.5 text-sm font-medium text-[#2f6b3a]">
          <Icon name="check" className="size-4 shrink-0" />
          Đã tạo đơn. Kiểm tra lại rồi bấm Xác nhận để trừ tồn kho.
        </p>
      )}
      {notice?.outcome === "not_draft" && (
        <ErrorMessage>Đơn của {notice.customer} đã được xử lý trước đó.</ErrorMessage>
      )}
      <div role="status">
        {notice && notice.outcome !== "not_draft" && (
          <p className="flex items-center gap-2 rounded-lg bg-[#eef4ea] px-3 py-2.5 text-sm font-medium text-[#2f6b3a]">
            <Icon name="check" className="size-4 shrink-0" />
            {notice.outcome === "confirmed"
              ? `Đã xác nhận đơn của ${notice.customer}. Tồn kho đã được trừ.`
              : `Đã huỷ đơn của ${notice.customer}.`}
          </p>
        )}
      </div>
      {notice?.notificationSent === false && (
        <ErrorMessage>Đơn đã được xử lý nhưng chưa gửi được tin báo tự động. Hãy nhắn trực tiếp cho khách.</ErrorMessage>
      )}
      {state.orders.length === 0 ? (
        <EmptyState icon="box" title="Không có đơn chờ xác nhận" description="Khi khách chốt đơn trong chat hoặc đặt từ giỏ hàng, đơn sẽ hiện ở đây để shop kiểm tra." />
      ) : (
        <ul aria-label="Đơn chờ xác nhận" className="space-y-3">
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
  const [step, setStep] = useState<Step>("idle");
  const pieces = order.items.reduce((sum, item) => sum + item.quantity, 0);

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
        setStep("idle");
        setError("Không đủ tồn kho để xác nhận đơn này. Hãy kiểm tra tồn kho hoặc nhắn khách đổi mẫu.");
      }
    } catch {
      setError("Chưa kiểm tra được kết quả. Hãy tải lại trang để xem trạng thái đơn.");
    } finally {
      setPending(null);
    }
  }

  return (
    <article className="ui-card space-y-4 p-5 wrap-anywhere sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{order.customer.name}</h2>
          <a
            href={`tel:${order.customer.phone.replace(/\s+/g, "")}`}
            className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:text-[#c2412b] hover:underline"
          >
            <Icon name="phone" className="size-4 text-[#706d67]" />
            {order.customer.phone}
          </a>
          <p className="text-sm">{order.customer.address}</p>
          <time className="mt-1 block text-xs text-[#706d67]" dateTime={order.createdAt}>
            Chốt lúc {orderDate.format(new Date(order.createdAt))}
          </time>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-[#fff0eb] px-3 py-1 text-xs font-semibold text-[#b2382a]">Chờ xác nhận</span>
          <Link
            href={`/admin/inbox?c=${order.conversationId}`}
            className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-[#c2412b] underline-offset-4 hover:underline"
          >
            <Icon name="chat" className="size-4" />
            Xem hội thoại
          </Link>
        </div>
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
      {step === "confirm" && (
        <div role="group" aria-label="Xác nhận đơn" className="space-y-3 rounded-lg border border-[#d5d0c8] bg-[#f5f3ef] p-3">
          <p className="text-sm">
            Xác nhận đơn của <strong>{order.customer.name}</strong> ({formatPrice(order.total)})? Shop sẽ trừ {pieces} món khỏi tồn kho và
            nhắn báo khách.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Button variant="secondary" disabled={pending !== null} onClick={() => setStep("idle")} autoFocus>
              Quay lại
            </Button>
            <Button loading={pending === "confirmed"} disabled={pending !== null} loadingText="Đang xác nhận…" onClick={() => void submit("confirmed")}>
              Xác nhận đơn này
            </Button>
          </div>
        </div>
      )}
      {step === "cancel" && (
        <div role="group" aria-label="Xác nhận huỷ đơn" className="space-y-3 rounded-lg border border-[#f3d3c9] bg-[#fff6f3] p-3">
          <p className="text-sm">
            Huỷ đơn của <strong>{order.customer.name}</strong> ({formatPrice(order.total)})? Thao tác này không hoàn tác được.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Button variant="secondary" disabled={pending !== null} onClick={() => setStep("idle")} autoFocus>
              Giữ đơn
            </Button>
            <Button
              variant="danger"
              disabled={pending !== null}
              loading={pending === "cancelled"}
              loadingText="Đang huỷ…"
              onClick={() => void submit("cancelled")}
            >
              Huỷ đơn này
            </Button>
          </div>
        </div>
      )}
      {step === "idle" && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Button variant="secondary" disabled={pending !== null} onClick={() => setStep("cancel")}>
            Huỷ đơn
          </Button>
          <Button disabled={pending !== null} onClick={() => setStep("confirm")}>
            Xác nhận
          </Button>
        </div>
      )}
    </article>
  );
}

// The frame of one DraftOrderCard while the list loads.
function DraftOrderSkeleton() {
  return (
    <div className="ui-card space-y-4 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div className="space-y-2 border-y border-[#e3dfd8] py-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-11 rounded-lg" />
        <Skeleton className="h-11 rounded-lg" />
      </div>
    </div>
  );
}
