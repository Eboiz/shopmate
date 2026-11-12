"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Channel, ConversationMode, MessageSender } from "@/contract";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { ChatSkeleton, LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import {
  historyLimit, listInboxMessages, listLiveConversations, setLiveInboxMode, subscribeInbox,
  type InboxConversation, type InboxMessage,
} from "./inbox-live";
import {
  countByMode, emptyFilter, filterConversations, formatListTime, initialOf,
  type ChannelFilter, type InboxFilter, type ModeFilter,
} from "./inbox-filter";
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

const modeFilters: { value: ModeFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "needs_human", label: "Cần nhân viên" },
  { value: "staff", label: "Nhân viên" },
  { value: "ai", label: "AI" },
];

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

const avatarColors = ["bg-[#fde3d9] text-[#9a3412]", "bg-[#e0ecdf] text-[#2f5a32]", "bg-[#e3e7f5] text-[#2f3f7a]", "bg-[#f3e6c8] text-[#6b4d0f]", "bg-[#ece2f0] text-[#5b3168]"];

const inboxDate = new Intl.DateTimeFormat("vi-VN", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

// The inbox is one fixed-height card filling the screen under the page title:
// the page itself stays put while the list and the message log scroll inside it.
// Below lg the 19rem also leaves room for the fixed bottom nav.
const frameHeight = "h-[calc(100dvh-19rem)] min-h-[26rem] lg:h-[calc(100dvh-16rem)]";

type InboxState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; conversations: InboxConversation[] };

type SendMessageAction = (conversationId: string, text: string, requestId: string) => Promise<
  { ok: true } | { ok: false; messageId: string | null }
>;

function ModeBadge({ mode }: { mode: ConversationMode }) {
  const color = mode === "needs_human" ? "bg-[#fff0eb] text-[#b2382a]" : "bg-[#efebe4] text-[#171717]";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{modeLabels[mode]}</span>;
}

function Avatar({ conversation, size = "size-11" }: { conversation: InboxConversation; size?: string }) {
  const color = avatarColors[[...conversation.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarColors.length];
  return (
    <span aria-hidden="true" className={`relative flex shrink-0 items-center justify-center rounded-full text-base font-bold ${size} ${color}`}>
      {initialOf(conversation.customerName)}
      {conversation.mode === "needs_human" && <span className="absolute right-0 top-0 size-3 rounded-full border-2 border-white bg-[#e9573f]" />}
    </span>
  );
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

  if (state.status === "loading") return <InboxSkeleton />;

  if (state.status === "error") {
    return (
      <div className="ui-card space-y-3 p-5">
        <ErrorMessage>Không tải được danh sách hội thoại.</ErrorMessage>
        <Button variant="secondary" onClick={reload}>
          Thử lại
        </Button>
      </div>
    );
  }

  return (
    <InboxConversations
      conversations={state.conversations}
      now={now}
      selected={state.conversations.find(({ id }) => id === selectedId)}
      onSelect={setSelectedId}
      historyVersion={historyVersion}
      refreshing={refreshing}
      reload={reload}
      sendMessageAction={sendMessageAction}
    />
  );
}

function WaitingBadge({ since, now }: { since: string; now: number }) {
  const ms = waitingMs(since, now);
  const overdue = ms >= overdueAfterMs;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${overdue ? "bg-[#b2382a] text-white" : "bg-[#efebe4] text-[#171717]"}`}>
      Chờ {formatWaiting(ms)}
    </span>
  );
}

function InboxConversations({ conversations, now, selected, onSelect, historyVersion, refreshing, reload, sendMessageAction }: {
  conversations: InboxConversation[];
  now: number | null;
  selected?: InboxConversation;
  onSelect: (id: string | null) => void;
  historyVersion: number;
  refreshing: boolean;
  reload: () => void;
  sendMessageAction?: SendMessageAction;
}) {
  const [filter, setFilter] = useState<InboxFilter>(emptyFilter);
  const visible = useMemo(() => filterConversations(conversations, filter), [conversations, filter]);
  const counts = useMemo(() => countByMode(conversations, filter), [conversations, filter]);
  // Only offer the channels this shop actually has conversations on.
  const channels = useMemo(() => [...new Set(conversations.map(({ channel }) => channel))], [conversations]);
  const filtered = filter.query.trim() !== "" || filter.mode !== "all" || filter.channel !== "all";

  return (
    <div className={`ui-card flex overflow-hidden p-0 ${frameHeight}`}>
      <aside aria-label="Danh sách hội thoại" className={`${selected ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-[#e3dfd8] md:w-80 md:shrink-0 md:border-r lg:w-[22rem]`}>
        <div className="space-y-3 border-b border-[#e3dfd8] p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              Đoạn chat
              <span className="rounded-full bg-[#efebe4] px-2 py-0.5 text-xs font-semibold">{conversations.length}</span>
            </h2>
            <button
              type="button"
              onClick={reload}
              disabled={refreshing}
              aria-label={refreshing ? "Đang làm mới…" : "Làm mới"}
              title="Làm mới"
              className="flex size-9 items-center justify-center rounded-full text-[#474640] transition-colors hover:bg-[#f5f3ef] disabled:opacity-60"
            >
              <Icon name="refresh" className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Font sizes on form controls need "!": globals.css resets them to `font: inherit` outside any layer. */}
          <div className="flex gap-2">
            <div role="search" className="relative min-w-0 flex-1">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#706d67]" />
              <input
                type="search"
                aria-label="Tìm hội thoại"
                placeholder="Tìm khách, tin nhắn…"
                value={filter.query}
                onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                onKeyDown={(event) => { if (event.key === "Escape") setFilter((current) => ({ ...current, query: "" })); }}
                className="h-10 w-full rounded-full border border-transparent bg-[#f0ede8] pl-9 pr-3 text-sm! outline-none transition-colors placeholder:text-[#7a766f] focus:border-[#171717] focus:bg-white"
              />
            </div>
            {channels.length > 1 && (
              <select
                aria-label="Lọc theo kênh"
                value={filter.channel}
                onChange={(event) => setFilter((current) => ({ ...current, channel: event.target.value as ChannelFilter }))}
                className="h-10 w-28 shrink-0 rounded-full border border-transparent bg-[#f0ede8] px-3 text-xs! font-semibold outline-none focus:border-[#171717] focus:bg-white"
              >
                <option value="all">Mọi kênh</option>
                {channels.map((channel) => <option key={channel} value={channel}>{channelLabels[channel]}</option>)}
              </select>
            )}
          </div>

          <div role="group" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-1.5">
            {modeFilters.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter.mode === value}
                onClick={() => setFilter((current) => ({ ...current, mode: value }))}
                className="flex items-center gap-1 rounded-full border border-[#e3dfd8] px-2.5 py-1 text-xs! font-semibold transition-colors hover:border-[#171717] aria-pressed:border-[#171717] aria-pressed:bg-[#171717] aria-pressed:text-white"
              >
                {label}
                <span className="tabular-nums opacity-70">{counts[value]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {visible.length ? (
            <ul className="space-y-0.5">
              {visible.map((conversation) => {
                const waiting = conversation.mode === "needs_human";
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      aria-pressed={selected?.id === conversation.id}
                      className="flex w-full min-w-0 items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[#f5f3ef] aria-pressed:bg-[#fff0eb]"
                      onClick={() => onSelect(conversation.id)}
                    >
                      <Avatar conversation={conversation} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`min-w-0 truncate ${waiting ? "font-bold" : "font-semibold"}`}>{conversation.customerName}</span>
                          <time className={`shrink-0 text-[11px] ${waiting ? "font-semibold text-[#b2382a]" : "text-[#706d67]"}`} dateTime={conversation.lastMessageAt}>
                            {now === null ? inboxDate.format(new Date(conversation.lastMessageAt)) : formatListTime(conversation.lastMessageAt, now)}
                          </time>
                        </span>
                        <span className={`block truncate text-sm ${waiting ? "font-medium text-[#171717]" : "text-[#706d67]"}`}>
                          {conversation.customerMessage ?? (conversation.latestMessage || "Chưa có nội dung văn bản")}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-[#706d67]">
                          {channelLabels[conversation.channel]}
                          <span aria-hidden="true">·</span>
                          <ModeBadge mode={conversation.mode} />
                          {waiting && now !== null && (
                            <WaitingBadge since={conversation.customerMessageAt ?? conversation.lastMessageAt} now={now} />
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <p className="font-semibold">{filtered ? "Không tìm thấy hội thoại phù hợp" : "Chưa có cuộc trò chuyện"}</p>
              <p className="text-sm text-[#706d67]">{filtered ? "Thử từ khóa khác hoặc bỏ bộ lọc." : "Tin nhắn của khách sẽ xuất hiện tại đây."}</p>
              {filtered && <Button variant="secondary" onClick={() => setFilter(emptyFilter)}>Xóa bộ lọc</Button>}
            </div>
          )}
        </div>
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
        <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-[#faf9f7] p-6 text-center md:flex">
          <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-[#efebe4]"><Icon name="chat" className="size-7" /></span>
          <p className="font-semibold">Chọn một cuộc trò chuyện</p>
          <p className="max-w-xs text-sm text-[#706d67]">Lịch sử tin nhắn sẽ xuất hiện tại đây.</p>
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

  function submitReply() {
    const text = reply.trim();
    if (!text || pending) return;
    void runAction("send", () => sendReply(text));
  }

  return (
    <section aria-label={`Cuộc trò chuyện với ${conversation.customerName}`} className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[#e3dfd8] px-3 py-3 sm:px-4">
        <button type="button" onClick={onBack} aria-label="Về danh sách" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[#f5f3ef] md:hidden">
          <Icon name="up" className="size-5 -rotate-90" />
        </button>
        <Avatar conversation={conversation} size="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{conversation.customerName}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#706d67]">
            {channelLabels[conversation.channel]}
            <span aria-hidden="true">·</span>
            <ModeBadge mode={conversation.mode} />
          </div>
        </div>
        <Button variant={isStaff ? "secondary" : "primary"} className="shrink-0" disabled={pending !== null}
          loading={pending === "mode"} loadingText="Đang cập nhật…"
          onClick={() => void runAction("mode", changeMode)}>
          {isStaff ? "Trả lại cho AI" : "Tiếp quản"}
        </Button>
      </header>

      <div ref={messageLog} role="log" aria-label="Tin nhắn" className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f5f3ef] p-3 md:p-5">
        {historyError && <div className="mb-3"><ErrorMessage>Không tải được lịch sử. Bấm Làm mới để thử lại.</ErrorMessage></div>}
        {messages?.length === historyLimit && <p className="mb-3 text-center text-xs text-[#706d67]">Hiển thị {historyLimit} tin gần nhất.</p>}
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
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm md:max-w-[70%] ${bubbleStyles[message.sender]}`}>
                  <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                    <strong>{senderLabels[message.sender]}</strong>
                    <time className="opacity-70" dateTime={message.created_at}>{inboxDate.format(new Date(message.created_at))}</time>
                  </p>
                  {message.photoUrls.length > 0 && (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {message.photoUrls.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Mở ảnh ${i + 1} của khách`}>
                          {/* Signed URLs expire after an hour: not for next/image's cache. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Ảnh khách gửi ${i + 1}`} className="max-h-48 max-w-[200px] rounded-lg object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {message.photoError && <p className="text-xs opacity-80">Không tải được ảnh.</p>}
                  {(message.text || message.photoUrls.length === 0) && !message.photoError && (
                    <p className="whitespace-pre-wrap wrap-anywhere">{message.text || "Tin nhắn không có nội dung văn bản"}</p>
                  )}
                  {message.text && message.photoError && <p className="whitespace-pre-wrap wrap-anywhere">{message.text}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : messages ? (
          <p className="text-center text-sm text-[#706d67]">Chưa có tin nhắn trong cuộc trò chuyện này.</p>
        ) : !historyError && <LoadingRegion label="Đang tải tin nhắn…"><ChatSkeleton /></LoadingRegion>}
      </div>

      <footer className="space-y-2 border-t border-[#e3dfd8] bg-white p-3">
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {isStaff && sendMessageAction && (
          <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); submitReply(); }}>
            <textarea
              aria-label="Tin nhắn cho khách"
              placeholder="Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng)"
              rows={1}
              maxLength={1000}
              value={reply}
              disabled={pending !== null}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                // Vietnamese input methods compose with Enter too; never send mid-word.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitReply();
                }
              }}
              className="ui-field max-h-32 min-h-11 flex-1 resize-none rounded-2xl px-4 py-2.5 text-base field-sizing-content"
            />
            <Button type="submit" aria-label="Gửi tin nhắn" className="shrink-0" disabled={pending !== null || !reply.trim()} loading={pending === "send"} loadingText="Đang gửi…">
              <Icon name="send" className="size-4" /> Gửi
            </Button>
          </form>
        )}
        {isStaff && !sendMessageAction && (
          <p className="text-sm text-[#706d67]">Tính năng gửi tin nhắn đang chờ tích hợp.</p>
        )}
        {!isStaff && (
          <p className="text-center text-sm text-[#706d67]">
            {conversation.mode === "needs_human" ? "AI đang chờ nhân viên tiếp quản. Bấm Tiếp quản để trả lời khách." : "AI đang xử lý hội thoại. Bấm Tiếp quản nếu muốn tự trả lời."}
          </p>
        )}
      </footer>
    </section>
  );
}

// The same card, list rows and empty chat pane as InboxConversations.
function InboxSkeleton() {
  return (
    <LoadingRegion label="Đang tải hộp thư…" className={`ui-card flex overflow-hidden p-0 ${frameHeight}`}>
      <div className="flex w-full flex-col border-[#e3dfd8] md:w-80 md:shrink-0 md:border-r lg:w-[22rem]">
        <div className="space-y-3 border-b border-[#e3dfd8] p-4">
          <div className="flex h-9 items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="size-9 rounded-full" />
          </div>
          <Skeleton className="h-10 w-full rounded-full" />
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((chip) => <Skeleton key={chip} className="h-6 w-16 rounded-full" />)}
          </div>
        </div>
        <div className="space-y-1 p-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3 p-2.5">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="hidden flex-1 bg-[#faf9f7] md:block" />
    </LoadingRegion>
  );
}
