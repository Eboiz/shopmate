import { expect, test } from "@playwright/test";
import { messengerBody, messengerText, postMessenger, signMessenger } from "./support/channels";
import { conversationOf, settle, shopIdBySlug, waitForConversation } from "./support/db";
import { channelSecrets, db, NEEDS_DB, uid } from "./support/env";

// PB-15: the Messenger webhook, end to end through the running app and database.
// Until the AI engine answers, a turn either gets an AI reply or is handed to staff
// with a notice; both count as "answered" here.

const answered = (sender: string) => sender === "ai" || sender === "system";

test.describe("webhook guard", () => {
  test("@smoke an unsigned delivery is rejected", async ({ request }) => {
    const res = await postMessenger(request, messengerBody([]), null);
    expect(res.status()).toBe(401);
  });

  test("@smoke callback verification with a wrong token is refused", async ({ request }) => {
    const res = await request.get("/api/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1");
    expect(res.status()).toBe(403);
  });
});

test.describe("with the local database", () => {
  test.skip(!db || !channelSecrets.metaAppSecret, NEEDS_DB);

  test("callback verification with the right token echoes the challenge", async ({ request }) => {
    const res = await request.get(
      `/api/webhooks/messenger?hub.mode=subscribe&hub.verify_token=${channelSecrets.metaVerifyToken}&hub.challenge=4242`,
    );
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe("4242");
  });

  test("a shopper's message lands in the Page's shop and gets answered once", async ({ request }) => {
    const psid = uid("psid");
    const res = await postMessenger(request, messengerBody([messengerText(psid, uid("mid"), "Váy suông linen size nào vừa 1m58 50kg?")]));
    expect(res.status()).toBe(200);

    const conversation = await waitForConversation("messenger", psid, (c) => c.messages.some((m) => answered(m.sender)));
    expect(conversation.shopId).toBe(await shopIdBySlug("hanh-boutique"));
    expect(conversation.messages[0]).toEqual({ sender: "shopper", text: "Váy suông linen size nào vừa 1m58 50kg?" });
    expect(conversation.messages.filter((m) => answered(m.sender))).toHaveLength(1);
  });

  test("the same message delivered twice is stored and answered once", async ({ request }) => {
    const psid = uid("psid");
    const body = messengerBody([messengerText(psid, uid("mid"), "Còn size M không?")]);
    expect((await postMessenger(request, body)).status()).toBe(200);
    await waitForConversation("messenger", psid, (c) => c.messages.some((m) => answered(m.sender)));
    expect((await postMessenger(request, body)).status()).toBe(200);
    await settle();

    const conversation = await conversationOf("messenger", psid);
    expect(conversation?.messages.filter((m) => m.sender === "shopper")).toHaveLength(1);
    expect(conversation?.messages.filter((m) => answered(m.sender))).toHaveLength(1);
  });

  test("two messages in one delivery are both stored, in order", async ({ request }) => {
    const psid = uid("psid");
    await postMessenger(request, messengerBody([messengerText(psid, uid("mid"), "tin 1"), messengerText(psid, uid("mid"), "tin 2")]));
    const conversation = await waitForConversation("messenger", psid, (c) => c.messages.filter((m) => m.sender === "shopper").length === 2);
    expect(conversation.messages.filter((m) => m.sender === "shopper").map((m) => m.text)).toEqual(["tin 1", "tin 2"]);
  });

  // PB-30: the server downloads the photo; one it can't keep (here: example.com
  // answers 404) is stored as a note, never the channel's link (A10).
  test("a photo that can't be downloaded goes to staff with a notice", async ({ request }) => {
    const psid = uid("psid");
    await postMessenger(
      request,
      messengerBody([{ sender: { id: psid }, message: { mid: uid("mid"), attachments: [{ type: "image", payload: { url: "https://example.com/a.jpg" } }] } }]),
    );
    const conversation = await waitForConversation("messenger", psid, (c) => c.mode === "needs_human" && c.messages.at(-1)?.sender === "system");
    expect(conversation.messages[0]).toEqual({ sender: "shopper", text: "[Khách gửi ảnh, không lưu được ảnh]" });
    expect(conversation.messages.at(-1)?.sender).toBe("system");
  });

  test("after a handoff, new messages are stored but the AI stays silent", async ({ request }) => {
    const psid = uid("psid");
    await postMessenger(
      request,
      messengerBody([{ sender: { id: psid }, message: { mid: uid("mid"), attachments: [{ type: "image", payload: { url: "https://example.com/b.jpg" } }] } }]),
    );
    const before = await waitForConversation("messenger", psid, (c) => c.mode === "needs_human");
    await postMessenger(request, messengerBody([messengerText(psid, uid("mid"), "Alo shop ơi")]));
    const after = await waitForConversation("messenger", psid, (c) => c.messages.length === before.messages.length + 1);
    expect(after.messages.at(-1)).toEqual({ sender: "shopper", text: "Alo shop ơi" });
  });

  test("stickers, echoes of the Page's own messages, deliveries and reads store nothing", async ({ request }) => {
    const psid = uid("psid");
    await postMessenger(
      request,
      messengerBody([
        { sender: { id: psid }, message: { mid: uid("mid"), sticker_id: 369239263222822, attachments: [{ type: "image", payload: { sticker_id: 1, url: "https://x/s.png" } }] } },
        { sender: { id: psid }, message: { mid: uid("mid"), text: "echo", is_echo: true } },
        { sender: { id: psid }, delivery: { mids: ["x"] } },
        { sender: { id: psid }, read: { watermark: 1 } },
      ]),
    );
    await settle();
    expect(await conversationOf("messenger", psid)).toBeNull();
  });

  test("a wrong signature is rejected and stores nothing", async ({ request }) => {
    const psid = uid("psid");
    const body = messengerBody([messengerText(psid, uid("mid"), "giả mạo")]);
    expect((await postMessenger(request, body, signMessenger(body, "not-the-app-secret"))).status()).toBe(401);
    await settle();
    expect(await conversationOf("messenger", psid)).toBeNull();
  });

  test("a delivery for a Page no shop owns is ignored with 200", async ({ request }) => {
    const psid = uid("psid");
    const res = await postMessenger(request, messengerBody([messengerText(psid, uid("mid"), "hi")], "999999999999"));
    expect(res.status()).toBe(200);
    await settle();
    expect(await conversationOf("messenger", psid)).toBeNull();
  });

  test("signed but malformed bodies get 400; instagram deliveries answer 200, unknown objects 404", async ({ request }) => {
    const broken = "{not json";
    expect((await postMessenger(request, broken, signMessenger(broken))).status()).toBe(400);
    // PB-23 added an object=instagram handler: a well-formed instagram body is
    // acknowledged 200 ("EVENT_RECEIVED"), even with no events in it.
    const instagram = JSON.stringify({ object: "instagram", entry: [] });
    expect((await postMessenger(request, instagram, signMessenger(instagram))).status()).toBe(200);
    // A genuinely unknown object still has no handler: 404.
    const unknown = JSON.stringify({ object: "graph_user", entry: [] });
    expect((await postMessenger(request, unknown, signMessenger(unknown))).status()).toBe(404);
  });
});
