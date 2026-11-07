import type { Reply } from "@/contract";

// PB-17, assumption A5: each shopper may send 10 messages per minute. Pure rule
// so it is unit-tested without a database; rate-limit.ts does the counting.
export const RATE_LIMIT = { maxMessages: 10, windowMs: 60_000 } as const;

// `recentCount` includes the message being handled, which is already stored.
export function isOverLimit(recentCount: number): boolean {
  return recentCount > RATE_LIMIT.maxMessages;
}

export function windowStart(now: Date): string {
  return new Date(now.getTime() - RATE_LIMIT.windowMs).toISOString();
}

// Sent instead of calling the AI. No product cards and no quick replies, so
// tapping one can't add to the count.
export const RATE_LIMIT_REPLY: Reply = {
  text: "Bạn nhắn hơi nhanh rồi ạ. Bạn chờ mình khoảng một phút rồi nhắn tiếp nhé!",
  products: [],
  quickReplies: [],
};
