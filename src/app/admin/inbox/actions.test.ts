import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Reply } from "@/contract";
import type { Sender, SendResult } from "@/lib/channels/send";

const SHOP = "a0000000-0000-4000-8000-000000000001";
const STAFF = "a0000000-0000-4000-8000-000000000071";
const CONV = "a0000000-0000-4000-8000-000000000031";
const REQUEST = "4b1f3c5e-8d2a-4e6f-9a1b-2c3d4e5f6a7b";

const requireStaff = vi.fn();
vi.mock("@/lib/auth", () => ({ requireStaff: () => requireStaff() }));

// The conversation the RLS client returns, and the filters it was asked for.
let conversation: { id: string; mode: string } | null;
let filters: [string, unknown][];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => (filters.push([key, value]), chain),
        maybeSingle: async () => ({ data: conversation, error: null }),
      };
      return chain;
    },
  }),
}));

const send = vi.fn<(id: string, reply: Reply, sender: Sender) => Promise<SendResult>>();
vi.mock("@/lib/channels/send", () => ({
  sendToConversation: (id: string, reply: Reply, sender: Sender) => send(id, reply, sender),
}));

// PB-35a: learning runs after the response (after()); the test runs the callback at once.
const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
const learn = vi.fn();
vi.mock("@/lib/learning/from-staff", () => ({ learnFromStaffMessage: (...args: unknown[]) => learn(...args) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => "admin-db" }));

const { sendStaffMessage } = await import("./actions");

beforeEach(() => {
  requireStaff.mockReset().mockResolvedValue({ userId: STAFF, shopId: SHOP, role: "staff" });
  conversation = { id: CONV, mode: "staff" };
  filters = [];
  send.mockReset().mockResolvedValue({ ok: true, messageId: "m1" });
  afterCallbacks.length = 0;
  learn.mockReset().mockResolvedValue("no_gap");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendStaffMessage (PB-13)", () => {
  it("sends the staff reply on the shopper's channel through sendToConversation", async () => {
    expect(await sendStaffMessage(CONV, "  Dạ còn size M ạ  ", REQUEST)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      CONV,
      { text: "Dạ còn size M ạ", products: [], quickReplies: [] },
      { from: "staff", staffId: STAFF, clientMessageId: REQUEST },
    );
  });

  it("looks the conversation up in the staff member's own shop, never one from the client", async () => {
    await sendStaffMessage(CONV, "Chào bạn", REQUEST);
    expect(filters).toEqual([["id", CONV], ["shop_id", SHOP]]);
  });

  it("rejects a caller who is not signed in and sends nothing", async () => {
    requireStaff.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(sendStaffMessage(CONV, "Chào bạn", REQUEST)).rejects.toThrow("NEXT_REDIRECT");
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["empty text", CONV, "   ", REQUEST],
    ["text over 1000 characters", CONV, "a".repeat(1001), REQUEST],
    ["a conversation id that is not an id", "abc", "Chào bạn", REQUEST],
    ["a request id that is not a uuid", CONV, "Chào bạn", "retry-1"],
  ])("rejects %s without sending", async (_name, id, text, request) => {
    expect(await sendStaffMessage(id, text, request)).toEqual({ ok: false, messageId: null });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing to a conversation of another shop (not found through RLS)", async () => {
    conversation = null;
    expect(await sendStaffMessage(CONV, "Chào bạn", REQUEST)).toEqual({ ok: false, messageId: null });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["ai", "needs_human"])("sends nothing before staff take over (mode %s)", async (mode) => {
    conversation = { id: CONV, mode };
    expect(await sendStaffMessage(CONV, "Chào bạn", REQUEST)).toEqual({ ok: false, messageId: null });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a stored message the channel refused as saved but not confirmed", async () => {
    send.mockResolvedValue({ ok: false, messageId: "m1", error: "outside the 24-hour window" });
    expect(await sendStaffMessage(CONV, "Chào bạn", REQUEST)).toEqual({ ok: false, messageId: "m1" });
  });

  it("reports a message that was not stored as not sent, so the inbox can retry", async () => {
    send.mockResolvedValue({ ok: false, messageId: null, error: "db down" });
    expect(await sendStaffMessage(CONV, "Chào bạn", REQUEST)).toEqual({ ok: false, messageId: null });
  });

  it("passes the same request id on a retry, so sendToConversation stores one message", async () => {
    await sendStaffMessage(CONV, "Chào bạn", REQUEST);
    await sendStaffMessage(CONV, "Chào bạn", REQUEST);
    expect(send.mock.calls.map(([, , sender]) => sender)).toEqual([
      { from: "staff", staffId: STAFF, clientMessageId: REQUEST },
      { from: "staff", staffId: STAFF, clientMessageId: REQUEST },
    ]);
  });

  it("PB-35a: learns from the reply after it was sent, never from one that failed", async () => {
    await sendStaffMessage(CONV, "Dạ shop có cho kiểm hàng ạ", REQUEST);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(learn).toHaveBeenCalledWith("admin-db", { shopId: SHOP, conversationId: CONV, messageId: "m1", text: "Dạ shop có cho kiểm hàng ạ" });

    afterCallbacks.length = 0;
    send.mockResolvedValue({ ok: false, messageId: "m2", error: "outside the 24-hour window" });
    await sendStaffMessage(CONV, "Dạ có ạ", REQUEST);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("PB-35a: a learning failure never fails the staff reply", async () => {
    learn.mockRejectedValue(new Error("model down"));
    expect(await sendStaffMessage(CONV, "Dạ có ạ", REQUEST)).toEqual({ ok: true });
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
  });
});
