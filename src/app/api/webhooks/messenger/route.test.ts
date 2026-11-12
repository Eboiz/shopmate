import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: (() => Promise<void>)[] = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const accounts = [{ id: "acc-a", shop_id: "shop-a", external_account_id: "111", access_token: "token-a" }];
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

  it("returns 404 for a signed delivery that isn't about a Page", async () => {
    expect((await post(JSON.stringify({ object: "instagram", entry: [] }))).status).toBe(404);
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
