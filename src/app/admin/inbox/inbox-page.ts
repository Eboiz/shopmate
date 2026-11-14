import type { Channel, ConversationMode } from "@/contract";
import { customerLabel, isUnnamed, type InboxFilter, type ModeFilter } from "./inbox-filter";
import type { InboxConversation } from "./inbox-live";

// The inbox list is paged on the server (public.search_inbox): the queue
// (needs_human) first, then newest first, ties broken by id, every key descending.
// A cursor is the last row's keys; the next page starts right after it.
export type InboxCursor = { urgent: boolean; at: string; id: string };
export type InboxPage = { conversations: InboxConversation[]; nextCursor: InboxCursor | null };
export type InboxCounts = Record<ModeFilter, number>;

// One row as search_inbox returns it. The generated types call every column
// non-null; names and messages can be null.
export type InboxRow = {
  id: string;
  mode: ConversationMode;
  channel: Channel;
  display_name: string | null;
  last_message_at: string;
  latest_message: string | null;
  customer_message: string | null;
  customer_message_at: string | null;
};

// PB-30: a message with photos and no text shows as this in the list. The
// list rows carry text only, and a message with empty text is a photo message
// (every other message needs text).
export const PHOTO_PREVIEW = "[Ảnh]";
const preview = (text: string | null) => (text === "" ? PHOTO_PREVIEW : text);

export function toInboxConversation(row: InboxRow): InboxConversation {
  return {
    id: row.id,
    customerName: customerLabel(row.display_name, row.channel, row.id),
    unnamed: isUnnamed(row.display_name) || undefined,
    channel: row.channel,
    mode: row.mode,
    lastMessageAt: row.last_message_at,
    latestMessage: preview(row.latest_message) ?? undefined,
    // A shopper message exists only when it has a time; then empty text is a photo.
    customerMessage: (row.customer_message_at ? preview(row.customer_message) : row.customer_message) || undefined,
    customerMessageAt: row.customer_message_at ?? undefined,
  };
}

// What search_inbox and inbox_counts take for a filter: "all" and a blank
// search are left out (null on the server).
export function filterArgs(filter: InboxFilter) {
  return {
    p_query: filter.query.trim() || undefined,
    p_mode: filter.mode === "all" ? undefined : filter.mode,
    p_channel: filter.channel === "all" ? undefined : filter.channel,
  };
}

export function cursorArgs(cursor: InboxCursor | null | undefined) {
  return cursor ? { p_after_urgent: cursor.urgent, p_after_at: cursor.at, p_after_id: cursor.id } : {};
}

export function cursorAfter(conversation: InboxConversation): InboxCursor {
  return { urgent: conversation.mode === "needs_human", at: conversation.lastMessageAt, id: conversation.id };
}

// A full page means there may be more; a short one is the end.
export function toPage(rows: InboxRow[], limit: number): InboxPage {
  const conversations = rows.map(toInboxConversation);
  const last = conversations.at(-1);
  return { conversations, nextCursor: last && rows.length >= limit ? cursorAfter(last) : null };
}

// Postgres sends microseconds, which Date drops: compare the milliseconds,
// then the remaining digits.
function microseconds(iso: string) {
  return Number((iso.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
}

function compareTime(a: string, b: string) {
  return Date.parse(a) - Date.parse(b) || microseconds(a) - microseconds(b);
}

// Negative when `a` comes before `b` in the list.
export function compareCursor(a: InboxCursor, b: InboxCursor) {
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  return compareTime(b.at, a.at) || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
}

// Appends the next page, skipping rows already shown (a row can move while
// staff read).
export function appendPage(current: InboxPage, next: InboxPage): InboxPage {
  const shown = new Set(current.conversations.map(({ id }) => id));
  return {
    conversations: [...current.conversations, ...next.conversations.filter(({ id }) => !shown.has(id))],
    nextCursor: next.nextCursor,
  };
}

// A realtime change reloads page one only. Keep the pages staff already loaded
// below it, so "Tải thêm" does not have to start over: page one wins for every
// row it holds, the older rows stay after its last row.
export function mergeFirstPage(current: InboxPage, first: InboxPage): InboxPage {
  const last = first.conversations.at(-1);
  if (!first.nextCursor || !last) return first;
  const end = cursorAfter(last);
  const inFirst = new Set(first.conversations.map(({ id }) => id));
  const rest = current.conversations
    .filter((conversation) => !inFirst.has(conversation.id) && compareCursor(cursorAfter(conversation), end) > 0)
    .sort((a, b) => compareCursor(cursorAfter(a), cursorAfter(b)));
  return rest.length
    ? { conversations: [...first.conversations, ...rest], nextCursor: current.nextCursor }
    : first;
}
