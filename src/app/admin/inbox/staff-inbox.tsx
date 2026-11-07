"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Channel, ConversationMode, MessageSender } from "@/contract";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { ChatSkeleton, LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { TextArea } from "@/components/ui/text-area";
import {
  historyLimit, listInboxMessages, listLiveConversations, setLiveInboxMode, subscribeInbox,
  type InboxConversation, type InboxMessage,
} from "./inbox-live";
import { formatWaiting, overdueAfterMs, waitingMs } from "./waiting";

const channelLabels: Record<Channel, string> = {
  web: "Web chat",
  messenger: "Messenger",
  instagram: "Instagram",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

const modeLabels: Record<ConversationMode, string> = {
  ai: "AI đang trả lời",
  needs_human: "Cần nhân viên",
  staff: "Nhân viên đang trả lời",
};

const senderLabels: Record<MessageSender, string> = {
  shopper: "Khách hàng",
  ai: "AI",
  staff: "Nhân viên",
  system: "Hệ thống",
};

const bubbleStyles: Record<Exclude<MessageSender, "system">, string> = {
  shopper: "rounded-bl-sm border border-[#e3dfd8] bg-white",
  ai: "rounded-br-sm border border-[#f3d3c9] bg-[#fff0eb]",
  staff: "rounded-br-sm bg-[#171717] text-white",
};

const inboxDate = new Intl.DateTimeFormat("vi-VN", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

type InboxState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; conversations: InboxConversation[] };

type SendMessageAction = (conversationId: string, text: string, requestId: string) => Promise<
  { ok: true } | { ok: false; messageId: string | null }
>;

function ModeBadge({ mode }: { mode: ConversationMode }) {
  const color = mode === "needs_human" ? "bg-[#fff0eb] text-[#b2382a]" : "bg-[#efebe4] text-[#171717]";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${color}`}>{modeLabels[mode]}</span>;
}

export function StaffInbox({ sendMessageAction }: { sendMessageAction?: SendMessageAction }) {
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  // Clock for "waiting since" labels: set when data arrives, then once a minute,
  // so render never reads the clock itself.
  const [now, setNow] = useState<number | null>(null);
  const onMessage = useEffectEvent((conversationId?: string) => {
    if (selectedId && (!conversationId || conversationId === selectedId)) {
      setHistoryVersion((version) => version + 1);
    }
  });

  useEffect(() => {
    let active = true;
    let requestId = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function refresh() {
      const id = ++requestId;
      void listLiveConversations().then(
        (conversations) => {
          if (active && id === requestId) {
            setState({ status: "ready", conversations });
            setNow(Date.now());
            setRefreshing(false);
          }
        },
        () => {
          if (active && id === requestId) {
            setState((current) => current.status === "ready" ? current : { status: "error" });
            setRefreshing(false);
          }
        },
      );
    }

    refresh();
    const unsubscribe = subscribeInbox(
      () => {
        if (!active || timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          refresh();
        }, 80);
      },
      (conversationId) => { if (active) onMessage(conversationId); },
    );

    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [attempt]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  function reload() {
    if (state.status === "error") setState({ status: "loading" });
    else setRefreshing(true);
    setAttempt((current) => current + 1);
    setHistoryVersion((version) => version + 1);
  }

  if (state.status === "loading") {
    return (
      <LoadingRegion label="Đang tải hộp thư…">
        {/* Same grid, title row and card heights as InboxConversations below. */}
        <Skeleton className="mb-4 h-11 w-28 rounded-lg" />
        <div className="gap-5 md:grid md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div>
            <div className="mb-3 flex h-6 items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-9 rounded-full" />
            </div>
            <div className="space-y-2">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="ui-card p-4">
                  <div className="flex h-6 items-center justify-between gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                  <div className="my-1 flex h-[22px] items-center gap-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div aria-hidden="true" className="hidden h-[222px] rounded-xl border border-dashed border-[#d5d0c8] bg-white md:block" />
        </div>
      </LoadingRegion>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3">
        <ErrorMessage>Không tải được danh sách hội thoại.</ErrorMessage>
        <Button variant="secondary" onClick={reload}>
          Thử lại
        </Button>
      </div>
    );
  }

  const selected = state.conversations.find(({ id }) => id === selectedId);
  const conversations = state.conversations;

  return (
    <>
      <Button variant="secondary" className="mb-4" loading={refreshing} loadingText="Đang làm mới…" onClick={reload}>↻ Làm mới</Button>
      {conversations.length ? (
        <InboxConversations
          conversations={conversations}
          now={now}
          selected={selected}
          onSelect={setSelectedId}
          historyVersion={historyVersion}
          reload={reload}
          sendMessageAction={sendMessageAction}
        />
      ) : (
        <EmptyState title="Chưa có cuộc trò chuyện" description="Tin nhắn của khách sẽ xuất hiện tại đây." />
      )}
    </>
  );
}

function WaitingBadge({ since, now }: { since: string; now: number }) {
  const ms = waitingMs(since, now);
  const overdue = ms >= overdueAfterMs;
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${overdue ? "bg-[#b2382a] text-white" : "bg-[#efebe4] text-[#171717]"}`}>
      Chờ {formatWaiting(ms)}
    </span>
  );
}

function InboxConversations({ conversations, now, selected, onSelect, historyVersion, reload, sendMessageAction }: {
  conversations: InboxConversation[];
  now: number | null;
  selected?: InboxConversation;
  onSelect: (id: string | null) => void;
  historyVersion: number;
  reload: () => void;
  sendMessageAction?: SendMessageAction;
}) {
  return (
    <div className="gap-5 md:grid md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <aside aria-label="Danh sách hội thoại" className={selected ? "hidden md:block" : undefined}>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-[.08em]">Hội thoại</h2><span className="rounded-full bg-[#efebe4] px-2 py-1 text-xs font-semibold">{conversations.length}</span></div>
        <ul className="space-y-2">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                aria-pressed={selected?.id === conversation.id}
                className="ui-card block w-full min-w-0 p-4 text-left transition-colors hover:bg-[#f5f3ef] aria-pressed:border-[#e9573f] aria-pressed:bg-[#fff6f3]"
                onClick={() => onSelect(conversation.id)}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">{conversation.customerName}</span>
                  <time className="shrink-0 text-[11px] text-[#706d67]" dateTime={conversation.lastMessageAt}>
                    {inboxDate.format(new Date(conversation.lastMessageAt))}
                  </time>
                </span>
                <span className="my-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {channelLabels[conversation.channel]}
                  <ModeBadge mode={conversation.mode} />
                  {conversation.mode === "needs_human" && now !== null && (
                    <WaitingBadge since={conversation.customerMessageAt ?? conversation.lastMessageAt} now={now} />
                  )}
                </span>
                <span className="block truncate text-sm text-[#706d67]">
                  {conversation.customerMessage ?? (conversation.latestMessage || "Chưa có nội dung văn bản")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {selected ? (
        <ConversationPanel
          key={selected.id}
          conversation={selected}
          historyVersion={historyVersion}
          reload={reload}
          sendMessageAction={sendMessageAction}
          onBack={() => onSelect(null)}
        />
      ) : (
        <div className="hidden md:sticky md:top-24 md:block md:self-start">
          <EmptyState title="Chọn một cuộc trò chuyện" description="Lịch sử tin nhắn sẽ xuất hiện tại đây." />
        </div>
      )}
    </div>
  );
}

function ConversationPanel({ conversation, historyVersion, reload, onBack, sendMessageAction }: {
  conversation: InboxConversation;
  historyVersion: number;
  reload: () => void;
  onBack: () => void;
  sendMessageAction?: SendMessageAction;
}) {
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState<"mode" | "send" | null>(null);
  const [error, setError] = useState<string>();
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const sendAttempt = useRef<{ text: string; id: string } | null>(null);
  const messageLog = useRef<HTMLDivElement>(null);
  const newestMessageId = messages?.at(-1)?.id;
  const conversationId = conversation.id;
  const isStaff = conversation.mode === "staff";

  useEffect(() => {
    let active = true;
    void listInboxMessages(conversationId).then((result) => {
      if (!active) return;
      setMessages(result);
      setHistoryError(false);
    }, () => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [conversationId, historyVersion]);

  useEffect(() => {
    const log = messageLog.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [newestMessageId]);

  async function runAction(action: "mode" | "send", request: () => Promise<void>) {
    if (pending) return;
    setPending(action);
    setError(undefined);

    try {
      await request();
    } catch {
      setError(action === "mode" ? "Không đổi được trạng thái hội thoại." : "Chưa xác nhận được kết quả gửi. Thử lại sẽ dùng cùng mã tin nhắn.");
    } finally {
      setPending(null);
    }
  }

  async function changeMode() {
    if (!await setLiveInboxMode(conversationId, isStaff ? "ai" : "staff")) {
      setError("Không đổi được trạng thái hội thoại.");
      return;
    }
    reload();
  }

  async function sendReply(text: string) {
    if (!sendMessageAction) return;
    if (sendAttempt.current?.text !== text) sendAttempt.current = { text, id: crypto.randomUUID() };
    const result = await sendMessageAction(conversationId, text, sendAttempt.current.id);
    if (!result.ok && !result.messageId) {
      setError("Chưa gửi được tin nhắn. Bạn có thể thử lại.");
      return;
    }
    setReply("");
    sendAttempt.current = null;
    if (!result.ok) setError("Tin nhắn đã lưu trong hộp thư. Chưa xác nhận được tin đã đến khách.");
    reload();
  }

  return (
    <section aria-label={`Cuộc trò chuyện với ${conversation.customerName}`} className="min-w-0 space-y-3 md:sticky md:top-24 md:self-start">
      <Button variant="secondary" className="md:hidden" onClick={onBack}>Về danh sách</Button>

      <div className="ui-card space-y-3 p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="wrap-anywhere font-semibold">{conversation.customerName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {channelLabels[conversation.channel]}
              <ModeBadge mode={conversation.mode} />
            </div>
          </div>
          <Button variant={isStaff ? "secondary" : "primary"} disabled={pending !== null}
            loading={pending === "mode"} loadingText="Đang cập nhật…"
            onClick={() => void runAction("mode", changeMode)}>
            {isStaff ? "Trả lại cho AI" : "Tiếp quản"}
          </Button>
        </header>

        {historyError && <ErrorMessage>Không tải được lịch sử. Bấm Làm mới để thử lại.</ErrorMessage>}
        {messages?.length === historyLimit && <p className="text-xs">Hiển thị {historyLimit} tin gần nhất.</p>}
        <div ref={messageLog} role="log" aria-label="Tin nhắn" className="max-h-80 min-h-40 overflow-y-auto rounded-lg border border-[#e3dfd8] bg-[#f5f3ef] p-3 md:max-h-[26rem] md:p-4">
          {messages?.length ? (
            <ol className="space-y-3">
              {messages.map((message) => message.sender === "system" ? (
                <li key={message.id} className="flex justify-center">
                  <p className="max-w-[90%] rounded-full bg-[#e9e5de] px-3 py-1 text-center text-xs text-[#5c5954]">
                    <span className="sr-only">{senderLabels.system}: </span>
                    {message.text || "Tin nhắn không có nội dung văn bản"}
                    <time className="ml-2 opacity-70" dateTime={message.created_at}>{inboxDate.format(new Date(message.created_at))}</time>
                  </p>
                </li>
              ) : (
                // Shopper on the left; the shop side (AI and staff) on the right.
                <li key={message.id} className={message.sender === "shopper" ? "flex" : "flex justify-end"}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${bubbleStyles[message.sender]}`}>
                    <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                      <strong>{senderLabels[message.sender]}</strong>
                      <time dateTime={message.created_at}>{inboxDate.format(new Date(message.created_at))}</time>
                    </p>
                    <p className="whitespace-pre-wrap wrap-anywhere">{message.text || "Tin nhắn không có nội dung văn bản"}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : messages ? (
            <p className="text-sm">Chưa có tin nhắn trong cuộc trò chuyện này.</p>
          ) : !historyError && <LoadingRegion label="Đang tải tin nhắn…"><ChatSkeleton /></LoadingRegion>}
        </div>

        {error && <ErrorMessage>{error}</ErrorMessage>}
        {isStaff && sendMessageAction && (
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            const text = reply.trim();
            if (!text) return;
            void runAction("send", () => sendReply(text));
          }}>
            <TextArea label="Tin nhắn cho khách" rows={2} maxLength={1000} value={reply} disabled={pending !== null} onChange={(event) => setReply(event.target.value)} />
            <Button type="submit" disabled={pending !== null || !reply.trim()} loading={pending === "send"} loadingText="Đang gửi…">
              Gửi tin nhắn
            </Button>
          </form>
        )}
        {isStaff && !sendMessageAction && (
          <p className="text-sm">Tính năng gửi tin nhắn đang chờ tích hợp.</p>
        )}
        {!isStaff && (
          <p className="text-sm">
            {conversation.mode === "needs_human" ? "AI đang chờ nhân viên tiếp quản." : "AI đang xử lý hội thoại."}
          </p>
        )}
      </div>
    </section>
  );
}
