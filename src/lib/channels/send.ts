import "server-only";
import { replySchema, type Reply } from "@/contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { adapters } from "./adapters";

// ai: an AI reply, sent only while the conversation is in `ai` mode.
// system: order updates (PB-12) and the "staff will reply" notice after a handoff,
// sent in any mode.
// staff: a staff reply (PB-13).
export type Sender = { from: "ai" } | { from: "system" } | { from: "staff"; staffId: string };

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; messageId: string | null; error: string };

// Sends a reply to the channel the shopper is on (PB-00). PB-11, PB-12 and PB-13
// only call this; each channel story implements its adapter.
//
// The message is stored first, so the inbox shows it even when the channel
// refuses it (for example Messenger outside its 24-hour window); that failure is
// returned, not thrown. A reply that doesn't match the shared shape is a bug in
// the caller and throws.
export async function sendToConversation(
  conversationId: string,
  reply: Reply,
  sender: Sender,
): Promise<SendResult> {
  const message = replySchema.parse(reply);
  const db = createAdminClient();

  const { data: conversation, error: readError } = await db
    .from("conversations")
    .select(
      "id, shop_id, shoppers!inner(channel, external_id, channel_accounts(id, external_account_id, access_token))",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (readError) return { ok: false, messageId: null, error: readError.message };
  if (!conversation) return { ok: false, messageId: null, error: "conversation_not_found" };

  // Bump last_message_at (inbox order). For an AI reply this is also the mode
  // check, in one statement: if staff took over or the AI handed off while the
  // reply was being written, no row matches and nothing is sent.
  let bump = db
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id)
    .eq("shop_id", conversation.shop_id);
  if (sender.from === "ai") bump = bump.eq("mode", "ai");
  const { data: bumped, error: bumpError } = await bump.select("id").maybeSingle();
  if (bumpError) return { ok: false, messageId: null, error: bumpError.message };
  if (!bumped) return { ok: false, messageId: null, error: "not_in_ai_mode" };

  const { data: stored, error: insertError } = await db
    .from("messages")
    .insert({
      shop_id: conversation.shop_id,
      conversation_id: conversation.id,
      sender: sender.from,
      staff_id: sender.from === "staff" ? sender.staffId : null,
      text: message.text,
      reply: message,
    })
    .select("id")
    .single();
  if (insertError) return { ok: false, messageId: null, error: insertError.message };

  const shopper = conversation.shoppers;
  const account = shopper.channel_accounts;
  try {
    await adapters[shopper.channel](
      {
        channel: shopper.channel,
        externalId: shopper.external_id,
        channelAccount: account
          ? {
              id: account.id,
              externalAccountId: account.external_account_id,
              accessToken: account.access_token,
            }
          : null,
      },
      message,
    );
  } catch (error) {
    return {
      ok: false,
      messageId: stored.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true, messageId: stored.id };
}
