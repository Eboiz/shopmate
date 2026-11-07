import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Reply } from "@/contract";
import { RATE_LIMIT_REPLY } from "./rate-limit-rule";

// PB-17 counting, run in CI without a database: an in-memory `messages` table that
// applies the same filters the real query sends (eq, gte, count with head).
type Message = { shop_id: string; conversation_id: string; sender: string; created_at: string };
let messages: Message[];
let readError: { message: string } | null;

function countQuery() {
  const filters: ((m: Message) => boolean)[] = [];
  const chain = {
    select: (_columns: string, options: { count: string; head: boolean }) => {
      expect(options).toEqual({ count: "exact", head: true }); // count only, no rows over the wire
      return chain;
    },
    eq: (key: keyof Message, value: string) => (filters.push((m) => m[key] === value), chain),
    gte: (key: keyof Message, value: string) => (filters.push((m) => m[key] >= value), chain),
    then: (resolve: (v: unknown) => void) =>
      resolve(
        readError
          ? { count: null, error: readError }
          : { count: messages.filter((m) => filters.every((f) => f(m))).length, error: null },
      ),
  };
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => (expect(table).toBe("messages"), countQuery()) }),
}));

const sent: { conversationId: string; reply: Reply; from: string }[] = [];
let sendError: string | null;
vi.mock("@/lib/channels/send", () => ({
  sendToConversation: async (conversationId: string, reply: Reply, sender: { from: string }) => {
    sent.push({ conversationId, reply, from: sender.from });
    return sendError ? { ok: false, messageId: null, error: sendError } : { ok: true, messageId: "m" };
  },
}));

const { countRecentShopperMessages, replyIfRateLimited } = await import("./rate-limit");

const NOW = new Date("2026-11-07T10:00:00.000Z");
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
const shopA = { shopId: "shop-a", conversationId: "conv-1" };

function add(n: number, over: Partial<Message> = {}) {
  for (let i = 0; i < n; i++) {
    messages.push({ shop_id: "shop-a", conversation_id: "conv-1", sender: "shopper", created_at: secondsAgo(5), ...over });
  }
}

beforeEach(() => {
  messages = [];
  readError = null;
  sent.length = 0;
  sendError = null;
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

describe("replyIfRateLimited (A5: 10 messages per minute)", () => {
  it("lets messages 1 to 10 through without sending anything", async () => {
    for (let i = 1; i <= 10; i++) {
      add(1);
      expect(await replyIfRateLimited(shopA)).toBe(false);
    }
    expect(sent).toEqual([]);
  });

  it("stops message 11 and 12, each with one polite reply sent as the AI", async () => {
    add(10);
    add(1);
    expect(await replyIfRateLimited(shopA)).toBe(true);
    add(1);
    expect(await replyIfRateLimited(shopA)).toBe(true);
    expect(sent).toEqual([
      { conversationId: "conv-1", reply: RATE_LIMIT_REPLY, from: "ai" },
      { conversationId: "conv-1", reply: RATE_LIMIT_REPLY, from: "ai" },
    ]);
  });

  it("still blocks the AI when staff took over meanwhile (the reply is refused, not an error)", async () => {
    add(11);
    sendError = "not_in_ai_mode";
    expect(await replyIfRateLimited(shopA)).toBe(true);
  });

  it("fails open when the count can't be read, so a database error doesn't silence every shopper", async () => {
    add(50);
    readError = { message: "timeout" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await replyIfRateLimited(shopA)).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe("countRecentShopperMessages", () => {
  it("counts only this shopper's own messages", async () => {
    add(10);
    add(5, { sender: "ai" });
    add(5, { sender: "staff" });
    add(5, { sender: "system" });
    expect(await countRecentShopperMessages(shopA)).toBe(10);
  });

  it("does not count another shopper's messages", async () => {
    add(10);
    add(30, { conversation_id: "conv-2" });
    expect(await countRecentShopperMessages(shopA)).toBe(10);
    expect(await replyIfRateLimited(shopA)).toBe(false);
  });

  it("does not count rows of another shop, even with the same conversation id", async () => {
    add(30, { shop_id: "shop-b" });
    expect(await countRecentShopperMessages(shopA)).toBe(0);
  });

  it("counts the last 60 seconds only", async () => {
    add(10, { created_at: secondsAgo(61) });
    add(3, { created_at: secondsAgo(59) });
    add(1, { created_at: secondsAgo(60) }); // the edge counts
    expect(await countRecentShopperMessages(shopA)).toBe(4);
  });
});
