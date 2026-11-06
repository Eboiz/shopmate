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

type Base = { pageId: string; senderId: string; mid: string };
export type MessengerEvent =
  | (Base & { type: "text"; text: string })
  | (Base & { type: "image"; imageUrls: string[] })
  | (Base & { type: "sticker" });

type Attachment = { type?: string; payload?: { url?: string; sticker_id?: unknown } };
type Messaging = {
  sender?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; sticker_id?: unknown; attachments?: Attachment[] };
};

// Shopper messages only. Echoes of the Page's own sends, deliveries, reads and
// postbacks are skipped. A tapped quick reply arrives as text (the button title).
export function parseMessengerEvents(body: unknown): MessengerEvent[] {
  const entries = (body as { entry?: { id?: string; messaging?: Messaging[] }[] })?.entry ?? [];
  const events: MessengerEvent[] = [];
  for (const entry of entries) {
    for (const item of entry.messaging ?? []) {
      const message = item.message;
      const senderId = item.sender?.id;
      if (!entry.id || !senderId || !message?.mid || message.is_echo) continue;
      const base = { pageId: entry.id, senderId, mid: message.mid };
      const attachments = message.attachments ?? [];
      if (message.text) events.push({ ...base, type: "text", text: message.text });
      else if (message.sticker_id || attachments.some((a) => a.payload?.sticker_id)) events.push({ ...base, type: "sticker" });
      else {
        const imageUrls = attachments.flatMap((a) => (a.type === "image" && a.payload?.url ? [a.payload.url] : []));
        if (imageUrls.length) events.push({ ...base, type: "image", imageUrls });
        else console.info(`messenger: unsupported message ${message.mid} ignored`);
      }
    }
  }
  return events;
}

// Graph API version, fixed so behavior doesn't change with the app's default.
const SEND_API = "https://graph.facebook.com/v24.0/me/messages";
const MAX_CARD_TEXT = 80;
const cut = (s: string) => (s.length > MAX_CARD_TEXT ? `${s.slice(0, MAX_CARD_TEXT - 1)}…` : s);

// Design A (PB-15): text, then one carousel of product cards, with the quick
// replies on the last message. Card price and sizes come from the card data.
export function toMessengerMessages(reply: Reply): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  if (reply.text) messages.push({ text: reply.text });
  if (reply.products.length > 0) {
    messages.push({
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: reply.products.map((p) => ({
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
    last.quick_replies = reply.quickReplies.map((q) => ({ content_type: "text", title: q, payload: q }));
  }
  return messages;
}

async function callSendApi(token: string, body: unknown, fetchFn: typeof fetch) {
  const response = await fetchFn(SEND_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(`messenger_send_failed: ${response.status} ${detail?.error?.message ?? ""}`.trim());
}

// The Messenger channel adapter: sends each message in order, with the Page's token.
export async function sendMessenger(target: DeliveryTarget, reply: Reply, fetchFn: typeof fetch = fetch) {
  const token = target.channelAccount?.accessToken;
  if (!token) throw new Error("messenger_send_failed: no Page account");
  for (const message of toMessengerMessages(reply)) {
    await callSendApi(token, { recipient: { id: target.externalId }, messaging_type: "RESPONSE", message }, fetchFn);
  }
}

// "Typing…" until the next message is sent (or about 20 seconds).
export function sendTypingOn(token: string, psid: string, fetchFn: typeof fetch = fetch) {
  return callSendApi(token, { recipient: { id: psid }, sender_action: "typing_on" }, fetchFn);
}
