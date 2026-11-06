import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineOutput, Reply } from "@/contract";

// A tiny in-memory stand-in for the Supabase tables receive.ts touches.
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let nextId: number;

function query(table: string) {
  const filters: [string, unknown][] = [];
  let op: { kind: "select" | "insert" | "upsert" | "update"; row?: Row; onConflict?: string } = { kind: "select" };
  let returning = false;
  let limit = Infinity;
  let descending = false;
  const rows = () => (tables[table] ??= []);
  const matches = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const run = () => {
    if (op.kind === "insert" || op.kind === "upsert") {
      const keys = op.onConflict?.split(",") ?? [];
      const clash = keys.length > 0 && rows().some((r) => keys.every((k) => r[k] === op.row![k]));
      if (clash) return { data: [], error: null };
      const row = { id: `${table}-${nextId++}`, created_at: String(nextId).padStart(4, "0"), ...defaults(table), ...op.row };
      rows().push(row);
      return { data: [row], error: null };
    }
    if (op.kind === "update") {
      const hit = rows().filter(matches);
      hit.forEach((r) => Object.assign(r, op.row));
      return { data: hit, error: null };
    }
    let found = rows().filter(matches);
    if (descending) found = [...found].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { data: found.slice(0, limit), error: null };
  };
  const chain = {
    select: () => ((returning = op.kind !== "select"), chain),
    insert: (row: Row) => ((op = { kind: "insert", row }), chain),
    upsert: (row: Row, o: { onConflict: string }) => ((op = { kind: "upsert", row, onConflict: o.onConflict }), chain),
    update: (row: Row) => ((op = { kind: "update", row }), chain),
    eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
    match: (o: Row) => (Object.entries(o).forEach((e) => filters.push(e)), chain),
    order: (_k: string, o: { ascending: boolean }) => ((descending = !o.ascending), chain),
    limit: (n: number) => ((limit = n), chain),
    single: async () => {
      const { data } = run();
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `${data.length} rows` } };
    },
    then: (resolve: (v: unknown) => void) => {
      const result = run();
      resolve(returning || op.kind === "select" ? result : { data: null, error: null });
    },
  };
  return chain;
}
const defaults = (table: string): Row => (table === "conversations" ? { mode: "ai" } : {});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));

const sent: { conversationId: string; reply: Reply; from: string }[] = [];
let sendResult: (from: string) => { ok: true; messageId: string } | { ok: false; messageId: null; error: string };
vi.mock("./send", () => ({
  sendToConversation: async (conversationId: string, reply: Reply, sender: { from: string }) => {
    sent.push({ conversationId, reply, from: sender.from });
    return sendResult(sender.from);
  },
}));

const engine = vi.fn<() => Promise<EngineOutput>>();
vi.mock("@/lib/engine/run", () => ({ runEngine: (...args: unknown[]) => engine(...(args as [])) }));

const { receiveChannelMessage, HANDOFF_TEXT, PHOTO_HANDOFF_TEXT } = await import("./receive");

const account = { id: "acc-a", shopId: "shop-a", channel: "messenger" as const };
const answer: Reply = { text: "Dạ size M vừa bạn ạ", products: [], quickReplies: ["Size M màu Be"] };
const text = (messageId: string, t = "Váy suông linen size nào vừa 1m58?") => ({ externalId: "psid-1", messageId, text: t });
const conversation = () => tables.conversations[0];
const shopperMessages = () => (tables.messages ?? []).filter((m) => m.sender === "shopper");

beforeEach(() => {
  tables = {};
  nextId = 1;
  sent.length = 0;
  sendResult = () => ({ ok: true, messageId: "m" });
  engine.mockReset().mockResolvedValue({ reply: answer, personalReplyNeeded: false });
});

describe("receiveChannelMessage", () => {
  it("creates the shopper and conversation in the account's shop, stores the message, and answers", async () => {
    const thinking = vi.fn(async () => {});
    expect(await receiveChannelMessage(account, text("mid-1"), thinking)).toBe("answered");

    expect(tables.shoppers).toMatchObject([{ shop_id: "shop-a", channel: "messenger", external_id: "psid-1", channel_account_id: "acc-a" }]);
    expect(conversation()).toMatchObject({ shop_id: "shop-a", mode: "ai" });
    expect(shopperMessages()).toMatchObject([{ shop_id: "shop-a", text: "Váy suông linen size nào vừa 1m58?" }]);
    expect(engine).toHaveBeenCalledWith({
      mode: "customer",
      conversationId: conversation().id,
      history: [{ sender: "shopper", text: "Váy suông linen size nào vừa 1m58?" }],
    });
    expect(thinking).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ conversationId: conversation().id, reply: answer, from: "ai" }]);
  });

  it("answers a message delivered twice only once", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("duplicate");
    expect(shopperMessages()).toHaveLength(1);
    expect(engine).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
  });

  it("keeps one conversation per shopper and sends the history oldest first", async () => {
    await receiveChannelMessage(account, text("mid-1", "câu 1"));
    tables.messages.push({ id: "ai-1", shop_id: "shop-a", conversation_id: conversation().id, sender: "ai", text: "trả lời 1", created_at: String(++nextId).padStart(4, "0") });
    await receiveChannelMessage(account, text("mid-2", "câu 2"));
    expect(tables.conversations).toHaveLength(1);
    expect(engine.mock.calls[1]).toEqual([
      expect.objectContaining({
        history: [
          { sender: "shopper", text: "câu 1" },
          { sender: "ai", text: "trả lời 1" },
          { sender: "shopper", text: "câu 2" },
        ],
      }),
    ]);
  });

  it.each(["staff", "needs_human"])("stores the message but stays silent while the conversation is %s", async (mode) => {
    await receiveChannelMessage(account, text("mid-1"));
    conversation().mode = mode;
    sent.length = 0;
    expect(await receiveChannelMessage(account, text("mid-2"))).toBe("stored");
    expect(shopperMessages()).toHaveLength(2);
    expect(engine).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
    expect(conversation().mode).toBe(mode);
  });

  it("hands off to staff with a notice when the engine fails", async () => {
    engine.mockRejectedValue(new Error("not_implemented"));
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("handed_off");
    expect(conversation().mode).toBe("needs_human");
    expect(sent).toEqual([{ conversationId: conversation().id, reply: { text: HANDOFF_TEXT, products: [], quickReplies: [] }, from: "system" }]);
  });

  it("hands a photo to staff, keeping its link for the inbox, without calling the AI", async () => {
    const photo = { externalId: "psid-1", messageId: "mid-1", imageUrls: ["https://x/1.jpg"] };
    expect(await receiveChannelMessage(account, photo)).toBe("handed_off");
    expect(shopperMessages()).toMatchObject([{ text: "[Khách gửi ảnh] https://x/1.jpg" }]);
    expect(engine).not.toHaveBeenCalled();
    expect(conversation().mode).toBe("needs_human");
    expect(sent.map((s) => [s.reply.text, s.from])).toEqual([[PHOTO_HANDOFF_TEXT, "system"]]);
  });

  it("sends the engine's closing reply as a system message when the engine handed off in this turn", async () => {
    engine.mockImplementation(async () => {
      conversation().mode = "needs_human";
      return { reply: answer, personalReplyNeeded: false };
    });
    sendResult = (from) => (from === "ai" ? { ok: false, messageId: null, error: "not_in_ai_mode" } : { ok: true, messageId: "m" });
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("handed_off");
    expect(sent.map((s) => s.from)).toEqual(["ai", "system"]);
    expect(sent[1].reply).toEqual(answer);
  });

  it("drops the AI reply when staff took over during the turn", async () => {
    engine.mockImplementation(async () => {
      conversation().mode = "staff";
      return { reply: answer, personalReplyNeeded: false };
    });
    sendResult = () => ({ ok: false, messageId: null, error: "not_in_ai_mode" });
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("stored");
    expect(sent.map((s) => s.from)).toEqual(["ai"]);
  });

  it("keeps two shops apart: the same shopper id in another shop is another shopper", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    await receiveChannelMessage({ id: "acc-b", shopId: "shop-b", channel: "messenger" }, text("mid-1"));
    expect(tables.shoppers.map((s) => s.shop_id)).toEqual(["shop-a", "shop-b"]);
    expect(tables.conversations.map((c) => c.shop_id)).toEqual(["shop-a", "shop-b"]);
  });
});
