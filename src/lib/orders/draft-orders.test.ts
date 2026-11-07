import { beforeEach, describe, expect, it, vi } from "vitest";
import { replySchema } from "@/contract";
import type { SendResult } from "@/lib/channels/send";

// decideDraftOrder: what reaches the shopper, and that a failed notification
// never hides a decision that the database already made.

const sends: unknown[][] = [];
let sendResult: SendResult | Error = { ok: true, messageId: "m1" };
vi.mock("@/lib/channels/send", () => ({
  sendToConversation: async (...args: unknown[]) => {
    sends.push(args);
    if (sendResult instanceof Error) throw sendResult;
    return sendResult;
  },
}));

const { decideDraftOrder, decisionMessage } = await import("./draft-orders");

const ORDER = "a0000000-0000-4000-8000-000000000011";
const CONVERSATION = "a0000000-0000-4000-8000-000000000031";
const rpcCalls: unknown[][] = [];
const fakeDb = (data: unknown, error: { message: string } | null = null) =>
  ({
    rpc: async (...args: unknown[]) => (rpcCalls.push(args), { data, error }),
  }) as unknown as Parameters<typeof decideDraftOrder>[0];

beforeEach(() => {
  sends.length = 0;
  rpcCalls.length = 0;
  sendResult = { ok: true, messageId: "m1" };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("decideDraftOrder", () => {
  it("confirms, then tells the shopper in the same conversation as a system message", async () => {
    const db = fakeDb({ status: "confirmed", conversationId: CONVERSATION, total: 950000 });
    expect(await decideDraftOrder(db, ORDER, "confirmed")).toEqual({ status: "confirmed", notificationSent: true });
    expect(rpcCalls).toEqual([["decide_draft_order", { p_order_id: ORDER, p_decision: "confirmed" }]]);
    expect(sends).toEqual([[CONVERSATION, decisionMessage("confirmed", 950000), { from: "system" }]]);
  });

  it("cancels and tells the shopper", async () => {
    const db = fakeDb({ status: "cancelled", conversationId: CONVERSATION, total: 950000 });
    expect(await decideDraftOrder(db, ORDER, "cancelled")).toEqual({ status: "cancelled", notificationSent: true });
    expect(sends[0][1]).toEqual(decisionMessage("cancelled", 950000));
  });

  it("keeps the decision when the channel refuses the message", async () => {
    sendResult = { ok: false, messageId: "m1", error: "outside_24h_window" };
    const db = fakeDb({ status: "confirmed", conversationId: CONVERSATION, total: 950000 });
    expect(await decideDraftOrder(db, ORDER, "confirmed")).toEqual({ status: "confirmed", notificationSent: false });
  });

  it("keeps the decision when sending throws", async () => {
    sendResult = new Error("boom");
    const db = fakeDb({ status: "cancelled", conversationId: CONVERSATION, total: 0 });
    expect(await decideDraftOrder(db, ORDER, "cancelled")).toEqual({ status: "cancelled", notificationSent: false });
  });

  it.each([
    [{ status: "insufficient_stock", variantIds: [ORDER] }, "insufficient_stock"],
    [{ status: "not_draft" }, "not_draft"],
    [{ status: "not_found" }, "not_found"],
  ])("sends nothing when the database answers %j", async (data, status) => {
    expect(await decideDraftOrder(fakeDb(data), ORDER, "confirmed")).toEqual({ status });
    expect(sends).toHaveLength(0);
  });

  it("throws on a database error or an unexpected answer", async () => {
    await expect(decideDraftOrder(fakeDb(null, { message: "down" }), ORDER, "confirmed")).rejects.toThrow(/down/);
    await expect(decideDraftOrder(fakeDb({ status: "weird" }), ORDER, "confirmed")).rejects.toThrow();
  });
});

describe("decisionMessage", () => {
  it("is a valid reply in Vietnamese with the order total from data", () => {
    const confirmed = decisionMessage("confirmed", 950000);
    expect(replySchema.parse(confirmed)).toEqual(confirmed);
    expect(confirmed.text).toContain("950.000đ");
    expect(confirmed.text).toContain("xác nhận");
    expect(decisionMessage("cancelled", 950000).text).toContain("hủy");
  });
});
