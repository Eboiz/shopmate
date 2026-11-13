import { describe, expect, it } from "vitest";
import { chatStatus } from "./chat-status";
import { chatHistorySchema } from "./types";

const shopper = { sender: "shopper" as const };
const ai = { sender: "ai" as const };
const staff = { sender: "staff" as const };
const system = { sender: "system" as const };

describe("chatStatus (PB-42)", () => {
  it("shows typing in ai mode while sending or waiting for the reply", () => {
    expect(chatStatus([shopper], "ai", true)).toBe("typing");
    expect(chatStatus([shopper], "ai", false, true)).toBe("typing");
  });

  it("is idle in ai mode once the reply is in or after an error", () => {
    expect(chatStatus([shopper, ai], "ai", false)).toBe("idle");
    expect(chatStatus([shopper], "ai", false, false)).toBe("idle");
    expect(chatStatus([], "ai", false)).toBe("idle");
  });

  it.each(["needs_human", "staff"] as const)("waits for staff in %s mode when the shopper wrote last, never typing", (mode) => {
    expect(chatStatus([ai, shopper], mode, false)).toBe("waiting_staff");
    expect(chatStatus([ai, shopper], mode, false, true)).toBe("waiting_staff");
  });

  it.each(["needs_human", "staff"] as const)("is idle in %s mode once staff or the system answered", (mode) => {
    expect(chatStatus([shopper, staff], mode, false)).toBe("idle");
    expect(chatStatus([shopper, system], mode, false)).toBe("idle");
    expect(chatStatus([], mode, false)).toBe("idle");
  });

  it("does not show typing while a message to staff is being sent", () => {
    expect(chatStatus([staff], "staff", true)).toBe("idle");
  });

  it("shows typing again once staff hands the conversation back to the AI", () => {
    expect(chatStatus([shopper], "staff", false)).toBe("waiting_staff");
    expect(chatStatus([shopper], "ai", true)).toBe("typing");
  });
});

describe("chatHistorySchema mode", () => {
  it("reads the conversation mode and defaults to ai for older responses", () => {
    expect(chatHistorySchema.parse({ messages: [], mode: "needs_human" }).mode).toBe("needs_human");
    expect(chatHistorySchema.parse({ messages: [] }).mode).toBe("ai");
    expect(chatHistorySchema.safeParse({ messages: [], mode: "robot" }).success).toBe(false);
  });
});
