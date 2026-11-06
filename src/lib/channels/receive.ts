import "server-only";
import type { Channel, HistoryMessage, Reply } from "@/contract";
import { runEngine } from "@/lib/engine/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToConversation } from "./send";

// The shop's account on a channel, already looked up by the webhook
// (Messenger by Page ID, Telegram by the id in its webhook URL).
export type ChannelAccountRef = { id: string; shopId: string; channel: Exclude<Channel, "web"> };

export type IncomingMessage = {
  // The shopper's id on the channel, and the channel's id for this message.
  externalId: string;
  messageId: string;
} & ({ text: string } | { imageUrls: string[] });

export const HISTORY_LIMIT = 20;
export const HANDOFF_TEXT = "Cảm ơn bạn! Nhân viên shop sẽ trả lời bạn ngay.";
export const PHOTO_HANDOFF_TEXT = "Cảm ơn bạn! Nhân viên shop sẽ xem ảnh và trả lời bạn ngay.";

const notice = (text: string): Reply => ({ text, products: [], quickReplies: [] });

// One shopper message from an external channel (Messenger, Telegram, ...):
// dedupe, store it, and let the AI answer while the conversation is in `ai` mode.
// Uses the secret key, so every query filters by the account's shop_id.
export async function receiveChannelMessage(
  account: ChannelAccountRef,
  incoming: IncomingMessage,
  onThinking?: () => Promise<void>,
): Promise<"duplicate" | "stored" | "answered" | "handed_off"> {
  const db = createAdminClient();
  const shop_id = account.shopId;
  const must = <T>(result: { data: T; error: { message: string } | null }, what: string) => {
    if (result.error) throw new Error(`${what}: ${result.error.message}`);
    // Reads here use .single() or return a list, so no error means data is there.
    return result.data as NonNullable<T>;
  };

  // A channel delivers a message again when we answer late; only the first counts.
  const firstTime = must(
    await db
      .from("channel_events")
      .upsert(
        { channel_account_id: account.id, external_message_id: incoming.messageId, shop_id },
        { onConflict: "channel_account_id,external_message_id", ignoreDuplicates: true },
      )
      .select("external_message_id"),
    "dedupe",
  );
  if (firstTime.length === 0) return "duplicate";

  // Find or create the shopper and their one conversation. ignoreDuplicates leaves
  // an existing row untouched, so a conversation staff took over stays `staff`.
  const shopperKey = { shop_id, channel: account.channel, external_id: incoming.externalId };
  must(
    await db
      .from("shoppers")
      .upsert({ ...shopperKey, channel_account_id: account.id }, { onConflict: "shop_id,channel,external_id", ignoreDuplicates: true }),
    "shopper",
  );
  const shopper = must(
    await db.from("shoppers").select("id").match(shopperKey).single(),
    "shopper read",
  );
  must(
    await db.from("conversations").upsert({ shop_id, shopper_id: shopper.id }, { onConflict: "shopper_id", ignoreDuplicates: true }),
    "conversation",
  );
  const conversation = must(
    await db.from("conversations").select("id, mode").eq("shop_id", shop_id).eq("shopper_id", shopper.id).single(),
    "conversation read",
  );

  const text = "text" in incoming ? incoming.text : `[Khách gửi ảnh] ${incoming.imageUrls.join(" ")}`;
  // A new shopper message also moves the conversation to the top of the inbox, in every mode.
  const [stored, bumped] = await Promise.all([
    db.from("messages").insert({ shop_id, conversation_id: conversation.id, sender: "shopper", text }),
    db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id)
      .eq("shop_id", shop_id),
  ]);
  must(stored, "message");
  must(bumped, "bump");

  if (conversation.mode !== "ai") return "stored";

  const handOff = async (reply: Reply) => {
    must(
      await db
        .from("conversations")
        .update({ mode: "needs_human" })
        .eq("id", conversation.id)
        .eq("shop_id", shop_id)
        .eq("mode", "ai"),
      "handoff",
    );
    await sendSystem(conversation.id, reply);
    return "handed_off" as const;
  };

  // The AI reads text only: a photo goes to staff.
  if (!("text" in incoming)) return handOff(notice(PHOTO_HANDOFF_TEXT));

  const [, historyRead] = await Promise.all([
    onThinking?.().catch((error) => console.warn("typing indicator failed", error)),
    db
      .from("messages")
      .select("sender, text")
      .eq("shop_id", shop_id)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  const recent = must(historyRead, "history");
  const history: HistoryMessage[] = recent.reverse().map(({ sender, text }) => ({ sender, text }));

  let reply: Reply;
  try {
    ({ reply } = await runEngine({ mode: "customer", conversationId: conversation.id, history }));
  } catch (error) {
    console.error("engine failed, handing off", error);
    return handOff(notice(HANDOFF_TEXT));
  }

  const sent = await sendToConversation(conversation.id, reply, { from: "ai" });
  if (sent.ok) return "answered";
  if (sent.error !== "not_in_ai_mode") {
    console.error("reply not delivered", sent.error);
    return "answered";
  }
  // The mode changed during this turn. If the engine itself handed off (size out of
  // range, complaint, ...), its reply is the closing message: send it as a system
  // message. If staff took over, they answer instead.
  const now = must(
    await db.from("conversations").select("mode").eq("id", conversation.id).eq("shop_id", shop_id).single(),
    "mode read",
  );
  if (now.mode !== "needs_human") return "stored";
  await sendSystem(conversation.id, reply);
  return "handed_off";
}

async function sendSystem(conversationId: string, reply: Reply) {
  const sent = await sendToConversation(conversationId, reply, { from: "system" });
  if (!sent.ok) console.error("system message not delivered", sent.error);
}
