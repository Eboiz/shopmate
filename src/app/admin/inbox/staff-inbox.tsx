"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Channel, ConversationMode, MessageSender } from "@/contract";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { TextArea } from "@/components/ui/text-area";
import {
  historyLimit, listInboxMessages, listLiveConversations, setLiveInboxMode, subscribeInbox,
  type InboxConversation, type InboxMessage,
} from "./inbox-live";

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
  const color = mode === "needs_human" ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{modeLabels[mode]}</span>;
}

export function StaffInbox({ sendMessageAction }: { sendMessageAction?: SendMessageAction }) {
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
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
          if (active && id === requestId) setState({ status: "ready", conversations });
        },
        () => {
          if (active && id === requestId) setState((current) => current.status === "ready" ? current : { status: "error" });
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

  function reload() {
    if (state.status === "error") setState({ status: "loading" });
    setAttempt((current) => current + 1);
    setHistoryVersion((version) => version + 1);
  }

  if (state.status === "loading") return <p role="status">Đang tải hộp thư…</p>;

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
      <Button variant="secondary" className="mb-3" onClick={reload}>Làm mới</Button>
      {conversations.length ? (
        <InboxConversations
          conversations={conversations}
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

function InboxConversations({ conversations, selected, onSelect, historyVersion, reload, sendMessageAction }: {
  conversations: InboxConversation[];
  selected?: InboxConversation;
  onSelect: (id: string | null) => void;
  historyVersion: number;
  reload: () => void;
  sendMessageAction?: SendMessageAction;
}) {
  return (
    <div className="gap-4 md:grid md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <aside aria-label="Danh sách hội thoại" className={selected ? "hidden md:block" : undefined}>
        <ul className="space-y-2">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                aria-pressed={selected?.id === conversation.id}
                className="block w-full min-w-0 rounded-lg border border-zinc-300 p-3 text-left aria-pressed:border-zinc-600"
                onClick={() => onSelect(conversation.id)}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">{conversation.customerName}</span>
                  <time className="shrink-0 text-xs" dateTime={conversation.lastMessageAt}>
                    {inboxDate.format(new Date(conversation.lastMessageAt))}
                  </time>
                </span>
                <span className="my-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {channelLabels[conversation.channel]}
                  <ModeBadge mode={conversation.mode} />
                </span>
                <span className="block truncate text-sm">
                  {conversation.latestMessage || "Chưa có nội dung văn bản"}
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
        <div className="hidden md:block">
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
    <section aria-label={`Cuộc trò chuyện với ${conversation.customerName}`} className="min-w-0 space-y-3">
      <Button variant="secondary" className="md:hidden" onClick={onBack}>Về danh sách</Button>

      <div className="space-y-3 rounded-lg border border-zinc-300 p-3 sm:p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="wrap-anywhere font-semibold">{conversation.customerName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {channelLabels[conversation.channel]}
              <ModeBadge mode={conversation.mode} />
            </div>
          </div>
          <Button variant={isStaff ? "secondary" : "primary"} disabled={pending !== null}
            onClick={() => void runAction("mode", changeMode)}>
            {pending === "mode" ? "Đang cập nhật…" : isStaff ? "Trả lại cho AI" : "Tiếp quản"}
          </Button>
        </header>

        {historyError && <ErrorMessage>Không tải được lịch sử. Bấm Làm mới để thử lại.</ErrorMessage>}
        {messages?.length === historyLimit && <p className="text-xs">Hiển thị {historyLimit} tin gần nhất.</p>}
        <div ref={messageLog} role="log" aria-label="Tin nhắn" className="max-h-80 min-h-24 overflow-y-auto border-y border-zinc-200 py-3 md:max-h-[26rem]">
          {messages?.length ? (
            <ol className="space-y-3">
              {messages.map((message) => (
                <li key={message.id} className={message.sender === "staff" ? "flex justify-end" : "flex"}>
                  <div className="max-w-[85%] rounded-lg border border-zinc-200 px-3 py-2 text-sm">
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
          ) : !historyError && <p role="status" className="text-sm">Đang tải tin nhắn…</p>}
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
            <Button type="submit" disabled={pending !== null || !reply.trim()}>
              {pending === "send" ? "Đang gửi…" : "Gửi tin nhắn"}
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
