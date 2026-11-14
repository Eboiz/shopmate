import { createHmac } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { channelSecrets } from "./env";

// Builds webhook deliveries the way Meta and Telegram send them.

type MessengerItem = Record<string, unknown>;

export const messengerText = (psid: string, mid: string, text: string): MessengerItem => ({
  sender: { id: psid },
  recipient: { id: channelSecrets.messengerPageId },
  timestamp: Date.now(),
  message: { mid, text },
});

// Meta escapes non-ASCII as \uXXXX and signs those exact bytes. The same
// "messaging" shape carries Messenger (object=page) and Instagram Direct
// (object=instagram, PB-23): only the `object` field and the entry id change.
export function messengerBody(items: MessengerItem[], pageId = channelSecrets.messengerPageId, object: "page" | "instagram" = "page") {
  return JSON.stringify({ object, entry: [{ id: pageId, time: Date.now(), messaging: items }] }).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

// A WhatsApp Cloud API delivery (PB-27), also on the shared Meta webhook: one
// change per business phone number, the shopper's messages under value.messages.
// Built as a plain JSON string (no \u escapes) and signed over its exact bytes,
// so postMessenger() can sign and send it just like a page delivery. The app's
// parser only reads metadata.phone_number_id and messages[], but the plan keeps
// Meta's full shape (waba id, contacts, per-message id) for fidelity.
type WaMessage = Record<string, unknown>;
export function whatsappBody(
  phoneNumberId: string,
  messages: WaMessage[],
  options: { waId?: string; displayNumber?: string; waba?: string } = {},
): string {
  const waId = options.waId ?? messages.find((m) => typeof (m as { from?: unknown }).from === "string")?.from;
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: options.waba ?? "waba-e2e",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: options.displayNumber ?? "15550001111", phone_number_id: phoneNumberId },
          ...(waId ? { contacts: [{ profile: { name: "E2E" }, wa_id: waId }] } : {}),
          messages,
        },
      }],
    }],
  });
}

export const signMessenger = (body: string, secret = channelSecrets.metaAppSecret) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

export function postMessenger(request: APIRequestContext, body: string, signature: string | null = signMessenger(body)) {
  return request.post("/api/webhooks/messenger", {
    // Raw bytes: the signature covers exactly what is sent.
    data: Buffer.from(body),
    headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
  });
}

let nextUpdateId = Math.floor(Date.now() / 1000);

export function telegramUpdate(chatId: number, message: Record<string, unknown>, updateId = nextUpdateId++) {
  return {
    update_id: updateId,
    message: { message_id: updateId, from: { id: chatId, is_bot: false, first_name: "E2E" }, chat: { id: chatId, type: "private" }, date: 1, ...message },
  };
}

export function postTelegram(
  request: APIRequestContext,
  accountId: string,
  update: unknown,
  secret: string | null = channelSecrets.telegramWebhookSecret,
) {
  return request.post(`/api/webhooks/telegram/${accountId}`, {
    data: update,
    headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
  });
}

// A chat id no real Telegram user has, unique per test.
export const fakeChatId = () => 9_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
