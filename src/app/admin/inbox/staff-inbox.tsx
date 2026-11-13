"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Channel, ConversationMode, MessageSender } from "@/contract";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { ChatSkeleton, LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import {
  countConversations, getConversation, historyLimit, listInboxMessages, listTeamNames, searchConversations, setLiveInboxMode,
  subscribeInbox, type InboxConversation, type InboxMessage,
} from "./inbox-live";
import {
  avatarInitial, channelLabels, emptyFilter, formatListTime, type ChannelFilter, type InboxFilter, type ModeFilter,
} from "./inbox-filter";
import { appendPage, mergeFirstPage, type InboxCounts, type InboxPage } from "./inbox-page";
import { formatWaiting, overdueAfterMs, waitingMs } from "./waiting";

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

// The time inside a bubble, readable on each bubble's background.
const timeStyles: Record<Exclude<MessageSender, "system">, string> = {
  shopper: "text-[#706d67]",
  ai: "text-[#6b5c55]",
  staff: "text-[#c9c5bd]",
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
  | ({ status: "ready" } & InboxPage);

type SendMessageAction = (conversationId: string, text: string, requestId: string) => Promise<
  { ok: true } | { ok: false; messageId: string | null }
>;

// Wait this long after the last keystroke before searching the server.
const searchDelayMs = 300;

// `label` replaces the generic text, e.g. "Bạn đang trả lời" in the open conversation.
function ModeBadge({ mode, label }: { mode: ConversationMode; label?: string }) {
  const color = mode === "needs_human" ? "bg-[#fff0eb] text-[#b2382a]" : "bg-[#efebe4] text-[#171717]";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{label ?? modeLabels[mode]}</span>;
}

function Avatar({ conversation, size = "size-11" }: { conversation: InboxConversation; size?: string }) {
  const color = avatarColors[[...conversation.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarColors.length];
  return (
    <span aria-hidden="true" className={`relative flex shrink-0 items-center justify-center rounded-full text-base font-bold ${size} ${color}`}>
      {avatarInitial(conversation)}
      {conversation.mode === "needs_human" && <span className="absolute right-0 top-0 size-3 rounded-full border-2 border-white bg-[#e9573f]" />}
    </span>
  );
}

export function StaffInbox({ sendMessageAction, initialSelectedId, currentUserId }: {
  sendMessageAction?: SendMessageAction;
  // From ?c= in the URL: links from orders and the dashboard open one conversation.
  initialSelectedId?: string;
  currentUserId?: string;
}) {
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [filter, setFilter] = useState<InboxFilter>(emptyFilter);
  // The search the list shows: filter.query once typing pauses.
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Channels seen so far: the channel menu only offers channels the shop uses.
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  // The open conversation when it is not in the loaded pages (an old ?c= link).
  const [outside, setOutside] = useState<InboxConversation | null>(null);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [historyVersion, setHistoryVersion] = useState(0);
  // Clock for "waiting since" labels: set when data arrives, then once a minute,
  // so render never reads the clock itself.
  const [now, setNow] = useState<number | null>(null);
  // Every page-one load takes a new number; a reply for an older number is
  // stale (the filter changed meanwhile) and is dropped. "Tải thêm" reads the
  // number without taking one, so a newer page-one load also drops it.
  const requestId = useRef(0);
  const shownFilter = useRef<string | null>(null);
  const searchFilter = useMemo<InboxFilter>(() => ({ query, mode: filter.mode, channel: filter.channel }), [query, filter.mode, filter.channel]);
  const conversations = state.status === "ready" ? state.conversations : null;

  // Page one and the tab counts for the current filter. Called from effects only:
  // when the filter settles, on reload, and on every realtime change.
  const loadFirstPage = useEffectEvent(() => {
    const target = searchFilter;
    const id = ++requestId.current;
    const key = JSON.stringify(target);
    // A reload or realtime change keeps the pages already loaded; a new filter starts over.
    const keepPages = shownFilter.current === key;
    Promise.all([searchConversations(target), countConversations(target)]).then(
      ([page, nextCounts]) => {
        if (id !== requestId.current) return;
        shownFilter.current = key;
        setState((current) => ({ status: "ready", ...(keepPages && current.status === "ready" ? mergeFirstPage(current, page) : page) }));
        setCounts(nextCounts);
        setChannels((current) => {
          const seen = new Set([...current, ...page.conversations.map(({ channel }) => channel)]);
          return seen.size === current.length ? current : [...seen];
        });
        setNow(Date.now());
        setRefreshing(false);
      },
      () => {
        if (id !== requestId.current) return;
        setState((current) => current.status === "ready" ? current : { status: "error" });
        setRefreshing(false);
      },
    );
  });

  const onMessage = useEffectEvent((conversationId?: string) => {
    if (selectedId && (!conversationId || conversationId === selectedId)) {
      setHistoryVersion((version) => version + 1);
    }
  });

  useEffect(() => {
    if (filter.query === query) return;
    const timer = setTimeout(() => setQuery(filter.query), searchDelayMs);
    return () => clearTimeout(timer);
  }, [filter.query, query]);

  useEffect(() => {
    loadFirstPage();
  }, [searchFilter, attempt]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeInbox(
      () => {
        if (!active || timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          loadFirstPage();
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

  // A ?c= conversation outside the loaded pages is read on its own, again
  // whenever the list reloads so its mode stays current.
  const inList = Boolean(selectedId && conversations?.some(({ id }) => id === selectedId));
  useEffect(() => {
    if (!selectedId || !conversations || inList) return;
    let active = true;
    void getConversation(selectedId).then((conversation) => { if (active) setOutside(conversation); }, () => {});
    return () => { active = false; };
  }, [selectedId, conversations, inList]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // Names only make the badge friendlier; without them it says "Nhân viên".
  useEffect(() => {
    let active = true;
    void listTeamNames().then((names) => { if (active) setTeamNames(names); }, () => {});
    return () => { active = false; };
  }, []);

  // Keep the open conversation in the URL (?c=) so a reload returns to it.
  function select(id: string | null) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }

  function reload() {
    if (state.status === "error") setState({ status: "loading" });
    else setRefreshing(true);
    setAttempt((current) => current + 1);
    setHistoryVersion((version) => version + 1);
  }

  function changeFilter(next: InboxFilter) {
    setFilter(next);
    // Clearing the search shows everything at once, without the typing delay.
    if (!next.query.trim()) setQuery(next.query);
  }

  function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    searchConversations(searchFilter, state.nextCursor).then(
      (page) => {
        if (id === requestId.current) setState((current) => current.status === "ready" ? { status: "ready", ...appendPage(current, page) } : current);
        setLoadingMore(false);
      },
      () => setLoadingMore(false),
    );
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
      counts={counts}
      channels={channels}
      filter={filter}
      onFilterChange={changeFilter}
      searching={filter.query !== query}
      hasMore={Boolean(state.nextCursor)}
      loadingMore={loadingMore}
      loadMore={loadMore}
      now={now}
      selected={state.conversations.find(({ id }) => id === selectedId) ?? (outside?.id === selectedId ? outside : undefined)}
      onSelect={select}
      teamNames={teamNames}
      currentUserId={currentUserId}
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

function InboxConversations({
  conversations, counts, channels, filter, onFilterChange, searching, hasMore, loadingMore, loadMore,
  now, selected, onSelect, teamNames, currentUserId, historyVersion, refreshing, reload, sendMessageAction,
}: {
  conversations: InboxConversation[];
  counts: InboxCounts | null;
  channels: Channel[];
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  // True while typed text waits to be searched.
  searching: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  now: number | null;
  selected?: InboxConversation;
  onSelect: (id: string | null) => void;
  teamNames: Record<string, string>;
  currentUserId?: string;
  historyVersion: number;
  refreshing: boolean;
  reload: () => void;
  sendMessageAction?: SendMessageAction;
}) {
  const filtered = filter.query.trim() !== "" || filter.mode !== "all" || filter.channel !== "all";
  const setFilter = (change: Partial<InboxFilter>) => onFilterChange({ ...filter, ...change });

  return (
    <div className={`ui-card flex overflow-hidden p-0 ${frameHeight}`}>
      <aside aria-label="Danh sách hội thoại" className={`${selected ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-[#e3dfd8] md:w-80 md:shrink-0 md:border-r lg:w-[22rem]`}>
        <div className="space-y-3 border-b border-[#e3dfd8] p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              Đoạn chat
              <span className="rounded-full bg-[#efebe4] px-2 py-0.5 text-xs font-semibold tabular-nums">{counts?.all ?? conversations.length}</span>
            </h2>
            <button
              type="button"
              onClick={reload}
              disabled={refreshing}
              aria-label={refreshing ? "Đang làm mới…" : "Làm mới"}
              title="Làm mới"
              className="flex size-9 items-center justify-center rounded-full text-[#474640] transition-colors hover:bg-[#f5f3ef] disabled:opacity-60"
            >
              <Icon name="refresh" className={`size-4 ${refreshing || searching ? "animate-spin" : ""}`} />
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
                onChange={(event) => setFilter({ query: event.target.value })}
                onKeyDown={(event) => { if (event.key === "Escape") setFilter({ query: "" }); }}
                className="h-10 w-full rounded-full border border-transparent bg-[#f0ede8] pl-9 pr-3 text-sm! outline-none transition-colors placeholder:text-[#66635d] focus:border-[#171717] focus:bg-white"
              />
            </div>
            {channels.length > 1 && (
              <select
                aria-label="Lọc theo kênh"
                value={filter.channel}
                onChange={(event) => setFilter({ channel: event.target.value as ChannelFilter })}
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
                onClick={() => setFilter({ mode: value })}
                className="flex items-center gap-1 rounded-full border border-[#e3dfd8] px-2.5 py-1 text-xs! font-semibold transition-colors hover:border-[#171717] aria-pressed:border-[#171717] aria-pressed:bg-[#171717] aria-pressed:text-white"
              >
                {label}
                {counts && <span className="tabular-nums opacity-70">{counts[value]}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {conversations.length ? (
            <ul className="space-y-0.5">
              {conversations.map((conversation) => {
                const waiting = conversation.mode === "needs_human";
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      aria-current={selected?.id === conversation.id ? "true" : undefined}
                      className="flex w-full min-w-0 items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[#f5f3ef] aria-[current=true]:bg-[#fff0eb]"
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
              {hasMore && (
                <li className="p-2">
                  <Button variant="secondary" className="w-full" loading={loadingMore} loadingText="Đang tải…" onClick={loadMore}>
                    Tải thêm
                  </Button>
                </li>
              )}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <p className="font-semibold">{filtered ? "Không tìm thấy hội thoại phù hợp" : "Chưa có cuộc trò chuyện"}</p>
              <p className="text-sm text-[#706d67]">{filtered ? "Thử từ khóa khác hoặc bỏ bộ lọc." : "Tin nhắn của khách sẽ xuất hiện tại đây."}</p>
              {filtered && <Button variant="secondary" onClick={() => onFilterChange(emptyFilter)}>Xóa bộ lọc</Button>}
            </div>
          )}
        </div>
      </aside>

      {selected ? (
        <ConversationPanel
          key={selected.id}
          conversation={selected}
          teamNames={teamNames}
          currentUserId={currentUserId}
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

function ConversationPanel({ conversation, teamNames, currentUserId, historyVersion, reload, onBack, sendMessageAction }: {
  conversation: InboxConversation;
  teamNames: Record<string, string>;
  currentUserId?: string;
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
  const [notice, setNotice] = useState<string>();
  // Set when this staff member takes over here, until they hand back.
  const [tookOver, setTookOver] = useState(false);
  const sendAttempt = useRef<{ text: string; id: string } | null>(null);
  const messageLog = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const newestMessageId = messages?.at(-1)?.id;
  const conversationId = conversation.id;
  const isStaff = conversation.mode === "staff";
  // Who is replying: the author of the newest staff message, else whoever took over here.
  const lastStaffId = messages?.findLast((message) => message.sender === "staff")?.staff_id;
  const replier = !isStaff ? undefined
    : (lastStaffId ? lastStaffId === currentUserId : tookOver) ? "Bạn đang trả lời"
    : lastStaffId && teamNames[lastStaffId] ? `${teamNames[lastStaffId]} đang trả lời`
    : undefined;

  // After a takeover the composer appears once the list reloads; put the cursor in it.
  useEffect(() => {
    if (isStaff && tookOver) composer.current?.focus();
  }, [isStaff, tookOver]);

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
    setNotice(undefined);
    if (!await setLiveInboxMode(conversationId, isStaff ? "ai" : "staff")) {
      setError("Không đổi được trạng thái hội thoại.");
      return;
    }
    setTookOver(!isStaff);
    setNotice(isStaff ? "Đã trả lại cho AI. AI trả lời từ tin tiếp theo của khách." : "Bạn đã tiếp quản. AI ngừng trả lời cuộc này cho đến khi bạn trả lại.");
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
            <ModeBadge mode={conversation.mode} label={replier} />
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
                  <time className="ml-2" dateTime={message.created_at}>{inboxDate.format(new Date(message.created_at))}</time>
                </p>
              </li>
            ) : (
              // Shopper on the left; the shop side (AI and staff) on the right.
              <li key={message.id} className={message.sender === "shopper" ? "flex" : "flex justify-end"}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm md:max-w-[70%] ${bubbleStyles[message.sender]}`}>
                  <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                    <strong>{senderLabels[message.sender]}</strong>
                    <time className={timeStyles[message.sender]} dateTime={message.created_at}>{inboxDate.format(new Date(message.created_at))}</time>
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
        <div role="status">{notice && <p className="text-center text-sm font-medium text-[#2f6b3a]">{notice}</p>}</div>
        {isStaff && sendMessageAction && (
          <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); submitReply(); }}>
            <textarea
              ref={composer}
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
            {conversation.mode === "needs_human" ? "Khách đang chờ người thật." : "AI đang trả lời cuộc này."} Bấm Tiếp quản để tự trả lời: AI sẽ ngừng trả lời cho đến khi bạn trả lại.
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
