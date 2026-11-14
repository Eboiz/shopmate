import { createHmac, timingSafeEqual } from "node:crypto";
import type { Reply } from "@/contract";
import { formatPrice, formatSizesInStock } from "@/lib/format";
import type { DeliveryTarget } from "./adapters";

// Messenger Platform (PB-15): webhook signature, payload parsing and the Send API.
// https://developers.facebook.com/docs/messenger-platform/webhooks

// Meta signs the raw body with the app secret. Hash the bytes as received:
// re-encoding parsed JSON changes the \u escapes Meta uses, so the hash differs.
export function verifyMessengerSignature(body: Uint8Array, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The Messenger Platform also carries Instagram Direct (PB-23): the same messaging
// events, with the Instagram professional account ID as the entry id. accountId is
// the Page ID on Messenger and that account ID on Instagram.
type Base = { accountId: string; senderId: string; mid: string };
export type MessagingEvent =
  | (Base & { type: "text"; text: string })
  | (Base & { type: "image"; imageUrls: string[] })
  | (Base & { type: "sticker" });
export type MessengerEvent = MessagingEvent;

type Attachment = { type?: string; payload?: { url?: string; sticker_id?: unknown } };
type Messaging = {
  sender?: { id?: string };
  timestamp?: number;
  postback?: { mid?: string; payload?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    sticker_id?: unknown;
    attachments?: Attachment[];
    quick_reply?: { payload?: string };
  };
};

// The "Chọn size" button on a product card (PB-22) is a postback whose payload is
// the shopper text it stands for, e.g. "Chọn size Đầm suông linen". Only postbacks
// starting with this are read; other postbacks (Get Started…) are skipped.
export const CHOOSE_SIZE = "Chọn size";
const isChooseSize = (payload?: string): payload is string => !!payload?.startsWith(`${CHOOSE_SIZE} `);

// Shopper messages only. Echoes of the account's own sends, deliveries, reads,
// reactions, other postbacks and unsent messages are skipped. A tapped quick reply
// is read from its payload, which holds the full quick reply text (the title may be
// cut); so is a tapped "Chọn size" card button.
export function parseMessagingEvents(body: unknown, label: string): MessagingEvent[] {
  const entries = (body as { entry?: { id?: string; messaging?: Messaging[] }[] })?.entry ?? [];
  const events: MessagingEvent[] = [];
  for (const entry of entries) {
    for (const item of entry.messaging ?? []) {
      const message = item.message;
      const senderId = item.sender?.id;
      const postback = item.postback;
      if (entry.id && senderId && isChooseSize(postback?.payload)) {
        // Meta gives the postback a mid; the fallback id still dedupes a resent delivery.
        const mid = postback.mid ?? `postback:${senderId}:${item.timestamp ?? postback.payload}`;
        events.push({ accountId: entry.id, senderId, mid, type: "text", text: postback.payload });
        continue;
      }
      if (!entry.id || !senderId || !message?.mid || message.is_echo || message.is_deleted) continue;
      const base = { accountId: entry.id, senderId, mid: message.mid };
      const attachments = message.attachments ?? [];
      const text = message.quick_reply?.payload || message.text;
      if (text) events.push({ ...base, type: "text", text });
      else if (message.sticker_id || attachments.some((a) => a.payload?.sticker_id)) events.push({ ...base, type: "sticker" });
      else {
        const imageUrls = attachments.flatMap((a) => (a.type === "image" && a.payload?.url ? [a.payload.url] : []));
        if (imageUrls.length) events.push({ ...base, type: "image", imageUrls });
        else console.info(`${label}: unsupported message ${message.mid} ignored`);
      }
    }
  }
  return events;
}

export function parseMessengerEvents(body: unknown): MessengerEvent[] {
  return parseMessagingEvents(body, "messenger");
}

// Graph API version, fixed so behavior doesn't change with the app's default.
const SEND_API = "https://graph.facebook.com/v24.0/me/messages";
const MAX_CARD_TEXT = 80;
// Messenger and Instagram: 10 cards per carousel, 13 quick replies of 20 characters.
// The shared reply (PB-00) already stays within these; the cuts only guard them.
const MAX_CARDS = 10;
const MAX_QUICK_REPLIES = 13;
const MAX_QUICK_REPLY_TITLE = 20;
const cut = (s: string, max = MAX_CARD_TEXT) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// Design A (PB-15): text, then one carousel of product cards, with the quick
// replies on the last message. Card price and sizes come from the card data.
// textParts splits a text the channel can't send in one message (Instagram).
export function toMessengerMessages(
  reply: Reply,
  textParts: (text: string) => string[] = (text) => [text],
): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  if (reply.text) for (const text of textParts(reply.text)) messages.push({ text });
  if (reply.products.length > 0) {
    messages.push({
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: reply.products.slice(0, MAX_CARDS).map((p) => ({
            title: cut(p.name),
            subtitle: cut(`${formatPrice(p.price)} · ${formatSizesInStock(p.sizesInStock)}`),
            ...(p.imageUrl ? { image_url: p.imageUrl } : {}),
            // PB-22: a sold-out card has no size to choose, so no button.
            ...(p.sizesInStock.length > 0
              ? { buttons: [{ type: "postback", title: CHOOSE_SIZE, payload: `${CHOOSE_SIZE} ${p.name}` }] }
              : {}),
          })),
        },
      },
    });
  }
  addQuickReplies(messages, reply.quickReplies);
  return messages;
}

function addQuickReplies(messages: Record<string, unknown>[], quickReplies: string[]) {
  const last = messages.at(-1);
  if (last && quickReplies.length > 0) {
    last.quick_replies = quickReplies
      .slice(0, MAX_QUICK_REPLIES)
      .map((q) => ({ content_type: "text", title: cut(q, MAX_QUICK_REPLY_TITLE), payload: q }));
  }
}

const isCarousel = (message: Record<string, unknown>) =>
  (message.attachment as { type?: string } | undefined)?.type === "template";

// PB-22: when the carousel is refused, the products go as text and photo instead:
// each card's photo, then its caption (name, price, sizes in stock), with the
// quick replies on the last message. A photo can't carry a caption on Messenger.
export function toProductFallbackMessages(reply: Reply): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const p of reply.products.slice(0, MAX_CARDS)) {
    if (p.imageUrl) messages.push({ attachment: { type: "image", payload: { url: p.imageUrl } } });
    messages.push({ text: `${p.name}
${formatPrice(p.price)} · ${formatSizesInStock(p.sizesInStock)}` });
  }
  addQuickReplies(messages, reply.quickReplies);
  return messages;
}

// label names the channel in errors ("messenger_send_failed", "instagram_send_failed").
async function callSendApi(token: string, body: unknown, fetchFn: typeof fetch, label: string) {
  const response = await fetchFn(SEND_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(`${label}_send_failed: ${response.status} ${detail?.error?.message ?? ""}`.trim());
}

// Sends each message in order to the Send API with the Page's token (on Instagram,
// the token of the Page the account is linked to).
export async function sendMessagingMessages(
  label: string,
  target: DeliveryTarget,
  messages: Record<string, unknown>[],
  fetchFn: typeof fetch,
) {
  const token = target.channelAccount?.accessToken;
  if (!token) throw new Error(`${label}_send_failed: no ${label === "messenger" ? "Page" : "Instagram"} account`);
  for (const message of messages) {
    await callSendApi(token, { recipient: { id: target.externalId }, messaging_type: "RESPONSE", message }, fetchFn, label);
  }
}

// Sends a reply built by toMessengerMessages. If the Send API refuses the
// carousel, the products are sent as text and photo instead (PB-22); a refused
// text, or a refused fallback, still throws.
export async function sendMessagingReply(
  label: string,
  target: DeliveryTarget,
  reply: Reply,
  messages: Record<string, unknown>[],
  fetchFn: typeof fetch,
) {
  for (const message of messages) {
    if (!isCarousel(message)) {
      await sendMessagingMessages(label, target, [message], fetchFn);
      continue;
    }
    try {
      await sendMessagingMessages(label, target, [message], fetchFn);
    } catch (error) {
      // The error holds Meta's status and message, never the token.
      console.warn(`${label}: carousel refused, sending text and photos instead`, (error as Error).message);
      await sendMessagingMessages(label, target, toProductFallbackMessages(reply), fetchFn);
    }
  }
}

// The Messenger channel adapter.
export async function sendMessenger(target: DeliveryTarget, reply: Reply, fetchFn: typeof fetch = fetch) {
  await sendMessagingReply("messenger", target, reply, toMessengerMessages(reply), fetchFn);
}

// "Typing…" until the next message is sent (or about 20 seconds). Instagram takes
// the same call, with the shopper's Instagram-scoped id.
export function sendTypingOn(token: string, recipientId: string, fetchFn: typeof fetch = fetch, label = "messenger") {
  return callSendApi(token, { recipient: { id: recipientId }, sender_action: "typing_on" }, fetchFn, label);
}
