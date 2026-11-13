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
      // messages: unique (conversation_id, client_message_id), web chat's dedupe key.
      const r = op.row!;
      if (table === "messages" && r.client_message_id != null &&
        rows().some((m) => m.conversation_id === r.conversation_id && m.client_message_id === r.client_message_id)) {
        return { data: null, error: { code: "23505", message: "duplicate key value" } };
      }
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
      const result = run();
      if (result.error) return result; // as Supabase: the insert's error, e.g. 23505
      const data = result.data ?? [];
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `${data.length} rows` } };
    },
    then: (resolve: (v: unknown) => void) => {
      const result = run();
      resolve(returning || op.kind === "select" || result.error ? result : { data: null, error: null });
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
    log.push(`send ${sender.from}`);
    return sendResult(sender.from);
  },
}));

const engine = vi.fn<() => Promise<EngineOutput>>();
// What runCustomerTurn adds to the engine's output (R3).
let orderWritten: boolean;
let handedOff: boolean;
let turnId: string | null;
vi.mock("@/lib/engine/run", () => ({
  runCustomerTurn: async (...args: unknown[]) => ({
    output: await engine(...(args as [])),
    orderWritten,
    handedOff,
    turnRow: Promise.resolve(turnId),
  }),
}));
// Each mark, in order with the sends (log), so "marked before the send" is checkable.
const log: string[] = [];
const markTurn = vi.fn(async (_db: unknown, _shopId: string, id: string, outcome: string) => { log.push(`mark ${id} ${outcome}`); });
vi.mock("@/lib/engine/store", () => ({ markTurn: (...args: [unknown, string, string, string]) => markTurn(...args) }));
const marks = () => markTurn.mock.calls.map((c) => [c[1], c[2], c[3]]);

// PB-17: the limit itself is tested in src/lib/guard/rate-limit.test.ts; here only
// that receive.ts asks it, and stops before the AI when it says no.
const rateLimited = vi.fn<(target: { shopId: string; conversationId: string }) => Promise<boolean>>();
vi.mock("@/lib/guard/rate-limit", () => ({ replyIfRateLimited: (target: { shopId: string; conversationId: string }) => rateLimited(target) }));

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
  orderWritten = false;
  handedOff = false;
  turnId = "turn-1";
  log.length = 0;
  markTurn.mockClear();
  rateLimited.mockReset().mockResolvedValue(false);
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
      // #8: the stored message's id, so a resume from needs_human checks it is still the newest
      messageId: shopperMessages()[0].id,
      history: [{ sender: "shopper", text: "Váy suông linen size nào vừa 1m58?" }],
      productId: null,
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

  it("answers a WhatsApp message delivered twice only once (same wamid, PB-27)", async () => {
    const whatsapp = { id: "acc-wa", shopId: "shop-a", channel: "whatsapp" as const };
    const message = { externalId: "84901234567", messageId: "wamid.HBgL1", text: "Váy còn size M không?" };
    expect(await receiveChannelMessage(whatsapp, message)).toBe("answered");
    expect(await receiveChannelMessage(whatsapp, message)).toBe("duplicate");
    expect(tables.channel_events).toMatchObject([{ channel_account_id: "acc-wa", external_message_id: "wamid.HBgL1", shop_id: "shop-a" }]);
    expect(tables.shoppers).toMatchObject([{ channel: "whatsapp", external_id: "84901234567", channel_account_id: "acc-wa" }]);
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

  it("stores the message but stays silent while the conversation is in staff mode", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    conversation().mode = "staff";
    sent.length = 0;
    expect(await receiveChannelMessage(account, text("mid-2"))).toBe("stored");
    expect(shopperMessages()).toHaveLength(2);
    expect(engine).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
    expect(conversation().mode).toBe("staff");
  });

  it("auto-resumes and answers when a needs_human conversation gets an answerable question", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    conversation().mode = "needs_human";
    sent.length = 0;
    expect(await receiveChannelMessage(account, text("mid-2"))).toBe("answered");
    expect(shopperMessages()).toHaveLength(2);
    expect(engine).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([{ conversationId: conversation().id, reply: answer, from: "ai" }]);
  });

  it("stays in needs_human and does not repeat handoff notice when needs_human turn cannot be answered", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    conversation().mode = "needs_human";
    sent.length = 0;
    sendResult = (from) => (from === "ai" ? { ok: false, messageId: null, error: "not_in_ai_mode" } : { ok: true, messageId: "m" });
    expect(await receiveChannelMessage(account, text("mid-2"))).toBe("stored");
    expect(sent).toHaveLength(1);
    expect(conversation().mode).toBe("needs_human");
  });

  it("answers again once staff hand the conversation back to the AI (PB-13)", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    conversation().mode = "staff";
    expect(await receiveChannelMessage(account, text("mid-2"))).toBe("stored");
    conversation().mode = "ai"; // "Trả lại cho AI"
    sent.length = 0;
    expect(await receiveChannelMessage(account, text("mid-3"))).toBe("answered");
    expect(engine).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([{ conversationId: conversation().id, reply: answer, from: "ai" }]);
  });

  it("hands off to staff with a notice when the engine fails", async () => {
    engine.mockRejectedValue(new Error("not_implemented"));
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("handed_off");
    expect(conversation().mode).toBe("needs_human");
    expect(sent).toEqual([{ conversationId: conversation().id, reply: { text: HANDOFF_TEXT, products: [], quickReplies: [] }, from: "system" }]);
  });

  it("sends the handoff notice once when another turn already handed off (two messages at once)", async () => {
    engine.mockImplementation(async () => {
      conversation().mode = "needs_human"; // the other turn got there first
      throw new Error("not_implemented");
    });
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("stored");
    expect(sent).toEqual([]);
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
    handedOff = true;
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

  it("checks the rate limit for this shop and conversation after storing the message", async () => {
    rateLimited.mockImplementation(async () => {
      expect(shopperMessages()).toHaveLength(1); // stored first, so it counts
      return false;
    });
    await receiveChannelMessage(account, text("mid-1"));
    expect(rateLimited).toHaveBeenCalledWith({ shopId: "shop-a", conversationId: conversation().id });
  });

  it("does not call the AI for a message over the rate limit (PB-17)", async () => {
    rateLimited.mockResolvedValue(true);
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("rate_limited");
    expect(shopperMessages()).toHaveLength(1); // still in the inbox
    expect(engine).not.toHaveBeenCalled();
    expect(sent).toEqual([]); // the "please wait" reply is sent by replyIfRateLimited itself
    expect(conversation().mode).toBe("ai");
  });

  it("does not hand a photo to staff when the shopper is over the rate limit", async () => {
    rateLimited.mockResolvedValue(true);
    const photo = { externalId: "psid-1", messageId: "mid-1", imageUrls: ["https://x/1.jpg"] };
    expect(await receiveChannelMessage(account, photo)).toBe("rate_limited");
    expect(conversation().mode).toBe("ai");
  });

  it("does not count messages while the conversation is in staff mode", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    conversation().mode = "staff";
    rateLimited.mockClear();
    await receiveChannelMessage(account, text("mid-2"));
    expect(rateLimited).not.toHaveBeenCalled();
  });

  it("keeps two shops apart: the same shopper id in another shop is another shopper", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    await receiveChannelMessage({ id: "acc-b", shopId: "shop-b", channel: "messenger" }, text("mid-1"));
    expect(tables.shoppers.map((s) => s.shop_id)).toEqual(["shop-a", "shop-b"]);
    expect(tables.conversations.map((c) => c.shop_id)).toEqual(["shop-a", "shop-b"]);
  });
});

describe("receiveChannelMessage on web chat (PB-04)", () => {
  const web = { channel: "web" as const, shopId: "shop-a" };
  const webText = (clientMessageId: string, t = "Váy này còn size M không?", productId: string | null = null) => ({
    externalId: "cookie-hash-1",
    messageId: clientMessageId,
    text: t,
    productId,
  });

  it("creates a web shopper with no channel account and never touches channel_events", async () => {
    expect(await receiveChannelMessage(web, webText("c-1"))).toBe("answered");
    expect(tables.shoppers).toMatchObject([{ shop_id: "shop-a", channel: "web", external_id: "cookie-hash-1", channel_account_id: null }]);
    expect(tables.channel_events).toBeUndefined();
    expect(shopperMessages()).toMatchObject([{ client_message_id: "c-1", text: "Váy này còn size M không?" }]);
  });

  it("passes the product being asked about to the engine", async () => {
    const productId = "11111111-1111-4111-8111-111111111111";
    await receiveChannelMessage(web, webText("c-1", "Váy này còn size M không?", productId));
    expect(engine).toHaveBeenCalledWith(expect.objectContaining({ mode: "customer", productId }));
  });

  it("dedupes a retried send by clientMessageId", async () => {
    await receiveChannelMessage(web, webText("c-1"));
    expect(await receiveChannelMessage(web, webText("c-1"))).toBe("duplicate");
    expect(shopperMessages()).toHaveLength(1);
    expect(engine).toHaveBeenCalledOnce();
    expect(await receiveChannelMessage(web, webText("c-2"))).toBe("answered");
    expect(shopperMessages()).toHaveLength(2);
  });

  it("stores but does not answer once staff took over", async () => {
    await receiveChannelMessage(web, webText("c-1"));
    conversation().mode = "staff";
    expect(await receiveChannelMessage(web, webText("c-2"))).toBe("stored");
    expect(engine).toHaveBeenCalledOnce();
  });

  it("applies the PB-17 rate limit", async () => {
    rateLimited.mockResolvedValue(true);
    expect(await receiveChannelMessage(web, webText("c-1"))).toBe("rate_limited");
    expect(engine).not.toHaveBeenCalled();
  });
});

describe("only the newest shopper message gets a reply (R3)", () => {
  // Another request stores a newer shopper message while this turn's engine runs.
  const newerMessageArrives = (t = "size M nha") => {
    tables.messages.push({
      id: `messages-${nextId++}`, shop_id: "shop-a", conversation_id: conversation().id,
      sender: "shopper", text: t, created_at: String(++nextId).padStart(4, "0"),
    });
  };

  it("older turn finishing after a newer shopper message sends nothing (Review Focus 5)", async () => {
    engine.mockImplementationOnce(async () => {
      newerMessageArrives();
      return { reply: answer, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1", "Váy babydoll còn màu gì?"))).toBe("superseded");
    expect(sent).toEqual([]);
    // Its logged turn is marked, so the next turn ignores its offer or quote.
    expect(marks()).toEqual([["shop-a", "turn-1", "superseded"]]);
  });

  it("a sent reply's turn is marked delivered only after the send", async () => {
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("answered");
    expect(log).toEqual(["send ai", "mark turn-1 delivered"]);
  });

  it("a failed send leaves the turn pending (no mark), so the next turn never builds on it", async () => {
    sendResult = () => ({ ok: false, messageId: null, error: "insert failed" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("answered");
    error.mockRestore();
    expect(markTurn).not.toHaveBeenCalled();
  });

  it("another turn's handoff (a photo) does not make this turn's reply a closing message", async () => {
    sendResult = (from) => (from === "ai" ? { ok: false, messageId: null, error: "not_in_ai_mode" } : { ok: true, messageId: "m" });
    engine.mockImplementationOnce(async () => {
      newerMessageArrives("[ảnh]");
      conversation().mode = "needs_human"; // the photo turn's handOff()
      return { reply: answer, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1", "Váy này có size L không?"))).toBe("superseded");
    expect(sent).toEqual([]);
    expect(marks()).toEqual([["shop-a", "turn-1", "superseded"]]);
  });

  it("another turn's handoff with no newer message: the reply is not sent as a system message", async () => {
    sendResult = (from) => (from === "ai" ? { ok: false, messageId: null, error: "not_in_ai_mode" } : { ok: true, messageId: "m" });
    engine.mockImplementationOnce(async () => {
      conversation().mode = "needs_human";
      return { reply: answer, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("stored");
    expect(sent.filter((m) => m.from === "system")).toEqual([]);
    expect(marks()).toEqual([["shop-a", "turn-1", "superseded"]]);
  });

  it("staff took over before the send: the unsent reply's turn is marked superseded", async () => {
    sendResult = (from) => (from === "ai" ? { ok: false, messageId: null, error: "not_in_ai_mode" } : { ok: true, messageId: "m" });
    engine.mockImplementationOnce(async () => {
      conversation().mode = "staff";
      return { reply: answer, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("stored");
    expect(marks().at(-1)).toEqual(["shop-a", "turn-1", "superseded"]);
    expect(sent.filter((m) => m.from === "system")).toEqual([]);
  });

  it("an order write's outcome reaches the shopper even when the shopper wrote again and staff took over", async () => {
    const created: Reply = { text: "Dạ shop đã tạo đơn nháp cho bạn", products: [], quickReplies: [] };
    orderWritten = true;
    sendResult = (from) => (from === "ai" ? { ok: false, messageId: null, error: "not_in_ai_mode" } : { ok: true, messageId: "m" });
    engine.mockImplementationOnce(async () => {
      newerMessageArrives("à cho mình hỏi thêm");
      conversation().mode = "staff";
      return { reply: created, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1", "Xác nhận đơn"))).toBe("answered");
    expect(sent.filter((m) => m.from === "system")).toEqual([{ conversationId: conversation().id, reply: created, from: "system" }]);
    expect(marks()).toEqual([["shop-a", "turn-1", "delivered"]]);
  });

  it("a superseded turn whose log failed marks nothing", async () => {
    turnId = null;
    engine.mockImplementationOnce(async () => {
      newerMessageArrives();
      return { reply: answer, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("superseded");
    expect(markTurn).not.toHaveBeenCalled();
  });

  it("a turn that wrote an order still sends its reply when the shopper wrote again, and is not marked", async () => {
    const created: Reply = { text: "Dạ shop đã tạo đơn nháp cho bạn", products: [], quickReplies: [] };
    orderWritten = true;
    engine.mockImplementationOnce(async () => {
      newerMessageArrives("à cho mình hỏi thêm");
      return { reply: created, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1", "Xác nhận đơn"))).toBe("answered");
    expect(sent).toEqual([{ conversationId: conversation().id, reply: created, from: "ai" }]);
    expect(marks()).toEqual([["shop-a", "turn-1", "delivered"]]);
  });

  it("the newest turn still sends, with both messages in its history", async () => {
    engine.mockImplementationOnce(async () => {
      newerMessageArrives("size M nha");
      return { reply: answer, personalReplyNeeded: false };
    });
    await receiveChannelMessage(account, text("mid-1", "Váy babydoll còn màu gì?"));
    // The newer message's own turn (delivered by the channel as mid-2).
    tables.messages.pop();
    expect(await receiveChannelMessage(account, text("mid-2", "size M nha"))).toBe("answered");
    expect(engine.mock.calls[1]).toEqual([
      expect.objectContaining({
        history: [
          { sender: "shopper", text: "Váy babydoll còn màu gì?" },
          { sender: "shopper", text: "size M nha" },
        ],
      }),
    ]);
    expect(sent).toEqual([{ conversationId: conversation().id, reply: answer, from: "ai" }]);
  });

  it("an AI message stored meanwhile does not supersede the turn", async () => {
    engine.mockImplementationOnce(async () => {
      tables.messages.push({ id: "ai-x", shop_id: "shop-a", conversation_id: conversation().id, sender: "ai", text: "x", created_at: String(++nextId).padStart(4, "0") });
      return { reply: answer, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1"))).toBe("answered");
    expect(sent).toHaveLength(1);
  });

  it("a superseded turn that handed off leaves the conversation in needs_human and still tells the shopper", async () => {
    const closing: Reply = { text: "Dạ mình đã chuyển cho nhân viên shop", products: [], quickReplies: [] };
    sendResult = (from) => (from === "ai" ? { ok: false, messageId: null, error: "not_in_ai_mode" } : { ok: true, messageId: "m" });
    handedOff = true;
    engine.mockImplementationOnce(async () => {
      conversation().mode = "needs_human"; // the engine's handoff_to_staff
      newerMessageArrives("alo shop");
      return { reply: closing, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1", "Hàng bị rách, mình bực quá"))).toBe("handed_off");
    expect(marks()).toEqual([["shop-a", "turn-1", "delivered"]]);
    expect(conversation().mode).toBe("needs_human");
    expect(sent.filter((m) => m.from === "system")).toEqual([{ conversationId: conversation().id, reply: closing, from: "system" }]);
  });

  it("a superseded turn in a conversation already waiting for staff sends nothing", async () => {
    await receiveChannelMessage(account, text("mid-0", "câu trước"));
    conversation().mode = "needs_human";
    sent.length = 0;
    engine.mockImplementationOnce(async () => {
      newerMessageArrives("alo shop");
      return { reply: answer, personalReplyNeeded: false };
    });
    expect(await receiveChannelMessage(account, text("mid-1", "ok cảm ơn"))).toBe("superseded");
    expect(sent).toEqual([]);
  });
});
