import type { Channel, ConversationMode, MessageSender } from "@/contract";
import { createClient } from "@/lib/supabase/client";
import type { InboxFilter } from "./inbox-filter";
import {
  cursorArgs, filterArgs, toInboxConversation, toPage, type InboxCounts, type InboxCursor, type InboxPage,
} from "./inbox-page";

// staff_id is set on staff messages: who on the team wrote it. photoUrls (PB-30):
// the shopper's photos, signed for an hour from the private bucket (staff may
// read only their shop's folder); photoError when signing failed.
export type InboxMessage = {
  id: string;
  sender: MessageSender;
  text: string;
  created_at: string;
  staff_id: string | null;
  photoUrls: string[];
  photoError?: true;
};
export { PHOTO_PREVIEW } from "./inbox-page";
export type InboxConversation = {
  id: string;
  customerName: string;
  // True when the shopper gave no name and customerName is a made-up label.
  unnamed?: boolean;
  channel: Channel;
  mode: ConversationMode;
  lastMessageAt: string;
  latestMessage: string | undefined;
  // The shopper's own newest message: what staff need to read to triage, since
  // the newest message overall is often the AI's handoff notice.
  customerMessage?: string;
  customerMessageAt?: string;
};

export const pageSize = 50;
export const historyLimit = 50;

// One page of the shop's conversations matching the filter, searched on the
// server so older conversations are found too (PB-41).
export async function searchConversations(filter: InboxFilter, cursor?: InboxCursor | null, limit = pageSize): Promise<InboxPage> {
  const { data, error } = await createClient().rpc("search_inbox", { ...filterArgs(filter), ...cursorArgs(cursor), p_limit: limit });
  if (error) throw error;
  return toPage(data, limit);
}

// How many conversations each mode tab holds under the search and channel.
export async function countConversations(filter: Pick<InboxFilter, "query" | "channel">): Promise<InboxCounts> {
  const { p_query, p_channel } = filterArgs({ ...filter, mode: "all" });
  const { data, error } = await createClient().rpc("inbox_counts", { p_query, p_channel }).single();
  if (error) throw error;
  return { all: data.total, ai: data.ai, needs_human: data.needs_human, staff: data.staff };
}

// One conversation by id, for a ?c= link to a conversation outside the loaded pages.
export async function getConversation(id: string): Promise<InboxConversation | null> {
  const { data, error } = await createClient().from("conversations")
    .select("id, mode, last_message_at, shoppers!inner(channel, display_name), messages(text), customer_message:messages(text, created_at)")
    .eq("id", id)
    .eq("customer_message.sender", "shopper")
    .order("created_at", { referencedTable: "messages", ascending: false })
    .order("id", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" })
    .order("created_at", { referencedTable: "customer_message", ascending: false })
    .order("id", { referencedTable: "customer_message", ascending: false })
    .limit(1, { referencedTable: "customer_message" })
    .maybeSingle();
  if (error) throw error;
  return data && toInboxConversation({
    id: data.id,
    mode: data.mode,
    channel: data.shoppers.channel,
    display_name: data.shoppers.display_name,
    last_message_at: data.last_message_at,
    latest_message: data.messages[0]?.text ?? null,
    customer_message: data.customer_message[0]?.text ?? null,
    customer_message_at: data.customer_message[0]?.created_at ?? null,
  });
}

export async function listInboxMessages(conversationId: string): Promise<InboxMessage[]> {
  const db = createClient();
  const { data, error } = await db.from("messages")
    .select("id, sender, text, created_at, staff_id, photo_paths")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(historyLimit);

  if (error) throw error;
  // One signing call for every photo in the history.
  const paths = data.flatMap((m) => m.photo_paths);
  let signed = new Map<string, string>();
  let signError = false;
  if (paths.length > 0) {
    const result = await db.storage.from("chat-photos").createSignedUrls(paths, 3600);
    if (result.error || !result.data) signError = true;
    else signed = new Map(result.data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
  }
  return data.reverse().map(({ photo_paths, ...message }) => {
    const photoUrls = photo_paths.flatMap((p) => (signed.has(p) ? [signed.get(p)!] : []));
    return { ...message, photoUrls, ...(photo_paths.length > photoUrls.length || (signError && photo_paths.length > 0) ? { photoError: true as const } : {}) };
  });
}

// Names of the shop's team (RLS limits profiles to the signed-in user's shop),
// so the inbox can say who is replying. A missing name stays out of the map.
export async function listTeamNames(): Promise<Record<string, string>> {
  const { data, error } = await createClient().from("profiles").select("id, full_name");
  if (error) throw error;
  return Object.fromEntries(data.flatMap(({ id, full_name }) => full_name?.trim() ? [[id, full_name.trim()]] : []));
}

export async function setLiveInboxMode(conversationId: string, mode: "ai" | "staff") {
  const { data, error } = await createClient().from("conversations")
    .update({ mode })
    .eq("id", conversationId)
    .select("id")
    .maybeSingle();

  return !error && Boolean(data);
}

export function subscribeInbox(onChange: () => void, onMessage: (conversationId?: string) => void) {
  const db = createClient();
  const channel = db.channel(`staff-inbox-${crypto.randomUUID()}`, { config: { postgres_changes_options: { wait: true } } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversations" }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, ({ new: conversation }) => {
      onChange();
      onMessage(typeof conversation.id === "string" ? conversation.id : undefined);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: message }) => {
      onChange();
      onMessage(typeof message.conversation_id === "string" ? message.conversation_id : undefined);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onChange();
        onMessage();
      }
    });

  return () => { void db.removeChannel(channel); };
}
