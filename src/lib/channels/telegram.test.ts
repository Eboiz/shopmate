import { describe, expect, it, vi } from "vitest";
import type { Reply } from "@/contract";
import { parseTelegramUpdate, sendTelegram, sendTelegramTyping, toTelegramMessages, verifyTelegramSecret } from "./telegram";

describe("verifyTelegramSecret", () => {
  it("accepts the secret set with setWebhook and rejects anything else", () => {
    expect(verifyTelegramSecret("s3cret_-1", "s3cret_-1")).toBe(true);
    expect(verifyTelegramSecret(null, "s3cret_-1")).toBe(false);
    expect(verifyTelegramSecret("s3cret_-2", "s3cret_-1")).toBe(false);
    expect(verifyTelegramSecret("s3cret", "s3cret_-1")).toBe(false);
  });
});

const message = (extra: Record<string, unknown>, chat = { id: 42, type: "private" }) => ({
  update_id: 1001,
  message: { message_id: 7, from: { id: 42, is_bot: false, first_name: "Thảo" }, chat, date: 1, ...extra },
});

describe("parseTelegramUpdate", () => {
  it("reads a text message from a private chat", () => {
    expect(parseTelegramUpdate(message({ text: "Váy size M còn không?" }))).toEqual({
      type: "text",
      updateId: "1001",
      chatId: "42",
      text: "Váy size M còn không?",
    });
  });

  it("reads /start and other commands as commands, not shopper questions", () => {
    expect(parseTelegramUpdate(message({ text: "/start" }))).toMatchObject({ type: "command", command: "start" });
    expect(parseTelegramUpdate(message({ text: "/help@may_boutique_demo2_bot" }))).toMatchObject({ type: "command", command: "help" });
  });

  it("reads a photo as an image (largest size), and a sticker as a sticker", () => {
    const photo = [{ file_id: "small" }, { file_id: "large" }];
    expect(parseTelegramUpdate(message({ photo, caption: "mẫu này" }))).toEqual({
      type: "image",
      updateId: "1001",
      chatId: "42",
      fileId: "large",
      caption: "mẫu này",
    });
    expect(parseTelegramUpdate(message({ photo }))).toMatchObject({ type: "image", caption: "" });
    expect(parseTelegramUpdate(message({ sticker: { file_id: "st" } }))).toMatchObject({ type: "sticker" });
  });

  it("ignores edited messages, groups, channels, bots and unsupported messages", () => {
    expect(parseTelegramUpdate({ update_id: 1, edited_message: { text: "x" } })).toBeNull();
    expect(parseTelegramUpdate(message({ text: "hi" }, { id: -5, type: "group" }))).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, channel_post: { text: "x" } })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, message: { ...message({ text: "x" }).message, from: { id: 9, is_bot: true } } })).toBeNull();
    expect(parseTelegramUpdate(message({ voice: { file_id: "v" } }))).toBeNull();
    expect(parseTelegramUpdate({})).toBeNull();
  });
});

const card = (n: number, imageUrl: string | null = `https://x.supabase.co/storage/v1/object/public/product-images/SP0${n}.jpg`) => ({
  productId: `00000000-0000-4000-8000-00000000000${n}`,
  name: `Sản phẩm ${n}`,
  price: 359000,
  imageUrl,
  sizesInStock: ["S", "M"],
});

describe("toTelegramMessages (design A: text, one photo per card, keyboard on the last)", () => {
  it("sends text, then each card as a captioned photo, with the reply keyboard on the last message", () => {
    const reply: Reply = { text: "Bạn mặc size M ạ.", products: [card(1), card(2, null)], quickReplies: ["Size M màu Be", "Phối với gì?", "Đặt luôn"] };
    expect(toTelegramMessages(reply)).toEqual([
      { method: "sendMessage", body: { text: "Bạn mặc size M ạ." } },
      { method: "sendPhoto", body: { photo: card(1).imageUrl, caption: "Sản phẩm 1\n359.000đ · Size còn hàng: S, M" } },
      {
        method: "sendMessage",
        body: {
          text: "Sản phẩm 2\n359.000đ · Size còn hàng: S, M",
          reply_markup: {
            keyboard: [[{ text: "Size M màu Be" }, { text: "Phối với gì?" }], [{ text: "Đặt luôn" }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      },
    ]);
  });

  it("removes an old keyboard when the reply has no quick replies, and sends nothing empty", () => {
    expect(toTelegramMessages({ text: "Dạ", products: [], quickReplies: [] })).toEqual([
      { method: "sendMessage", body: { text: "Dạ", reply_markup: { remove_keyboard: true } } },
    ]);
    expect(toTelegramMessages({ text: "", products: [], quickReplies: [] })).toEqual([]);
  });
});

describe("sendTelegram", () => {
  const target = {
    channel: "telegram" as const,
    externalId: "42",
    channelAccount: { id: "acc", externalAccountId: "123", accessToken: "123:bot-token" },
  };
  const ok = () => Response.json({ ok: true, result: {} });

  it("calls the Bot API with the bot's token and the shopper's chat id, in order", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendTelegram(target, { text: "Dạ", products: [card(1)], quickReplies: [] }, fetchMock);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      "https://api.telegram.org/bot123:bot-token/sendMessage",
      "https://api.telegram.org/bot123:bot-token/sendPhoto",
    ]);
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ chat_id: "42", text: "Dạ" });
  });

  it("falls back to the caption as text when Telegram can't load the photo", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("sendPhoto") ? Response.json({ ok: false, description: "Bad Request: wrong file identifier" }, { status: 400 }) : ok(),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendTelegram(target, { text: "", products: [card(1)], quickReplies: ["Đặt luôn"] }, fetchMock);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url.split("/").pop())).toEqual(["sendPhoto", "sendMessage"]);
    expect(JSON.parse(String(calls[1][1].body))).toMatchObject({ text: "Sản phẩm 1\n359.000đ · Size còn hàng: S, M", reply_markup: { keyboard: [[{ text: "Đặt luôn" }]] } });
    warn.mockRestore();
  });

  it("does not retry a photo as text when the chat itself refuses (blocked bot)", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: false, description: "Forbidden: bot was blocked by the user" }, { status: 403 }));
    await expect(sendTelegram(target, { text: "", products: [card(1)], quickReplies: [] }, fetchMock)).rejects.toThrow("Forbidden");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws Telegram's description, never the token, when a text message fails", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: false, description: "Forbidden: bot was blocked by the user" }, { status: 403 }));
    await expect(sendTelegram(target, { text: "Dạ", products: [], quickReplies: [] }, fetchMock)).rejects.toThrow(
      "telegram_send_failed: Forbidden: bot was blocked by the user",
    );
    await expect(sendTelegram({ ...target, channelAccount: null }, { text: "Dạ", products: [], quickReplies: [] })).rejects.toThrow(
      "telegram_send_failed: no bot account",
    );
  });

  it("shows typing with sendChatAction", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendTelegramTyping("123:bot-token", "42", fetchMock);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/sendChatAction")).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: "42", action: "typing" });
  });
});
