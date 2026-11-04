import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Reply } from "@/contract";

// A small stand-in for the Supabase query builder: records every call in order
// and returns canned results.
type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
let conversationRow: unknown;
let currentMode: string;
let insertResult: { data: unknown; error: unknown };

function builder(table: string) {
  const ops: Call[] = [];
  const record = (op: string) => (...args: unknown[]) => {
    const call = { table, op, args };
    calls.push(call);
    ops.push(call);
    return chain;
  };
  const chain = {
    select: record("select"),
    insert: record("insert"),
    update: record("update"),
    eq: record("eq"),
    maybeSingle: async () => {
      if (!ops.some((c) => c.op === "update")) return { data: conversationRow, error: null };
      // The update matches only if every `.eq("mode", x)` filter matches the current mode.
      const modeFilter = ops.find((c) => c.op === "eq" && c.args[0] === "mode");
      const matches = !modeFilter || modeFilter.args[1] === currentMode;
      return { data: matches ? { id: "c1" } : null, error: null };
    },
    single: async () => insertResult,
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));

const send = vi.fn();
vi.mock("./adapters", () => ({
  adapters: new Proxy(
    {},
    {
      get: (_t, channel) => (...args: unknown[]) => {
        calls.push({ table: "-", op: "adapter", args });
        return send(channel, ...args);
      },
    },
  ),
}));

const { sendToConversation } = await import("./send");

const reply: Reply = { text: "Dạ còn size M ạ", products: [], quickReplies: ["Đặt luôn"] };
const shopA = "a0000000-0000-4000-8000-000000000001";
const messageInsert = () => calls.find((c) => c.table === "messages" && c.op === "insert");

beforeEach(() => {
  calls.length = 0;
  send.mockReset();
  send.mockResolvedValue(undefined);
  currentMode = "ai";
  conversationRow = {
    id: "c1",
    shop_id: shopA,
    shoppers: {
      channel: "messenger",
      external_id: "psid-1",
      channel_accounts: { id: "acc-1", external_account_id: "page-1", access_token: "token" },
    },
  };
  insertResult = { data: { id: "m1" }, error: null };
});

describe("sendToConversation", () => {
  it("stores the message, then sends it with the adapter of the shopper's channel", async () => {
    const result = await sendToConversation("c1", reply, { from: "ai" });

    expect(result).toEqual({ ok: true, messageId: "m1" });
    expect(messageInsert()?.args[0]).toMatchObject({
      shop_id: shopA,
      conversation_id: "c1",
      sender: "ai",
      staff_id: null,
      text: reply.text,
      reply,
    });
    expect(send).toHaveBeenCalledWith(
      "messenger",
      {
        channel: "messenger",
        externalId: "psid-1",
        channelAccount: { id: "acc-1", externalAccountId: "page-1", accessToken: "token" },
      },
      reply,
    );
    const insertAt = calls.findIndex((c) => c.op === "insert");
    expect(insertAt).toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(calls.findIndex((c) => c.op === "adapter"));
  });

  it("drops an AI reply when staff took over meanwhile, and stores nothing", async () => {
    currentMode = "staff";
    const result = await sendToConversation("c1", reply, { from: "ai" });
    expect(result).toEqual({ ok: false, messageId: null, error: "not_in_ai_mode" });
    expect(messageInsert()).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("drops an AI reply while the conversation waits for staff (needs_human)", async () => {
    currentMode = "needs_human";
    const result = await sendToConversation("c1", reply, { from: "ai" });
    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends staff and system messages in any mode", async () => {
    currentMode = "staff";
    expect(await sendToConversation("c1", reply, { from: "staff", staffId: "s1" })).toEqual({
      ok: true,
      messageId: "m1",
    });
    expect(messageInsert()?.args[0]).toMatchObject({ sender: "staff", staff_id: "s1" });
    currentMode = "needs_human";
    expect((await sendToConversation("c1", reply, { from: "system" })).ok).toBe(true);
  });

  it("keeps the message and returns the error when the channel refuses it", async () => {
    send.mockRejectedValue(new Error("outside the 24-hour window"));
    const result = await sendToConversation("c1", reply, { from: "staff", staffId: "s1" });
    expect(result).toEqual({ ok: false, messageId: "m1", error: "outside the 24-hour window" });
    expect(messageInsert()).toBeDefined();
  });

  it("filters the conversation update by shop_id (the secret key bypasses RLS)", async () => {
    await sendToConversation("c1", reply, { from: "ai" });
    const eqs = calls.filter((c) => c.table === "conversations" && c.op === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["shop_id", shopA]);
  });

  it("returns conversation_not_found and sends nothing for an unknown conversation", async () => {
    conversationRow = null;
    const result = await sendToConversation("nope", reply, { from: "ai" });
    expect(result).toEqual({ ok: false, messageId: null, error: "conversation_not_found" });
    expect(send).not.toHaveBeenCalled();
  });

  it("throws on a reply that doesn't match the shared shape (a caller bug)", async () => {
    await expect(
      sendToConversation("c1", { text: "x", products: [], quickReplies: ["a".repeat(21)] }, { from: "ai" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
