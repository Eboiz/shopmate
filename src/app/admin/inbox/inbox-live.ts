import { createClient } from "@/lib/supabase/client";
import type { InboxConversation } from "./inbox-data";

export async function listLiveConversations(): Promise<InboxConversation[]> {
  const { data, error } = await createClient()
    .from("conversations")
    .select("id, mode, last_message_at, shoppers!inner(channel, display_name), messages(id, sender, text, created_at)")
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages" })
    .order("id", { referencedTable: "messages" });

  if (error) throw error;

  return data.map((conversation) => ({
    id: conversation.id,
    customerName: conversation.shoppers.display_name?.trim() || "Khách hàng",
    channel: conversation.shoppers.channel,
    mode: conversation.mode,
    lastMessageAt: conversation.last_message_at,
    messages: conversation.messages.map(({ id, sender, text, created_at }) => ({
      id,
      sender,
      text,
      createdAt: created_at,
    })),
  }));
}
