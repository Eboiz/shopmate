import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { OFFER_QUESTION, OFFER_QUICK_REPLIES } from "../handoff-offer";
import { toModelMessages } from "../messages";
import { evalCases } from "./cases";
import { pb08Cases, pb11Cases, pb20Cases } from "./cases-ai02-04";
import { pb05EvalCases } from "./cases-pb05";
import { pb06Cases } from "./cases-pb06";
import { pb09Cases } from "./cases-pb09";
import { pb14Cases } from "./cases-pb14";
import { pb31Cases } from "./cases-pb31";
import { pb39Cases } from "./cases-pb39";
import { scoreRun, type ActualCall, type RunOutcome } from "./score";

const V = "a0000000-0000-4000-8000-000000000011";
const byId = (id: string) => pb39Cases.find((c) => c.id === id)!;

// A correct run per case, by hand: the labels must accept it.
const correct: Record<string, { calls: ActualCall[]; outcome: RunOutcome }> = {
  "pb39-bot01-size-price-colors": {
    calls: [
      { name: "recommend_size", input: { productId: V, heightCm: 160, weightKg: 50 } },
      { name: "get_stock", input: { productId: V } },
    ],
    outcome: { handoffReason: null, replyText: "Dạ, bạn mặc size M ạ. Váy giá 350.000đ, size M còn màu be và đen." },
  },
  "pb39-bot05-ship-fee-after-handback": {
    calls: [{ name: "get_policy", input: { kind: "giao_hang" } }],
    outcome: {
      handoffReason: null,
      handoffOffer: "policy_not_covered",
      replyText: `Dạ, shop chưa có thông tin về phí giao hàng ạ. ${OFFER_QUESTION}`,
      quickReplies: OFFER_QUICK_REPLIES,
    },
  },
};

describe("pb39Cases", () => {
  it("are valid, with ids no other set uses", () => {
    const others = [...evalCases, ...pb05EvalCases, ...pb06Cases, ...pb09Cases, ...pb14Cases, ...pb31Cases, ...pb08Cases, ...pb11Cases, ...pb20Cases].map((c) => c.id);
    for (const c of pb39Cases) {
      expect(others, c.id).not.toContain(c.id);
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      expect(c.history.at(-1)?.sender, c.id).toBe("shopper");
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
    }
  });

  it("accept a correct run", () => {
    for (const c of pb39Cases) expect(scoreRun(c, correct[c.id].calls, correct[c.id].outcome).passed, c.id).toBe(true);
  });

  it("BOT-01: reject the reported reply, a missing price and a missing get_stock", () => {
    const c = byId("pb39-bot01-size-price-colors");
    const { calls, outcome } = correct[c.id];
    const reported = "Dạ, bạn mặc size M là vừa ạ. Còn giá và màu còn hàng thì mình chưa có thông tin cụ thể, để mình kiểm tra và cập nhật cho bạn nhé.";
    expect(scoreRun(c, calls, { ...outcome, replyText: reported }).passed).toBe(false);
    expect(scoreRun(c, calls, { ...outcome, replyText: "Dạ, bạn mặc size M ạ, còn màu be." }).passed).toBe(false);
    expect(scoreRun(c, [calls[0]], outcome).passed).toBe(false);
  });

  it("BOT-05: reject reading doi_tra and answering with the returns policy", () => {
    const c = byId("pb39-bot05-ship-fee-after-handback");
    const { calls, outcome } = correct[c.id];
    expect(scoreRun(c, [{ name: "get_policy", input: { kind: "doi_tra" } }], outcome).passed).toBe(false);
    expect(scoreRun(c, [...calls, { name: "get_policy", input: { kind: "doi_tra" } }], outcome).passed).toBe(false);
    const returns = `Dạ, shop chưa có thông tin phí giao hàng. Về đổi trả, shop hỗ trợ đổi trong 7 ngày. ${OFFER_QUESTION}`;
    expect(scoreRun(c, calls, { ...outcome, replyText: returns }).passed).toBe(false);
  });
});
