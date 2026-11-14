import type { Reply } from "@/contract";
import type { DeliveryTarget } from "./adapters";
import { parseMessagingEvents, sendMessagingReply, toMessengerMessages, type MessagingEvent } from "./messenger";

// Instagram Direct (PB-23) through the Messenger API for Instagram. Deliveries come
// on the same Meta webhook as Messenger (object = "instagram"), signed with the same
// app secret, in the same messaging event shape: the entry id is the shop's
// Instagram professional account ID and the sender id is the shopper's
// Instagram-scoped id (IGSID).
// https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook
//
// Sending uses the Messenger Send API, POST /me/messages, with the access token of
// the Facebook Page the Instagram account is linked to: with a Page token, "me" is
// that Page, and Meta delivers to the IGSID on Instagram. So the call is the one
// Messenger already makes; only the token's Page decides the channel.
// https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message

export type InstagramEvent = MessagingEvent;

export function parseInstagramEvents(body: unknown): InstagramEvent[] {
  return parseMessagingEvents(body, "instagram");
}

// Instagram refuses a text message over 1000 bytes of UTF-8. Vietnamese letters
// with diacritics take 2 or 3 bytes, so a 1000-character reply can be too long.
export const MAX_TEXT_BYTES = 1000;
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

// Splits a text into parts of at most maxBytes, at the last space or line break
// that fits, or mid-word (never inside a character) when a word alone is too long.
export function splitUtf8(text: string, maxBytes = MAX_TEXT_BYTES): string[] {
  const parts: string[] = [];
  let rest = text;
  while (bytes(rest) > maxBytes) {
    let end = 0;
    let used = 0;
    let lastBreak = -1;
    for (const char of rest) {
      const size = bytes(char);
      if (used + size > maxBytes) break;
      used += size;
      end += char.length;
      if (/\s/.test(char)) lastBreak = end;
    }
    const cutAt = lastBreak > 0 ? lastBreak : end;
    const part = rest.slice(0, cutAt).trimEnd();
    if (part) parts.push(part);
    rest = rest.slice(cutAt).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Design A, as on Messenger: text, then one carousel of product cards (generic
// template, up to 10), with the quick replies (up to 13, titles of 20 characters)
// on the last message. Each in-stock card has the same "Chọn size" postback button
// (PB-22), and a refused carousel falls back to text and photos, as on Messenger.
// Only the text is split for Instagram's byte limit.
export function toInstagramMessages(reply: Reply): Record<string, unknown>[] {
  return toMessengerMessages(reply, (text) => splitUtf8(text));
}

// The Instagram channel adapter: the shopper's IGSID is the target's external id,
// and the channel account's token is the linked Page's token.
export async function sendInstagram(target: DeliveryTarget, reply: Reply, fetchFn: typeof fetch = fetch) {
  await sendMessagingReply("instagram", target, reply, toInstagramMessages(reply), fetchFn);
}
