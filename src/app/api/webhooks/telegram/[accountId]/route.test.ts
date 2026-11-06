import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: (() => Promise<void>)[] = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const ACCOUNT = "a0000000-0000-4000-8000-000000000001";
const accounts = [{ id: ACCOUNT, shop_id: "shop-a", access_token: "123:bot", webhook_secret: "right_secret", shops: { name: "Mây Boutique" } }];
const lookups: unknown[][] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => (lookups.push([k, v]), (filters[k] = v), chain),
        maybeSingle: async () => ({
          data: accounts.find((a) => a.id === filters.id && filters.channel === "telegram") ?? null,
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const received: unknown[][] = [];
vi.mock("@/lib/channels/receive", () => ({
  receiveChannelMessage: async (...args: unknown[]) => (received.push(args), "answered"),
}));
const texts: unknown[][] = [];
vi.mock("@/lib/channels/telegram", async (original) => ({
  ...(await original<typeof import("@/lib/channels/telegram")>()),
  sendTelegramText: async (...args: unknown[]) => texts.push(args),
  sendTelegramTyping: async () => {},
}));

const { POST } = await import("./route");

const update = (extra: Record<string, unknown>, updateId = 1001) =>
  JSON.stringify({ update_id: updateId, message: { message_id: 1, from: { id: 42, is_bot: false }, chat: { id: 42, type: "private" }, date: 1, ...extra } });
const post = (body: string, { id = ACCOUNT, secret = "right_secret" as string | null } = {}) =>
  POST(
    new NextRequest(`http://localhost/api/webhooks/telegram/${id}`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    }),
    { params: Promise.resolve({ accountId: id }) },
  );
const runAfter = async () => {
  for (const task of afterTasks.splice(0)) await task();
};

beforeEach(() => {
  afterTasks.length = 0;
  received.length = 0;
  texts.length = 0;
  lookups.length = 0;
});

describe("POST /api/webhooks/telegram/[accountId]", () => {
  it("rejects a missing or wrong secret token before doing anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(update({ text: "hi" }), { secret: null })).status).toBe(401);
    expect((await post(update({ text: "hi" }), { secret: "wrong_secret" })).status).toBe(401);
    expect(afterTasks).toHaveLength(0);
    warn.mockRestore();
  });

  it("logs and ignores an unknown or malformed account id with 200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(update({ text: "hi" }), { id: "b0000000-0000-4000-8000-000000000009" })).status).toBe(200);
    expect((await post(update({ text: "hi" }), { id: "not-a-uuid" })).status).toBe(200);
    expect(afterTasks).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("telegram: unknown account b0000000-0000-4000-8000-000000000009, update ignored");
    expect(lookups).toContainEqual(["channel", "telegram"]);
    warn.mockRestore();
  });

  it("answers 200 at once and hands the message to the shared pipeline afterwards, in the bot's shop", async () => {
    const res = await post(update({ text: "Váy size M còn không?" }));
    expect(res.status).toBe(200);
    expect(received).toHaveLength(0);
    await runAfter();
    const [account, incoming, onThinking] = received[0];
    expect(account).toEqual({ id: ACCOUNT, shopId: "shop-a", channel: "telegram" });
    expect(incoming).toEqual({ externalId: "42", messageId: "1001", text: "Váy size M còn không?" });
    expect(typeof onThinking).toBe("function");
  });

  it("greets /start without calling the AI, and passes photos on", async () => {
    await post(update({ text: "/start" }));
    await post(update({ photo: [{ file_id: "s" }, { file_id: "l" }] }, 1002));
    await runAfter();
    expect(texts).toEqual([["123:bot", "42", expect.stringContaining("Mây Boutique")]]);
    expect(received.map((r) => r[1])).toEqual([{ externalId: "42", messageId: "1002", imageUrls: ["tg-file:l"] }]);
  });

  it("acknowledges updates it doesn't use (edits, groups) with 200 and does nothing", async () => {
    expect((await post(JSON.stringify({ update_id: 5, edited_message: { text: "x" } }))).status).toBe(200);
    expect(afterTasks).toHaveLength(0);
  });
});
