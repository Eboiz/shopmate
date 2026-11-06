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

// Meta escapes non-ASCII as \uXXXX and signs those exact bytes.
export function messengerBody(items: MessengerItem[], pageId = channelSecrets.messengerPageId) {
  return JSON.stringify({ object: "page", entry: [{ id: pageId, time: Date.now(), messaging: items }] }).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
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
