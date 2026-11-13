import { describe, expect, it, vi } from "vitest";
import { blockedCategory, checkShopperMessage, GUARD_THRESHOLDS } from "./input-guard";
import type { JevClient, JevRequest, JevResponse } from "./jev";

const low = { injection: 0.01, leak: 0.01, abuse: 0.01, harmful: 0.01 };

function jevAnswering(scores: Record<string, number>, extra: Partial<JevResponse> = {}) {
  const decide = vi.fn(async (request: JevRequest): Promise<JevResponse> => ({
    model: request.model,
    answers: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { type: "noul" as const, noul: v }])),
    ...extra,
  }));
  return { model: "typesafe/jev-1.13", decide } satisfies JevClient;
}

describe("blockedCategory", () => {
  it("is null when every score is under its threshold", () => {
    expect(blockedCategory({ ...low, leak: GUARD_THRESHOLDS.leak - 0.01 })).toBeNull();
  });
  it("blocks at the threshold", () => {
    expect(blockedCategory({ ...low, abuse: GUARD_THRESHOLDS.abuse })).toBe("abuse");
  });
  it("picks the highest category over its threshold", () => {
    expect(blockedCategory({ ...low, injection: 0.7, harmful: 0.9 })).toBe("harmful");
  });
});

describe("checkShopperMessage", () => {
  it("asks the four questions in one call, about the last 10 non-system messages", async () => {
    const jev = jevAnswering(low, { usage: { cost: 0.00004 } });
    const history = [
      { sender: "system" as const, text: "Nhân viên đã tham gia" },
      ...Array.from({ length: 12 }, (_, i) => ({ sender: i % 2 ? ("ai" as const) : ("shopper" as const), text: `tin ${i}` })),
    ];
    let t = 100;
    const result = await checkShopperMessage(jev, { history, now: () => (t += 50) });
    expect(jev.decide).toHaveBeenCalledTimes(1);
    const request = jev.decide.mock.calls[0][0];
    expect(Object.keys(request.questions)).toEqual(["injection", "leak", "abuse", "harmful"]);
    const conversation = (request.state as { conversation: Array<{ from: string; text: string }> }).conversation;
    expect(conversation).toHaveLength(10);
    expect(conversation.at(-1)).toEqual({ from: "assistant", text: "tin 11" });
    expect(conversation.some((m) => m.from === "system")).toBe(false);
    expect(result).toEqual({ scores: low, blocked: null, ms: 50, cost: 0.00004 });
  });

  it("throws when an answer is missing or not a probability (the engine then fails open)", async () => {
    const missing: Record<string, number> = { ...low };
    delete missing.abuse;
    await expect(checkShopperMessage(jevAnswering(missing), { history: [], now: () => 0 })).rejects.toThrow(/abuse/);
  });
});

