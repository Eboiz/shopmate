import { describe, expect, it } from "vitest";
import { replySchema } from "@/contract";
import { RATE_LIMIT, RATE_LIMIT_REPLY, isOverLimit, windowStart } from "./rate-limit-rule";

describe("isOverLimit (A5: 10 messages per minute)", () => {
  it("lets the 10th message in a minute through", () => {
    expect(isOverLimit(1)).toBe(false);
    expect(isOverLimit(RATE_LIMIT.maxMessages)).toBe(false);
  });

  it("stops the 11th and later", () => {
    expect(isOverLimit(11)).toBe(true);
    expect(isOverLimit(50)).toBe(true);
  });
});

describe("windowStart", () => {
  it("is one minute before now", () => {
    expect(windowStart(new Date("2026-11-05T10:01:30.000Z"))).toBe("2026-11-05T10:00:30.000Z");
  });
});

describe("RATE_LIMIT_REPLY", () => {
  it("fits the shared reply shape of every channel", () => {
    expect(replySchema.safeParse(RATE_LIMIT_REPLY).success).toBe(true);
  });

  it("is polite Vietnamese with no products or quick replies", () => {
    expect(RATE_LIMIT_REPLY.text).toMatch(/chờ/);
    expect(RATE_LIMIT_REPLY.products).toEqual([]);
    expect(RATE_LIMIT_REPLY.quickReplies).toEqual([]);
  });
});
