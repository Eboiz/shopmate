import "server-only";
import { MAX_PHOTOS_PER_MESSAGE, type Channel, type HistoryMessage, type Reply } from "@/contract";
import { PHOTO_BUCKET, storeShopperPhoto } from "@/lib/chat/photo-store";
import { runEngine } from "@/lib/engine/run";
import { replyIfRateLimited } from "@/lib/guard/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PhotoSource } from "./photo-download";
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
  // May be empty when the message is only photos (PB-30).
  text: string;
  // PB-30: the message's photos, fetched only once the message is known to be
  // new; stored in the chat-photos bucket, never the channel's URL (A10).
  photos?: PhotoSource[];
  // The channel's own name for photos the server can't download (WhatsApp media
  // ids): kept in the stored text so staff know what came.
  photoRefs?: string[];
};

// Postgres unique_violation: web chat's (conversation_id, client_message_id) key.
const UNIQUE_VIOLATION = "23505";

export const HISTORY_LIMIT = 20;
export const HANDOFF_TEXT = "Cảm ơn bạn! Nhân viên shop sẽ trả lời bạn ngay.";
// Stored as the shopper's text when a message had only photos and none could be
// kept, so staff see that a photo came instead of an empty message.
export const PHOTO_NOT_KEPT_TEXT = "[Khách gửi ảnh, không lưu được ảnh]";
export const PHOTO_HANDOFF_TEXT = "Cảm ơn bạn! Nhân viên shop sẽ xem ảnh và trả lời bạn ngay.";

const notice = (text: string): Reply => ({ text, products: [], quickReplies: [] });

// One shopper message from any channel (web chat, Messenger, Telegram, ...):
// dedupe, store it, and let the AI answer while the conversation is in `ai` mode.
// Uses the secret key, so every query filters by the source's shop_id.
export async function receiveChannelMessage(
  account: MessageSource,
  incoming: IncomingMessage,
  onThinking?: () => Promise<void>,
): Promise<"duplicate" | "stored" | "rate_limited" | "answered" | "handed_off"> {
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

  // PB-30: a photo that can't be fetched or isn't JPEG/PNG/WebP is skipped; the
  // rest of the message still goes through.
  const sentPhotos = incoming.photos ?? [];
  const photoPaths: string[] = [];
  for (const photo of sentPhotos.slice(0, MAX_PHOTOS_PER_MESSAGE)) {
    try {
      const path = await storeShopperPhoto(db, { shopId: shop_id, conversationId: conversation.id, bytes: await photo() });
      if (path) photoPaths.push(path);
      else console.warn("shopper photo skipped: not a JPEG, PNG or WebP photo");
    } catch (error) {
      console.warn("shopper photo skipped", error);
    }
  }

  const photosLost = sentPhotos.length > 0 && photoPaths.length === 0 && incoming.text.trim() === "";
  const storedText = photosLost ? [PHOTO_NOT_KEPT_TEXT, ...(incoming.photoRefs ?? [])].join(" ") : incoming.text;
  const stored = await db.from("messages").insert({
    shop_id,
    conversation_id: conversation.id,
    sender: "shopper",
    text: storedText,
    photo_paths: photoPaths,
    client_message_id: account.channel === "web" ? incoming.messageId : null,
  });
  // Web chat: the browser retried a message that is already stored.
  if (account.channel === "web" && stored.error?.code === UNIQUE_VIOLATION) {
    if (photoPaths.length > 0) {
      const removed = await db.storage.from(PHOTO_BUCKET).remove(photoPaths);
      if (removed.error) console.warn("duplicate message: photos not removed", removed.error.message);
    }
    return "duplicate";
  }
  must(stored, "message");
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

  // Nothing the AI can read: only photos, and none of them could be kept.
  if (photosLost) {
    return handOff(notice(PHOTO_HANDOFF_TEXT));
  }

  const [, historyRead] = await Promise.all([
    onThinking?.().catch((error) => console.warn("typing indicator failed", error)),
    db
      .from("messages")
      .select("sender, text, photo_paths")
      .eq("shop_id", shop_id)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  const recent = must(historyRead, "history");
  const history: HistoryMessage[] = recent
    .reverse()
    .map(({ sender, text, photo_paths }) => ({ sender, text, ...(photo_paths?.length ? { photoPaths: photo_paths } : {}) }));

  let reply: Reply;
  try {
    ({ reply } = await runEngine({
      mode: "customer",
      conversationId: conversation.id,
      history,
      productId: incoming.productId ?? null,
    }));
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
  // If the conversation was already waiting for staff before this turn, don't repeat the handoff notice.
  if (initialMode === "needs_human") return "stored";
  await sendSystem(conversation.id, reply);
  return "handed_off";
}

async function sendSystem(conversationId: string, reply: Reply) {
  const sent = await sendToConversation(conversationId, reply, { from: "system" });
  if (!sent.ok) console.error("system message not delivered", sent.error);
}
