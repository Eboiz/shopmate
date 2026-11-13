import type { Channel, ConversationMode } from "@/contract";
import type { InboxConversation } from "./inbox-live";

export const channelLabels: Record<Channel, string> = {
  web: "Web chat",
  messenger: "Messenger",
  instagram: "Instagram",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

// A shopper who never gave a name still needs a label staff can tell apart
// from the next one: "Khách Messenger #3F2A" instead of a row of "Khách hàng".
export function customerLabel(displayName: string | null | undefined, channel: Channel, conversationId: string) {
  return displayName?.trim() || `Khách ${channelLabels[channel]} #${conversationId.slice(0, 4).toUpperCase()}`;
}

export type ModeFilter = "all" | ConversationMode;
export type ChannelFilter = "all" | Channel;
export type InboxFilter = { query: string; mode: ModeFilter; channel: ChannelFilter };

export const emptyFilter: InboxFilter = { query: "", mode: "all", channel: "all" };

// Staff type Vietnamese without diacritics as often as with them, so
// "lan anh" must find "Lan Anh" and "Lân Ánh" alike.
export function foldSearch(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d").trim();
}

function matchesQuery(conversation: InboxConversation, query: string) {
  if (!query) return true;
  return [conversation.customerName, conversation.customerMessage, conversation.latestMessage]
    .some((text) => text && foldSearch(text).includes(query));
}

export function filterConversations(conversations: InboxConversation[], filter: InboxFilter) {
  const query = foldSearch(filter.query);
  return conversations.filter((conversation) =>
    (filter.mode === "all" || conversation.mode === filter.mode)
    && (filter.channel === "all" || conversation.channel === filter.channel)
    && matchesQuery(conversation, query));
}

// How many conversations each mode chip would show, given the other filters.
export function countByMode(conversations: InboxConversation[], filter: InboxFilter): Record<ModeFilter, number> {
  const counts: Record<ModeFilter, number> = { all: 0, ai: 0, needs_human: 0, staff: 0 };
  for (const conversation of filterConversations(conversations, { ...filter, mode: "all" })) {
    counts.all += 1;
    counts[conversation.mode] += 1;
  }
  return counts;
}

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
const timeOfDay = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
const dayOfYear = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "numeric", timeZone: "Asia/Ho_Chi_Minh" });
const fullDate = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" });

// The short time beside each conversation, the way chat apps show it:
// today -> "14:05", this year -> "5/11", older -> "5/11/2025".
export function formatListTime(iso: string, now: number) {
  const date = new Date(iso);
  if (dayKey.format(date) === dayKey.format(now)) return timeOfDay.format(date);
  if (dayKey.format(date).slice(0, 4) === dayKey.format(now).slice(0, 4)) return dayOfYear.format(date);
  return fullDate.format(date);
}

// One letter for the avatar: the given name, which Vietnamese puts last.
// Notes in brackets ("(demo 013)") and words without letters are skipped.
export function initialOf(name: string) {
  return name.replace(/\(.*?\)/g, " ").match(/\p{L}+/gu)?.at(-1)?.charAt(0).toUpperCase() ?? "?";
}

// The avatar letter for a conversation: the given name, or the channel's
// first letter when the shopper has no name (customerLabel made one up).
export function avatarInitial(conversation: Pick<InboxConversation, "customerName" | "channel" | "unnamed">) {
  return conversation.unnamed ? channelLabels[conversation.channel].charAt(0) : initialOf(conversation.customerName);
}
