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
      const data = run().data ?? [];
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: query,
    storage: { from: () => ({ remove: async (paths: string[]) => (removed.push(paths), { data: [], error: null }) }) },
  }),
}));

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

// PB-17: the limit itself is tested in src/lib/guard/rate-limit.test.ts; here only
// that receive.ts asks it, and stops before the AI when it says no.
// PB-30: photo storage is tested in src/lib/chat/photo-store.test.ts; here a
// photo of 0 bytes stands for one that is not an accepted photo.
const stored: string[] = [];
const removed: string[][] = [];
vi.mock("@/lib/chat/photo-store", () => ({
  PHOTO_BUCKET: "chat-photos",
  storeShopperPhoto: async (_db: unknown, a: { shopId: string; conversationId: string; bytes: Uint8Array }) => {
    if (a.bytes.length === 0) return null;
    const path = `${a.shopId}/${a.conversationId}/p${stored.length + 1}.jpg`;
    stored.push(path);
    return path;
  },
}));

const rateLimited = vi.fn<(target: { shopId: string; conversationId: string }) => Promise<boolean>>();
vi.mock("@/lib/guard/rate-limit", () => ({ replyIfRateLimited: (target: { shopId: string; conversationId: string }) => rateLimited(target) }));

const { receiveChannelMessage, HANDOFF_TEXT, PHOTO_HANDOFF_TEXT, PHOTO_NOT_KEPT_TEXT } = await import("./receive");

const account = { id: "acc-a", shopId: "shop-a", channel: "messenger" as const };
const answer: Reply = { text: "Dạ size M vừa bạn ạ", products: [], quickReplies: ["Size M màu Be"] };
const text = (messageId: string, t = "Váy suông linen size nào vừa 1m58?") => ({ externalId: "psid-1", messageId, text: t });
const conversation = () => tables.conversations[0];
const shopperMessages = () => (tables.messages ?? []).filter((m) => m.sender === "shopper");

beforeEach(() => {
  tables = {};
  nextId = 1;
  sent.length = 0;
  stored.length = 0;
  removed.length = 0;
  sendResult = () => ({ ok: true, messageId: "m" });
  engine.mockReset().mockResolvedValue({ reply: answer, personalReplyNeeded: false });
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

  const jpeg = () => vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 1]));
  const notAPhoto = () => vi.fn(async () => new Uint8Array(0));

  it("stores a photo message with its paths and sends text and photoPaths in history to the engine", async () => {
    const photo = { externalId: "psid-1", messageId: "mid-1", text: "", photos: [jpeg()] };
    expect(await receiveChannelMessage(account, photo)).toBe("answered");
    const path = `shop-a/${conversation().id}/p1.jpg`;
    expect(shopperMessages()).toMatchObject([{ text: "", photo_paths: [path] }]);
    const [input] = engine.mock.calls[0] as unknown as [{ history: unknown[] }];
    expect(input.history).toEqual([{ sender: "shopper", text: "", photoPaths: [path] }]);
  });

  it("photo plus text is one message row and one rate-limit count", async () => {
    await receiveChannelMessage(account, { externalId: "psid-1", messageId: "mid-1", text: "mẫu này còn không?", photos: [jpeg(), jpeg()] });
    expect(shopperMessages()).toHaveLength(1);
    expect(shopperMessages()[0].photo_paths).toHaveLength(2);
    expect(rateLimited).toHaveBeenCalledTimes(1);
  });

  it("duplicate channel message never loads its photos", async () => {
    await receiveChannelMessage(account, text("mid-1"));
    const source = jpeg();
    expect(await receiveChannelMessage(account, { externalId: "psid-1", messageId: "mid-1", text: "", photos: [source] })).toBe("duplicate");
    expect(source).not.toHaveBeenCalled();
  });

  it("a photo that fails to load or check is skipped; with no text and no valid photo the conversation goes to staff", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async (): Promise<Uint8Array> => Promise.reject(new Error("timeout")));
    expect(await receiveChannelMessage(account, { externalId: "psid-1", messageId: "mid-1", text: "", photos: [failing, notAPhoto()] })).toBe("handed_off");
    // Staff still see that a photo came, not an empty message.
    expect(shopperMessages()).toMatchObject([{ text: PHOTO_NOT_KEPT_TEXT, photo_paths: [] }]);
    expect(engine).not.toHaveBeenCalled();
    expect(conversation().mode).toBe("needs_human");
    expect(sent.map((s) => [s.reply.text, s.from])).toEqual([[PHOTO_HANDOFF_TEXT, "system"]]);
    warn.mockRestore();
  });

  it("a photo the channel only names (WhatsApp media id) is stored as a note for staff, and the conversation goes to staff", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unavailable = async (): Promise<Uint8Array> => Promise.reject(new Error("not downloaded"));
    expect(
      await receiveChannelMessage(account, { externalId: "psid-1", messageId: "mid-1", text: "", photos: [unavailable], photoRefs: ["whatsapp-media:M1"] }),
    ).toBe("handed_off");
    expect(shopperMessages()).toMatchObject([{ text: `${PHOTO_NOT_KEPT_TEXT} whatsapp-media:M1`, photo_paths: [] }]);
    expect(sent.map((s) => [s.reply.text, s.from])).toEqual([[PHOTO_HANDOFF_TEXT, "system"]]);
    warn.mockRestore();
  });

  it("a bad photo with text: the text still reaches the AI", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await receiveChannelMessage(account, { externalId: "psid-1", messageId: "mid-1", text: "váy này còn không?", photos: [notAPhoto()] })).toBe("answered");
    warn.mockRestore();
  });

  it("keeps at most 4 photos of one message", async () => {
    await receiveChannelMessage(account, { externalId: "psid-1", messageId: "mid-1", text: "", photos: [1, 2, 3, 4, 5].map(() => jpeg()) });
    expect(shopperMessages()[0].photo_paths).toHaveLength(4);
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
    const photo = { externalId: "psid-1", messageId: "mid-1", text: "", photos: [vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 1]))] };
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

  it("a retried web message with a photo removes the photo it uploaded again", async () => {
    const photo = () => ({ ...webText("c-1"), photos: [vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 1]))] });
    await receiveChannelMessage(web, photo());
    expect(await receiveChannelMessage(web, photo())).toBe("duplicate");
    expect(removed).toEqual([[stored[1]]]);
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
