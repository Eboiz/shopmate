import type { Channel, ConversationMode, MessageSender } from "@/contract";
import { createClient } from "@/lib/supabase/client";

export type InboxMessage = { id: string; sender: MessageSender; text: string; created_at: string };
export type InboxConversation = {
  id: string;
  customerName: string;
  channel: Channel;
  mode: ConversationMode;
  lastMessageAt: string;
  latestMessage: string | undefined;
  // The shopper's own newest message: what staff need to read to triage, since
  // the newest message overall is often the AI's handoff notice.
  customerMessage?: string;
  customerMessageAt?: string;
};

const conversationLimit = 50;
export const historyLimit = 50;

export async function listLiveConversations(): Promise<InboxConversation[]> {
  const db = createClient();
  const query = () => db.from("conversations")
    .select("id, mode, last_message_at, shoppers!inner(channel, display_name), messages(text), customer_message:messages(text, created_at)")
    .eq("customer_message.sender", "shopper")
    .order("last_message_at", { ascending: false })
    .order("id")
    .order("created_at", { referencedTable: "messages", ascending: false })
    .order("id", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" })
    .order("created_at", { referencedTable: "customer_message", ascending: false })
    .order("id", { referencedTable: "customer_message", ascending: false })
    .limit(1, { referencedTable: "customer_message" })
    .limit(conversationLimit);

  // Keep the queue in front even when the shop has many newer AI conversations.
  const urgent = await query().eq("mode", "needs_human");
  if (urgent.error) throw urgent.error;
  const remaining = conversationLimit - urgent.data.length;
  const other = remaining ? await query().neq("mode", "needs_human").limit(remaining) : null;
  if (other?.error) throw other.error;

  return [...urgent.data, ...(other?.data ?? [])].map((conversation) => ({
    id: conversation.id,
    customerName: conversation.shoppers.display_name?.trim() || "Khách hàng",
    channel: conversation.shoppers.channel,
    mode: conversation.mode,
    lastMessageAt: conversation.last_message_at,
    latestMessage: conversation.messages[0]?.text,
    customerMessage: conversation.customer_message[0]?.text || undefined,
    customerMessageAt: conversation.customer_message[0]?.created_at,
  }));
}

export async function listInboxMessages(conversationId: string): Promise<InboxMessage[]> {
  const { data, error } = await createClient().from("messages")
    .select("id, sender, text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(historyLimit);

  if (error) throw error;
  return data.reverse();
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
