import "server-only";
import type { Channel, HistoryMessage, Reply } from "@/contract";
import { runEngine } from "@/lib/engine/run";
import type { Db } from "@/lib/engine/types";
import { replyIfRateLimited } from "@/lib/guard/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToConversation } from "./send";

// The shop's account on a channel, already looked up by the webhook
// (Messenger by Page ID, Telegram by the id in its webhook URL).
export type ChannelAccountRef = { id: string; shopId: string; channel: Exclude<Channel, "web"> };
// Web chat (PB-04) has no channel account: the route resolved the shop from the slug.
export type WebChatRef = { channel: "web"; shopId: string };
export type MessageSource = ChannelAccountRef | WebChatRef;

export type IncomingMessage = {
  // The shopper's id on the channel, and the channel's id for this message
  // (web chat: the hashed cookie id and the browser's clientMessageId).
  externalId: string;
  messageId: string;
  // The product the shopper tapped "Hỏi về món này" on (web chat), already
  // checked by the route to belong to the shop.
  productId?: string | null;
} & ({ text: string } | { imageUrls: string[] });

// Postgres unique_violation: web chat's (conversation_id, client_message_id) key.
const UNIQUE_VIOLATION = "23505";

export const HISTORY_LIMIT = 20;
export const HANDOFF_TEXT = "Cảm ơn bạn! Nhân viên shop sẽ trả lời bạn ngay.";
export const PHOTO_HANDOFF_TEXT = "Cảm ơn bạn! Nhân viên shop sẽ xem ảnh và trả lời bạn ngay.";

const notice = (text: string): Reply => ({ text, products: [], quickReplies: [] });

// One shopper message from any channel (web chat, Messenger, Telegram, ...):
// dedupe, store it, and let the AI answer while the conversation is in `ai` mode.
// Uses the secret key, so every query filters by the source's shop_id.
export async function receiveChannelMessage(
  account: MessageSource,
  incoming: IncomingMessage,
  onThinking?: () => Promise<void>,
): Promise<"duplicate" | "stored" | "rate_limited" | "answered" | "handed_off" | "superseded"> {
  const db = createAdminClient();
  const shop_id = account.shopId;
  const must = <T>(result: { data: T; error: { message: string } | null }, what: string) => {
    if (result.error) throw new Error(`${what}: ${result.error.message}`);
    // Reads here use .single() or return a list, so no error means data is there.
    return result.data as NonNullable<T>;
  };

  // A channel delivers a message again when we answer late; only the first counts.
  // Web chat has no channel account: it dedupes on the message row itself below.
  if (account.channel !== "web") {
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
  }

  // Find or create the shopper and their one conversation. ignoreDuplicates leaves
  // an existing row untouched, so a conversation staff took over stays `staff`.
  const shopperKey = { shop_id, channel: account.channel, external_id: incoming.externalId };
  must(
    await db
      .from("shoppers")
      .upsert({ ...shopperKey, channel_account_id: account.channel === "web" ? null : account.id }, { onConflict: "shop_id,channel,external_id", ignoreDuplicates: true }),
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
  const initialMode = conversation.mode;

  const text = "text" in incoming ? incoming.text : `[Khách gửi ảnh] ${incoming.imageUrls.join(" ")}`;
  const stored = await db.from("messages").insert({
    shop_id,
    conversation_id: conversation.id,
    sender: "shopper",
    text,
    client_message_id: account.channel === "web" ? incoming.messageId : null,
  }).select("id").single();
  // Web chat: the browser retried a message that is already stored.
  if (account.channel === "web" && stored.error?.code === UNIQUE_VIOLATION) return "duplicate";
  const storedMessage = must(stored, "message");
  // A new shopper message also moves the conversation to the top of the inbox, in every mode.
  must(
    await db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id)
      .eq("shop_id", shop_id),
    "bump",
  );

  if (initialMode === "staff") return "stored";

  // PB-17: more than 10 messages in a minute get a "please wait" reply and no AI
  // turn. Counted after storing, so this message is included.
  if (await replyIfRateLimited({ shopId: shop_id, conversationId: conversation.id })) {
    return "rate_limited";
  }

  // Only the turn that actually switches the mode tells the shopper: two messages
  // arriving together must not send the notice twice.
  const handOff = async (reply: Reply) => {
    const switched = must(
      await db
        .from("conversations")
        .update({ mode: "needs_human" })
        .eq("id", conversation.id)
        .eq("shop_id", shop_id)
        .eq("mode", "ai")
        .select("id"),
      "handoff",
    );
    if (switched.length === 0) return "stored" as const;
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
    ({ reply } = await runEngine({
      mode: "customer",
      conversationId: conversation.id,
      messageId: storedMessage.id,
      history,
      productId: incoming.productId ?? null,
    }));
  } catch (error) {
    console.error("engine failed, handing off", error);
    return handOff(notice(HANDOFF_TEXT));
  }

  // R3: the shopper sent another message while this turn ran. That message's turn
  // reads both and answers; this one sends nothing, so the shopper gets one reply.
  // Side effects of this turn (a handoff) stay. Exception: when this turn moved
  // the conversation from ai to needs_human, its closing message is still sent
  // (below), because the newer turn then starts in needs_human and stays silent.
  if (await newerShopperMessageExists(db, { shopId: shop_id, conversationId: conversation.id, messageId: storedMessage.id })) {
    const current = must(
      await db.from("conversations").select("mode").eq("id", conversation.id).eq("shop_id", shop_id).single(),
      "mode read",
    );
    if (!(initialMode === "ai" && current.mode === "needs_human")) return "superseded";
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
  // If the conversation was already waiting for staff before this turn, don't repeat the handoff notice.
  if (initialMode === "needs_human") return "stored";
  await sendSystem(conversation.id, reply);
  return "handed_off";
}

// True when the conversation's latest shopper message is not this one. One
// query: the newest shopper message, compared by id.
export async function newerShopperMessageExists(
  db: Db,
  args: { shopId: string; conversationId: string; messageId: string },
): Promise<boolean> {
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("shop_id", args.shopId)
    .eq("conversation_id", args.conversationId)
    .eq("sender", "shopper")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw new Error(`newest message: ${error.message}`);
  return (data[0]?.id ?? args.messageId) !== args.messageId;
}

async function sendSystem(conversationId: string, reply: Reply) {
  const sent = await sendToConversation(conversationId, reply, { from: "system" });
  if (!sent.ok) console.error("system message not delivered", sent.error);
}
