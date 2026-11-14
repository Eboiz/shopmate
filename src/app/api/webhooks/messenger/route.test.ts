import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: (() => Promise<void>)[] = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const accounts = [
  { id: "acc-a", shop_id: "shop-a", external_account_id: "111", access_token: "token-a" },
  { id: "acc-wa", shop_id: "shop-a", external_account_id: "PN1", access_token: "wa-token" },
  { id: "acc-ig", shop_id: "shop-a", external_account_id: "17841400000000001", access_token: "page-token-ig" },
];
const lookups: unknown[][] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => (lookups.push(["eq", ...args]), chain),
        in: async (...args: unknown[]) => (lookups.push(["in", ...args]), { data: accounts, error: null }),
      };
      return chain;
    },
  }),
}));

const received: unknown[][] = [];
vi.mock("@/lib/channels/receive", () => ({
  receiveChannelMessage: async (...args: unknown[]) => {
    received.push(args);
    return "answered";
  },
}));

const { GET, POST } = await import("./route");

const secret = "test-app-secret";
const url = "http://localhost/api/webhooks/messenger";
const delivery = (pageId: string, messaging: unknown[]) =>
  // Keep the \uXXXX escapes raw, as Meta sends them.
  JSON.stringify({ object: "page", entry: [{ id: pageId, time: 1, messaging }] }).replaceAll("\\\\u", "\\u");
const text = (mid: string, t = "V\\u00e1y size M") => ({ sender: { id: "psid-1" }, message: { mid, text: t } });
const post = (body: string, signature?: string | null) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = signature === undefined ? `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` : signature;
  if (sig) headers["x-hub-signature-256"] = sig;
  return POST(new NextRequest(url, { method: "POST", body, headers }));
};
const runAfter = async () => {
  for (const task of afterTasks.splice(0)) await task();
};

beforeEach(() => {
  afterTasks.length = 0;
  received.length = 0;
  lookups.length = 0;
  process.env.META_APP_SECRET = secret;
  process.env.META_VERIFY_TOKEN = "verify-me";
});

describe("GET /api/webhooks/messenger (callback verification)", () => {
  it("echoes the challenge for the right verify token", async () => {
    const res = GET(new NextRequest(`${url}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("refuses a wrong token, a wrong mode, or a server with no token set", () => {
    expect(GET(new NextRequest(`${url}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`)).status).toBe(403);
    expect(GET(new NextRequest(`${url}?hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=42`)).status).toBe(403);
    delete process.env.META_VERIFY_TOKEN;
    expect(GET(new NextRequest(`${url}?hub.mode=subscribe&hub.verify_token=&hub.challenge=42`)).status).toBe(403);
  });
});

describe("POST /api/webhooks/messenger", () => {
  it("rejects a missing or wrong signature before doing anything", async () => {
    const body = delivery("111", [text("m1")]);
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, "sha256=00")).status).toBe(401);
    expect((await post(body.replace("M", "L"), `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`)).status).toBe(401);
    expect(afterTasks).toHaveLength(0);
  });

  it("fails closed when the app secret is not configured", async () => {
    delete process.env.META_APP_SECRET;
    expect((await post(delivery("111", [text("m1")]))).status).toBe(500);
    expect(afterTasks).toHaveLength(0);
  });

  it("returns 404 for a signed delivery that isn't about a Page, Instagram or WhatsApp", async () => {
    expect((await post(JSON.stringify({ object: "user", entry: [] }))).status).toBe(404);
    expect((await post(JSON.stringify({ entry: [] }))).status).toBe(404);
  });

  it("answers 200 at once and handles the message afterwards, in the Page's shop", async () => {
    const res = await post(delivery("111", [text("m1")]));
    expect(res.status).toBe(200);
    expect(received).toHaveLength(0);

    await runAfter();
    expect(lookups).toEqual([["eq", "channel", "messenger"], ["in", "external_account_id", ["111"]]]);
    expect(received).toHaveLength(1);
    const [account, incoming, onThinking] = received[0];
    expect(account).toEqual({ id: "acc-a", shopId: "shop-a", channel: "messenger" });
    expect(incoming).toEqual({ externalId: "psid-1", messageId: "m1", text: "Váy size M" });
    expect(typeof onThinking).toBe("function");
  });

  it("logs and ignores a message for an unknown Page, but still answers 200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(delivery("999", [text("m1")]))).status).toBe(200);
    await runAfter();
    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalledWith("messenger: unknown page 999, message ignored");
    warn.mockRestore();
  });

  it("passes photos on, and only logs stickers", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await post(
      delivery("111", [
        { sender: { id: "psid-1" }, message: { mid: "p1", attachments: [{ type: "image", payload: { url: "https://x/1.jpg" } }] } },
        { sender: { id: "psid-1" }, message: { mid: "s1", sticker_id: 1, attachments: [{ type: "image", payload: { url: "https://x/s.png", sticker_id: 1 } }] } },
      ]),
    );
    await runAfter();
    expect(received.map((r) => r[1])).toEqual([
      { externalId: "psid-1", messageId: "p1", text: "", photos: [expect.any(Function)] },
    ]);
    expect(info).toHaveBeenCalledWith("messenger: sticker from psid-1 ignored");
    info.mockRestore();
  });
});

// WhatsApp (PB-27) shares this webhook: same app secret, object = whatsapp_business_account.
const waDelivery = (value: Record<string, unknown>, phoneNumberId = "PN1") =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
  }).replaceAll("\\\\u", "\\u");
const waText = (id: string, body = "V\\u00e1y size M") => ({ from: "84901234567", id, type: "text", text: { body } });

describe("POST /api/webhooks/messenger (WhatsApp)", () => {
  it("rejects a WhatsApp delivery with a missing or wrong signature", async () => {
    const body = waDelivery({ messages: [waText("wamid.1")] });
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, `sha256=${createHmac("sha256", "other-secret").update(body).digest("hex")}`)).status).toBe(401);
    expect(afterTasks).toHaveLength(0);
  });

  it("answers 200 at once and handles the message in the phone number's shop", async () => {
    const res = await post(waDelivery({ messages: [waText("wamid.1")] }));
    expect(res.status).toBe(200);
    expect(received).toHaveLength(0);

    await runAfter();
    expect(lookups).toEqual([["eq", "channel", "whatsapp"], ["in", "external_account_id", ["PN1"]]]);
    expect(received).toHaveLength(1);
    const [account, incoming, onThinking] = received[0];
    expect(account).toEqual({ id: "acc-wa", shopId: "shop-a", channel: "whatsapp" });
    expect(incoming).toEqual({ externalId: "84901234567", messageId: "wamid.1", text: "Váy size M" });
    expect(typeof onThinking).toBe("function");
  });

  it("passes a tapped reply button on as the shopper's text", async () => {
    await post(
      waDelivery({
        messages: [{ from: "84901234567", id: "wamid.2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "Size M", title: "Size M" } } }],
      }),
    );
    await runAfter();
    expect(received.map((r) => r[1])).toEqual([{ externalId: "84901234567", messageId: "wamid.2", text: "Size M" }]);
  });

  it("logs and ignores a message for an unknown phone number, but still answers 200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(waDelivery({ messages: [waText("wamid.1")] }, "PN999"))).status).toBe(200);
    await runAfter();
    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalledWith("whatsapp: unknown phone number PN999, message ignored");
    warn.mockRestore();
  });

  it("acknowledges delivered/read statuses without doing anything", async () => {
    const res = await post(waDelivery({ statuses: [{ id: "wamid.out", status: "delivered" }, { id: "wamid.out", status: "read" }] }));
    expect(res.status).toBe(200);
    expect(afterTasks).toHaveLength(0);
  });

  it("passes a photo on as one that can't be kept, so the conversation goes to staff", async () => {
    await post(waDelivery({ messages: [{ from: "84901234567", id: "wamid.3", type: "image", image: { id: "MEDIA1" } }] }));
    await runAfter();
    const [message] = received.map((r) => r[1] as { text: string; photos: (() => Promise<Uint8Array>)[] });
    expect(message).toMatchObject({ externalId: "84901234567", messageId: "wamid.3", text: "", photoRefs: ["whatsapp-media:MEDIA1"] });
    expect(message.photos).toHaveLength(1);
    await expect(message.photos[0]()).rejects.toThrow("whatsapp media MEDIA1 is not downloaded");
  });
});

// Instagram Direct (PB-23) shares this webhook: same app secret, object = instagram,
// entry id = the Instagram professional account ID.
const igAccount = "17841400000000001";
const igDelivery = (messaging: unknown[], accountId = igAccount) =>
  JSON.stringify({ object: "instagram", entry: [{ id: accountId, time: 1, messaging }] }).replaceAll("\\\\u", "\\u");
const igText = (mid: string, t = "V\\u00e1y size M") => ({ sender: { id: "igsid-1" }, recipient: { id: igAccount }, timestamp: 1, message: { mid, text: t } });

describe("POST /api/webhooks/messenger (Instagram)", () => {
  it("rejects an Instagram delivery with a missing or wrong signature", async () => {
    const body = igDelivery([igText("ig.m1")]);
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, `sha256=${createHmac("sha256", "other-secret").update(body).digest("hex")}`)).status).toBe(401);
    expect(afterTasks).toHaveLength(0);
  });

  it("answers 200 at once and handles the message in the Instagram account's shop", async () => {
    const res = await post(igDelivery([igText("ig.m1")]));
    expect(res.status).toBe(200);
    expect(received).toHaveLength(0);

    await runAfter();
    expect(lookups).toEqual([["eq", "channel", "instagram"], ["in", "external_account_id", [igAccount]]]);
    expect(received).toHaveLength(1);
    const [account, incoming, onThinking] = received[0];
    expect(account).toEqual({ id: "acc-ig", shopId: "shop-a", channel: "instagram" });
    expect(incoming).toEqual({ externalId: "igsid-1", messageId: "ig.m1", text: "Váy size M" });
    expect(typeof onThinking).toBe("function");
  });

  it("passes a tapped quick reply on as its payload", async () => {
    await post(igDelivery([{ sender: { id: "igsid-1" }, message: { mid: "ig.q1", text: "Size M", quick_reply: { payload: "Size M màu Be" } } }]));
    await runAfter();
    expect(received.map((r) => r[1])).toEqual([{ externalId: "igsid-1", messageId: "ig.q1", text: "Size M màu Be" }]);
  });

  it("logs and ignores a message for an unknown Instagram account, but still answers 200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(igDelivery([igText("ig.m1")], "17841499999999999"))).status).toBe(200);
    await runAfter();
    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalledWith("instagram: unknown account 17841499999999999, message ignored");
    warn.mockRestore();
  });

  it("acknowledges echoes, reads and reactions without doing anything", async () => {
    const res = await post(
      igDelivery([
        { sender: { id: igAccount }, recipient: { id: "igsid-1" }, message: { mid: "ig.e1", text: "Dạ", is_echo: true } },
        { sender: { id: "igsid-1" }, recipient: { id: igAccount }, read: { mid: "ig.e1" } },
        { sender: { id: "igsid-1" }, recipient: { id: igAccount }, reaction: { mid: "ig.e1", action: "react", reaction: "love", emoji: "❤" } },
      ]),
    );
    expect(res.status).toBe(200);
    expect(afterTasks).toHaveLength(0);
  });

  it("passes a photo on to be downloaded, like Messenger (PB-30)", async () => {
    await post(igDelivery([{ sender: { id: "igsid-1" }, message: { mid: "ig.p1", attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/ig/1" } }] } }]));
    await runAfter();
    expect(received.map((r) => r[1])).toEqual([{ externalId: "igsid-1", messageId: "ig.p1", text: "", photos: [expect.any(Function)] }]);
  });
});
