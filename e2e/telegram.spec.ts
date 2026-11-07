import { expect, test } from "@playwright/test";
import { fakeChatId, postTelegram, telegramUpdate } from "./support/channels";
import { conversationOf, settle, shopIdBySlug, telegramAccountId, waitForConversation } from "./support/db";
import { channelSecrets, db, NEEDS_DB } from "./support/env";

// PB-21: the Telegram webhook, end to end through the running app and database.

const answered = (sender: string) => sender === "ai" || sender === "system";

test("@smoke an update for an unknown account is acknowledged and ignored", async ({ request }) => {
  const res = await postTelegram(request, "00000000-0000-4000-8000-000000000000", telegramUpdate(fakeChatId(), { text: "hi" }));
  expect(res.status()).toBe(200);
});

test.describe("with the local database", () => {
  test.skip(!db || !channelSecrets.telegramWebhookSecret, NEEDS_DB);

  let accountId: string;
  test.beforeAll(async () => {
    accountId = await telegramAccountId(await shopIdBySlug("hanh-boutique"));
  });

  test("a shopper's message lands in the bot's shop and gets answered once", async ({ request }) => {
    const chat = fakeChatId();
    expect((await postTelegram(request, accountId, telegramUpdate(chat, { text: "Áo len còn màu be không?" }))).status()).toBe(200);
    const conversation = await waitForConversation("telegram", String(chat), (c) => c.messages.some((m) => answered(m.sender)));
    expect(conversation.shopId).toBe(await shopIdBySlug("hanh-boutique"));
    expect(conversation.messages[0]).toEqual({ sender: "shopper", text: "Áo len còn màu be không?" });
    expect(conversation.messages.filter((m) => answered(m.sender))).toHaveLength(1);
  });

  test("the same update_id delivered twice is stored once", async ({ request }) => {
    const chat = fakeChatId();
    const update = telegramUpdate(chat, { text: "giá bao nhiêu?" });
    await postTelegram(request, accountId, update);
    await waitForConversation("telegram", String(chat), (c) => c.messages.some((m) => answered(m.sender)));
    await postTelegram(request, accountId, update);
    await settle();
    const conversation = await conversationOf("telegram", String(chat));
    expect(conversation?.messages.filter((m) => m.sender === "shopper")).toHaveLength(1);
  });

  test("/start is greeted without storing anything or calling the AI", async ({ request }) => {
    const chat = fakeChatId();
    expect((await postTelegram(request, accountId, telegramUpdate(chat, { text: "/start" }))).status()).toBe(200);
    await settle();
    expect(await conversationOf("telegram", String(chat))).toBeNull();
  });

  test("a photo goes to staff with a notice", async ({ request }) => {
    const chat = fakeChatId();
    await postTelegram(request, accountId, telegramUpdate(chat, { photo: [{ file_id: "small" }, { file_id: "large" }] }));
    const conversation = await waitForConversation("telegram", String(chat), (c) => c.mode === "needs_human");
    expect(conversation.messages[0]).toEqual({ sender: "shopper", text: "[Khách gửi ảnh] tg-file:large" });
  });

  test("stickers, edits, group chats and other bots store nothing", async ({ request }) => {
    const chat = fakeChatId();
    await postTelegram(request, accountId, telegramUpdate(chat, { sticker: { file_id: "st" } }));
    await postTelegram(request, accountId, { update_id: Date.now(), edited_message: { chat: { id: chat, type: "private" }, text: "sửa" } });
    await postTelegram(request, accountId, telegramUpdate(chat, { text: "hi", chat: { id: chat, type: "group" } }));
    await postTelegram(request, accountId, telegramUpdate(chat, { text: "hi", from: { id: chat, is_bot: true } }));
    await settle();
    expect(await conversationOf("telegram", String(chat))).toBeNull();
  });

  test("a missing or wrong secret token is rejected and stores nothing", async ({ request }) => {
    const chat = fakeChatId();
    expect((await postTelegram(request, accountId, telegramUpdate(chat, { text: "hi" }), null)).status()).toBe(401);
    expect((await postTelegram(request, accountId, telegramUpdate(chat, { text: "hi" }), "wrong_secret")).status()).toBe(401);
    await settle();
    expect(await conversationOf("telegram", String(chat))).toBeNull();
  });

  test("an account id that is not a UUID is acknowledged and ignored", async ({ request }) => {
    expect((await postTelegram(request, "not-a-uuid", telegramUpdate(fakeChatId(), { text: "hi" }))).status()).toBe(200);
  });
});
