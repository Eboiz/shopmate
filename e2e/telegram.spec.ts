import { expect, test } from "@playwright/test";
import { fakeChatId, postTelegram, telegramUpdate } from "./support/channels";
import { conversationOf, settle, shopIdBySlug, telegramAccountId, waitForConversation } from "./support/db";
import { channelSecrets, db, NEEDS_DB, uid } from "./support/env";

// PB-21: the Telegram webhook, end to end through the running app and database.

const answered = (sender: string) => sender === "ai" || sender === "system";

const HANDOFF_NOTICE = "Cảm ơn bạn! Nhân viên shop sẽ trả lời bạn ngay.";

type ShopConversation = { shopId: string; mode: string; messages: { sender: string; text: string }[] };

// The conversation of one shop and one chat. `conversationOf` cannot be used when
// the same chat id talks to two shops: it looks the shopper up by channel and
// external id alone, which then matches two rows.
async function conversationOfShop(shopId: string, chatId: string): Promise<ShopConversation | null> {
  const { data, error } = await db!
    .from("shoppers")
    .select("shop_id, conversations(id, mode, messages(sender, text, created_at))")
    .eq("shop_id", shopId)
    .eq("channel", "telegram")
    .eq("external_id", chatId)
    .maybeSingle();
  if (error) throw error;
  const conversation = data?.conversations[0];
  if (!data || !conversation) return null;
  const messages = [...conversation.messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { shopId: data.shop_id, mode: conversation.mode, messages: messages.map(({ sender, text }) => ({ sender, text })) };
}

async function waitForShopConversation(shopId: string, chatId: string, done: (c: ShopConversation) => boolean) {
  let last: ShopConversation | null = null;
  await expect
    .poll(async () => {
      last = await conversationOfShop(shopId, chatId);
      return last !== null && done(last);
    }, { timeout: 20_000 })
    .toBe(true);
  return last as unknown as ShopConversation;
}

test("@smoke an update for an unknown account is acknowledged and ignored", async ({ request }) => {
  const res = await postTelegram(request, "00000000-0000-4000-8000-000000000000", telegramUpdate(fakeChatId(), { text: "hi" }));
  expect(res.status()).toBe(200);
});

test("@smoke an account id that is not a UUID is acknowledged and ignored", async ({ request }) => {
  expect((await postTelegram(request, "not-a-uuid", telegramUpdate(fakeChatId(), { text: "hi" }))).status()).toBe(200);
});

test.describe("with the local database", () => {
  test.skip(!db || !channelSecrets.telegramWebhookSecret, NEEDS_DB);

  let accountId: string;
  let evalAccountId: string;
  test.beforeAll(async () => {
    accountId = await telegramAccountId(await shopIdBySlug("may-boutique"));
    const evalShopId = await shopIdBySlug("may-boutique-eval");
    const { data: created, error: insertError } = await db!
      .from("channel_accounts")
      .insert({
        shop_id: evalShopId,
        channel: "telegram",
        external_account_id: uid("tg-eval-bot"),
        access_token: "e2e-fake-token",
        webhook_secret: channelSecrets.telegramWebhookSecret,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    evalAccountId = created.id;
  });

  test("a shopper's message lands in the bot's shop and gets answered once", async ({ request }) => {
    const chat = fakeChatId();
    expect((await postTelegram(request, accountId, telegramUpdate(chat, { text: "Áo len còn màu be không?" }))).status()).toBe(200);
    const conversation = await waitForConversation("telegram", String(chat), (c) => c.messages.some((m) => answered(m.sender)));
    expect(conversation.shopId).toBe(await shopIdBySlug("may-boutique"));
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

  test("a text that needs staff hands off with exactly one system notice", async ({ request }) => {
    const chat = fakeChatId();
    expect((await postTelegram(request, accountId, telegramUpdate(chat, { text: "Áo len còn màu be không?" }))).status()).toBe(200);

    const conversation = await waitForConversation(
      "telegram",
      String(chat),
      (c) => c.mode === "needs_human" && c.messages.some((m) => m.sender === "system"),
    );
    expect(conversation.shopId).toBe(await shopIdBySlug("may-boutique"));

    const shopperMessages = conversation.messages.filter((m) => m.sender === "shopper");
    expect(shopperMessages).toHaveLength(1);
    expect(shopperMessages[0].text).toBe("Áo len còn màu be không?");

    const systemMessages = conversation.messages.filter((m) => m.sender === "system");
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages.map((m) => m.text)).toEqual([HANDOFF_NOTICE]);

    expect(conversation.messages.filter((m) => m.sender === "ai")).toHaveLength(0);
    expect(conversation.mode).toBe("needs_human");
  });

  test("two updates from the same chat stay in one conversation", async ({ request }) => {
    const chat = fakeChatId();
    const updateA = telegramUpdate(chat, { text: "tin 1" });
    expect((await postTelegram(request, accountId, updateA)).status()).toBe(200);
    await waitForConversation("telegram", String(chat), (c) => c.messages.some((m) => m.sender === "shopper"));

    const updateB = telegramUpdate(chat, { text: "tin 2" });
    expect((await postTelegram(request, accountId, updateB)).status()).toBe(200);
    const conversation = await waitForConversation(
      "telegram",
      String(chat),
      (c) => c.messages.filter((m) => m.sender === "shopper").length === 2 && c.mode === "needs_human",
    );

    const shopId = await shopIdBySlug("may-boutique");
    const shoppers = await db!.from("shoppers").select("id").eq("shop_id", shopId).eq("channel", "telegram").eq("external_id", String(chat));
    expect(shoppers.data).toHaveLength(1);
    const convs = await db!
      .from("conversations")
      .select("id, shoppers!inner(channel, external_id)")
      .eq("shop_id", shopId)
      .eq("shoppers.external_id", String(chat))
      .eq("shoppers.channel", "telegram");
    expect(convs.data).toHaveLength(1);

    expect(conversation.messages.filter((m) => m.sender === "shopper").map((m) => m.text)).toEqual(["tin 1", "tin 2"]);
    expect(conversation.mode).toBe("needs_human");
  });

  test("/start leaves no trace in the database, not even a delivery record", async ({ request }) => {
    const chat = fakeChatId();
    const update = telegramUpdate(chat, { text: "/start" });
    const updateId = (update as { update_id: number }).update_id;

    expect((await postTelegram(request, accountId, update)).status()).toBe(200);
    await settle();

    expect(await conversationOf("telegram", String(chat))).toBeNull();

    const events = await db!
      .from("channel_events")
      .select("external_message_id")
      .eq("channel_account_id", accountId)
      .eq("external_message_id", String(updateId));
    expect(events.data).toHaveLength(0);

    const shoppers = await db!
      .from("shoppers")
      .select("id")
      .eq("shop_id", await shopIdBySlug("may-boutique"))
      .eq("channel", "telegram")
      .eq("external_id", String(chat));
    expect(shoppers.data).toHaveLength(0);
  });

  test("unusable updates are acknowledged and malformed bodies get 400, both store nothing", async ({ request }) => {
    const voiceChat = fakeChatId();
    expect(
      (await postTelegram(request, accountId, telegramUpdate(voiceChat, { voice: { file_id: "v", duration: 5 } }))).status(),
    ).toBe(200);

    const emptyChat = fakeChatId();
    expect((await postTelegram(request, accountId, {})).status()).toBe(200);

    const noIdChat = fakeChatId();
    const noIdUpdate = { update_id: Date.now(), message: { from: { is_bot: false }, chat: { type: "private" }, text: "không id" } };
    expect((await postTelegram(request, accountId, noIdUpdate)).status()).toBe(200);

    const brokenChat = fakeChatId();
    const broken = await request.post(`/api/webhooks/telegram/${accountId}`, {
      data: "{not json",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": channelSecrets.telegramWebhookSecret },
    });
    expect(broken.status()).toBe(400);

    await settle();

    expect(await conversationOf("telegram", String(voiceChat))).toBeNull();
    expect(await conversationOf("telegram", String(emptyChat))).toBeNull();
    expect(await conversationOf("telegram", String(noIdChat))).toBeNull();
    expect(await conversationOf("telegram", String(brokenChat))).toBeNull();
  });

  test("the same chat id on two shops' bots keeps their data separate", async ({ request }) => {
    const demoShopId = await shopIdBySlug("may-boutique");
    const evalShopId = await shopIdBySlug("may-boutique-eval");
    const chat = fakeChatId();

    expect((await postTelegram(request, accountId, telegramUpdate(chat, { text: "tin demo" }))).status()).toBe(200);
    const demo = await waitForShopConversation(
      demoShopId,
      String(chat),
      (c) => c.mode === "needs_human" && c.messages.some((m) => m.sender === "system"),
    );

    expect((await postTelegram(request, evalAccountId, telegramUpdate(chat, { text: "tin eval" }))).status()).toBe(200);
    const evalConv = await waitForShopConversation(
      evalShopId,
      String(chat),
      (c) => c.mode === "needs_human" && c.messages.some((m) => m.sender === "system"),
    );

    expect(evalConv.shopId).toBe(evalShopId);
    expect(evalConv.messages.filter((m) => m.sender === "shopper").map((m) => m.text)).toEqual(["tin eval"]);
    expect(demo.messages.filter((m) => m.sender === "shopper").map((m) => m.text)).toEqual(["tin demo"]);

    expect(demo.messages.filter((m) => m.sender === "system")).toHaveLength(1);
    expect(evalConv.messages.filter((m) => m.sender === "system")).toHaveLength(1);
    expect(demo.mode).toBe("needs_human");
    expect(evalConv.mode).toBe("needs_human");

    const shopIds = [demoShopId, evalShopId];
    const all = await db!
      .from("shoppers")
      .select("shop_id, channel, external_id")
      .eq("channel", "telegram")
      .eq("external_id", String(chat))
      .in("shop_id", shopIds);
    expect(all.data).toHaveLength(2);

    const convs = await db!
      .from("conversations")
      .select("shop_id, shoppers!inner(channel, external_id)")
      .eq("shoppers.external_id", String(chat))
      .eq("shoppers.channel", "telegram")
      .in("shop_id", shopIds);
    expect(convs.data).toHaveLength(2);
  });

  test("a replayed update after the handoff adds no second notice", async ({ request }) => {
    const chat = fakeChatId();
    const update = telegramUpdate(chat, { text: "giá bao nhiêu?" });

    expect((await postTelegram(request, accountId, update)).status()).toBe(200);
    await waitForConversation(
      "telegram",
      String(chat),
      (c) => c.mode === "needs_human" && c.messages.some((m) => m.sender === "system"),
    );

    expect((await postTelegram(request, accountId, update)).status()).toBe(200);
    await settle();

    const conversation = await conversationOf("telegram", String(chat));
    expect(conversation).not.toBeNull();
    expect(conversation!.messages.filter((m) => m.sender === "shopper")).toHaveLength(1);
    const systemMessages = conversation!.messages.filter((m) => m.sender === "system");
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].text).toBe(HANDOFF_NOTICE);
    expect(conversation!.mode).toBe("needs_human");
  });

  test("an update for a Messenger account id is acknowledged and ignored", async ({ request }) => {
    const demoShopId = await shopIdBySlug("may-boutique");
    const { data: messengerAccount } = await db!
      .from("channel_accounts")
      .select("id")
      .eq("shop_id", demoShopId)
      .eq("channel", "messenger")
      .single();
    expect(messengerAccount, "the demo shop must have a Messenger channel account").not.toBeNull();

    const chat = fakeChatId();
    expect((await postTelegram(request, messengerAccount!.id, telegramUpdate(chat, { text: "hi" }))).status()).toBe(200);
    await settle();

    expect(await conversationOf("telegram", String(chat))).toBeNull();

    const events = await db!.from("channel_events").select("external_message_id").eq("channel_account_id", messengerAccount!.id);
    expect(events.data).toHaveLength(0);
  });
});
