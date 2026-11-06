import { timingSafeEqual } from "node:crypto";
import type { Reply } from "@/contract";
import { formatPrice, formatSizesInStock } from "@/lib/format";
import type { DeliveryTarget } from "./adapters";

// Telegram Bot API (PB-21): webhook secret, update parsing and sending.
// https://core.telegram.org/bots/api

// setWebhook's secret_token comes back in X-Telegram-Bot-Api-Secret-Token.
export function verifyTelegramSecret(header: string | null, secret: string) {
  if (!header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Base = { updateId: string; chatId: string };
export type TelegramEvent =
  | (Base & { type: "text"; text: string })
  | (Base & { type: "command"; command: string })
  | (Base & { type: "image"; fileId: string })
  | (Base & { type: "sticker" });

type Update = {
  update_id?: number;
  message?: {
    from?: { is_bot?: boolean };
    chat?: { id?: number; type?: string };
    text?: string;
    photo?: { file_id: string }[];
    sticker?: unknown;
  };
};

// Shopper messages in a private chat only. Edits, groups, channels and other bots
// are skipped, as are messages the shop can't use (voice, files, locations).
export function parseTelegramUpdate(body: unknown): TelegramEvent | null {
  const { update_id, message } = (body ?? {}) as Update;
  const chatId = message?.chat?.id;
  if (update_id === undefined || chatId === undefined || message?.chat?.type !== "private" || message.from?.is_bot) {
    return null;
  }
  const base = { updateId: String(update_id), chatId: String(chatId) };
  if (message.text?.startsWith("/")) {
    return { ...base, type: "command", command: message.text.slice(1).split(/[\s@]/)[0] };
  }
  if (message.text) return { ...base, type: "text", text: message.text };
  const photo = message.photo?.at(-1);
  if (photo) return { ...base, type: "image", fileId: photo.file_id };
  if (message.sticker) return { ...base, type: "sticker" };
  return null;
}

type Outgoing = { method: "sendMessage" | "sendPhoto"; body: Record<string, unknown> };
const MAX_CAPTION = 1024;

// Design A (PB-21): text, then each product card as a captioned photo, with the
// quick replies as a reply keyboard on the last message. Tapping a button sends
// its text as the shopper's message, as on Messenger.
export function toTelegramMessages(reply: Reply): Outgoing[] {
  const messages: Outgoing[] = [];
  if (reply.text) messages.push({ method: "sendMessage", body: { text: reply.text } });
  for (const p of reply.products) {
    const caption = `${p.name}\n${formatPrice(p.price)} · ${formatSizesInStock(p.sizesInStock)}`.slice(0, MAX_CAPTION);
    messages.push(
      p.imageUrl
        ? { method: "sendPhoto", body: { photo: p.imageUrl, caption } }
        : { method: "sendMessage", body: { text: caption } },
    );
  }
  const last = messages.at(-1);
  if (last) {
    last.body.reply_markup =
      reply.quickReplies.length > 0
        ? {
            keyboard: chunk(reply.quickReplies.map((text) => ({ text })), 2),
            resize_keyboard: true,
            one_time_keyboard: true,
          }
        : { remove_keyboard: true };
  }
  return messages;
}

const chunk = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

// The URL carries the bot token: never put it in an error or a log.
async function callBotApi(token: string, method: string, body: unknown, fetchFn: typeof fetch) {
  const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!result?.ok) {
    throw Object.assign(new Error(`telegram_send_failed: ${result?.description ?? response.status}`), { status: response.status });
  }
}

// The Telegram channel adapter: sends each message in order with the bot's token.
// A photo Telegram can't load is sent as its caption instead.
export async function sendTelegram(target: DeliveryTarget, reply: Reply, fetchFn: typeof fetch = fetch) {
  const token = target.channelAccount?.accessToken;
  if (!token) throw new Error("telegram_send_failed: no bot account");
  for (const { method, body } of toTelegramMessages(reply)) {
    try {
      await callBotApi(token, method, { chat_id: target.externalId, ...body }, fetchFn);
    } catch (error) {
      // Only a refused photo (400) falls back; a blocked bot, a rate limit or a network
      // error would fail the text too.
      if (method !== "sendPhoto" || (error as { status?: number }).status !== 400) throw error;
      console.warn("telegram: photo not sent, sending the caption", error);
      const text = { chat_id: target.externalId, text: body.caption, reply_markup: body.reply_markup };
      await callBotApi(token, "sendMessage", text, fetchFn);
    }
  }
}

export function sendTelegramTyping(token: string, chatId: string, fetchFn: typeof fetch = fetch) {
  return callBotApi(token, "sendChatAction", { chat_id: chatId, action: "typing" }, fetchFn);
}

export function sendTelegramText(token: string, chatId: string, text: string, fetchFn: typeof fetch = fetch) {
  return callBotApi(token, "sendMessage", { chat_id: chatId, text }, fetchFn);
}
