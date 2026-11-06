"use client";

import { useEffect, useRef, useState } from "react";
import type { Channel, ConversationMode, MessageSender } from "@/contract";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { TextArea } from "@/components/ui/text-area";
import { createDemoInbox, type InboxConversation, type InboxDataSource } from "./inbox-data";

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

function compareConversations(first: InboxConversation, second: InboxConversation) {
  const priority = Number(second.mode === "needs_human") - Number(first.mode === "needs_human");
  return priority || Date.parse(second.lastMessageAt) - Date.parse(first.lastMessageAt);
}

function ModeBadge({ mode }: { mode: ConversationMode }) {
  const color = mode === "needs_human" ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{modeLabels[mode]}</span>;
}

export function StaffInbox() {
  const [{ source, simulateCustomerMessage, simulateHandoff }] = useState(createDemoInbox);
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = source.subscribe((conversations) => {
      if (!active) return;
      receivedUpdate = true;
      setState({ status: "ready", conversations });
    });

    void source.listConversations().then(
      (conversations) => {
        if (active && !receivedUpdate) setState({ status: "ready", conversations });
      },
      () => {
        if (active && !receivedUpdate) setState({ status: "error" });
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt, source]);

  if (state.status === "loading") return <p role="status">Đang tải hộp thư…</p>;

  if (state.status === "error") {
    return (
      <div className="space-y-3">
        <ErrorMessage>Không tải được danh sách hội thoại.</ErrorMessage>
        <Button variant="secondary" onClick={() => {
          setState({ status: "loading" });
          setAttempt((current) => current + 1);
        }}>
          Thử lại
        </Button>
      </div>
    );
  }

  if (!state.conversations.length) {
    return <EmptyState title="Chưa có cuộc trò chuyện" description="Tin nhắn của khách sẽ xuất hiện tại đây." />;
  }

  const selected = state.conversations.find(({ id }) => id === selectedId);
  const conversations = [...state.conversations].sort(compareConversations);

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
                onClick={() => setSelectedId(conversation.id)}
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
                  {conversation.messages.at(-1)?.text || "Chưa có tin nhắn"}
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
          source={source}
          onBack={() => setSelectedId(null)}
          onDemoMessage={() => simulateCustomerMessage(selected.id)}
          onDemoHandoff={() => simulateHandoff(selected.id)}
        />
      ) : (
        <div className="hidden md:block">
          <EmptyState title="Chọn một cuộc trò chuyện" description="Lịch sử tin nhắn sẽ xuất hiện tại đây." />
        </div>
      )}
    </div>
  );
}

function ConversationPanel({ conversation, source, onBack, onDemoMessage, onDemoHandoff }: {
  conversation: InboxConversation;
  source: InboxDataSource;
  onBack: () => void;
  onDemoMessage: () => void;
  onDemoHandoff: () => void;
}) {
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState<"mode" | "send" | null>(null);
  const [error, setError] = useState<string>();
  const messageLog = useRef<HTMLDivElement>(null);
  const newestMessageId = conversation.messages.at(-1)?.id;
  const isStaff = conversation.mode === "staff";

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
      setError(action === "mode" ? "Không đổi được trạng thái hội thoại." : "Không gửi được tin nhắn.");
    } finally {
      setPending(null);
    }
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
          <Button
            variant={isStaff ? "secondary" : "primary"}
            disabled={pending !== null}
            onClick={() => void runAction("mode", () => source.setMode(conversation.id, isStaff ? "ai" : "staff"))}
          >
            {pending === "mode" ? "Đang cập nhật…" : isStaff ? "Trả lại cho AI" : "Tiếp quản"}
          </Button>
        </header>

        <div ref={messageLog} role="log" aria-label="Tin nhắn" className="max-h-80 min-h-24 overflow-y-auto border-y border-zinc-200 py-3 md:max-h-[26rem]">
          {conversation.messages.length ? (
            <ol className="space-y-3">
              {conversation.messages.map((message) => (
                <li key={message.id} className={message.sender === "staff" ? "flex justify-end" : "flex"}>
                  <div className="max-w-[85%] rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                    <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                      <strong>{senderLabels[message.sender]}</strong>
                      <time dateTime={message.createdAt}>{inboxDate.format(new Date(message.createdAt))}</time>
                    </p>
                    <p className="whitespace-pre-wrap wrap-anywhere">{message.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm">Chưa có tin nhắn trong cuộc trò chuyện này.</p>
          )}
        </div>

        {error && <ErrorMessage>{error}</ErrorMessage>}
        {isStaff ? (
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            const text = reply.trim();
            if (!text) return;
            void runAction("send", async () => {
              await source.sendMessage(conversation.id, text);
              setReply("");
            });
          }}>
            <TextArea label="Tin nhắn cho khách" rows={2} value={reply} disabled={pending !== null} onChange={(event) => setReply(event.target.value)} />
            <Button type="submit" disabled={pending !== null || !reply.trim()}>
              {pending === "send" ? "Đang gửi…" : "Gửi tin nhắn"}
            </Button>
          </form>
        ) : (
          <p className="text-sm">
            {conversation.mode === "needs_human" ? "AI đang chờ nhân viên tiếp quản." : "Tiếp quản để gửi tin nhắn cho khách."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm" aria-label="Thao tác với dữ liệu mẫu">
        <Button variant="secondary" disabled={pending !== null} onClick={onDemoMessage}>Mô phỏng tin mới</Button>
        {conversation.mode === "ai" && (
          <Button variant="secondary" disabled={pending !== null} onClick={onDemoHandoff}>Mô phỏng yêu cầu tiếp quản</Button>
        )}
      </div>
    </section>
  );
}
