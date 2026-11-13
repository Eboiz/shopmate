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

// Shopper messages only. Echoes of the account's own sends, deliveries, reads,
// reactions, postbacks and unsent messages are skipped. A tapped quick reply is
// read from its payload, which holds the full quick reply text (the title may be cut).
export function parseMessagingEvents(body: unknown, label: string): MessagingEvent[] {
  const entries = (body as { entry?: { id?: string; messaging?: Messaging[] }[] })?.entry ?? [];
  const events: MessagingEvent[] = [];
  for (const entry of entries) {
    for (const item of entry.messaging ?? []) {
      const message = item.message;
      const senderId = item.sender?.id;
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
          })),
        },
      },
    });
  }
  const last = messages.at(-1);
  if (last && reply.quickReplies.length > 0) {
    last.quick_replies = reply.quickReplies
      .slice(0, MAX_QUICK_REPLIES)
      .map((q) => ({ content_type: "text", title: cut(q, MAX_QUICK_REPLY_TITLE), payload: q }));
  }
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

// The Messenger channel adapter.
export async function sendMessenger(target: DeliveryTarget, reply: Reply, fetchFn: typeof fetch = fetch) {
  await sendMessagingMessages("messenger", target, toMessengerMessages(reply), fetchFn);
}

// "Typing…" until the next message is sent (or about 20 seconds). Instagram takes
// the same call, with the shopper's Instagram-scoped id.
export function sendTypingOn(token: string, recipientId: string, fetchFn: typeof fetch = fetch, label = "messenger") {
  return callSendApi(token, { recipient: { id: recipientId }, sender_action: "typing_on" }, fetchFn, label);
}
