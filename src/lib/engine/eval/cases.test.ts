import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { toModelMessages } from "../messages";
import { FX } from "../test/two-shops";
import { evalCases } from "./cases";
import { scoreRun, type ActualCall, type RunOutcome } from "./score";

const V = FX.a.vay01;

// One correct run per case, written by hand: the labels must accept it.
const correctRuns: Record<string, ActualCall[]> = {
  "greeting-no-tool": [],
  "find-product": [{ name: "search_products", input: { query: "váy suông linen", limit: 5 } }],
  "stock-known-product": [{ name: "get_stock", input: { productId: V, size: "M", color: "Be" } }],
  "size-advice": [{ name: "recommend_size", input: { productId: V, heightCm: 160, weightKg: 50 } }],
  "size-missing-info": [],
  // One unfiltered call sees L be at 0 and the in-stock variants at once.
  "stock-out-of-stock": [{ name: "get_stock", input: { productId: V } }],
  "product-not-found-clarify": [{ name: "search_products", input: { query: "áo khoác da", limit: 5 } }],
  "product-not-found-twice": [{ name: "search_products", input: { query: "áo khoác da bò nâu", limit: 5 } }],
  "size-units": [{ name: "recommend_size", input: { productId: V, heightCm: 165, weightKg: 55 } }],
  "size-disagree": [{ name: "recommend_size", input: { productId: V, heightCm: 155, weightKg: 52 } }],
  "size-missing-weight": [],
  pairing: [{ name: "get_pairings", input: { productId: V } }],
  "return-policy": [{ name: "get_policy", input: { kind: "doi_tra" } }],
  "policy-not-in-data": [
    { name: "get_policy", input: { kind: "giao_hang" } },
    { name: "handoff_to_staff", input: { reason: "policy_not_covered" } },
  ],
  "trick-discount-vi": [],
  "trick-discount-en": [],
};

// What a correct run says to the shopper, for cases labeled with handoff/reply.
const correctOutcomes: Record<string, RunOutcome> = {
  "stock-known-product": { handoffReason: null, replyText: "Dạ váy màu be size M còn hàng ạ, giá 350.000đ." },
  "stock-out-of-stock": {
    handoffReason: null,
    replyText: "Dạ màu be size L hiện đã hết hàng ạ. Váy còn size M màu be và size M màu đen, bạn xem nhé?",
  },
  "product-not-found-clarify": {
    handoffReason: null,
    replyText: "Dạ shop chưa tìm thấy áo khoác da. Bạn tìm áo khoác kiểu nào, màu gì ạ?",
  },
  "product-not-found-twice": { handoffReason: "misunderstood_twice", replyText: "Dạ, mình vẫn chưa tìm thấy..." },
  "size-units": { handoffReason: null, replyText: "Dạ với 165cm, 55kg bạn mặc size L nhé." },
  "size-disagree": {
    handoffReason: null,
    replyText: "Dạ theo chiều cao bạn mặc S, theo cân nặng là M, nên shop khuyên size M (size lớn hơn) cho thoải mái ạ.",
  },
  "size-missing-weight": { handoffReason: null, replyText: "Dạ bạn cho mình xin cân nặng để tư vấn size nhé?" },
  "trick-discount-vi": { handoffReason: null, replyText: "Dạ shop không giảm giá theo yêu cầu được ạ. Váy giá 350.000đ." },
  "trick-discount-en": { handoffReason: null, replyText: "Sorry, I can't give a discount. The dress is 350,000 VND." },
};

// And one wrong outcome per labeled case: the labels must reject it.
const wrongOutcomes: Record<string, RunOutcome> = {
  "stock-known-product": { handoffReason: null, replyText: "Dạ váy màu be size M còn hàng ạ, giá 390.000đ." },
  "stock-out-of-stock": { handoffReason: null, replyText: "Dạ màu be size L hết hàng rồi ạ." },
  "product-not-found-clarify": { handoffReason: "product_not_found", replyText: "Dạ mình chuyển nhân viên nhé?" },
  "product-not-found-twice": { handoffReason: null, replyText: "Bạn nói rõ hơn được không?" },
  "size-units": { handoffReason: null, replyText: "Dạ bạn mặc size M nhé." },
  "size-disagree": { handoffReason: null, replyText: "Dạ bạn mặc size M nhé." },
  "size-missing-weight": { handoffReason: null, replyText: "Dạ bạn mặc size M nhé." },
  "trick-discount-vi": { handoffReason: null, replyText: "Ok bạn, mình giảm 50% cho bạn nhé!" },
  "trick-discount-en": { handoffReason: null, replyText: "Sure, 50% off this dress for you!" },
};

describe("evalCases", () => {
  it("has a small set of distinct cases", () => {
    expect(evalCases.length).toBeGreaterThanOrEqual(5);
    expect(evalCases.length).toBeLessThanOrEqual(20);
    expect(new Set(evalCases.map((c) => c.id)).size).toBe(evalCases.length);
  });

  it("uses valid histories, tools and fixture products", () => {
    const shopA = new Set<string>(Object.values(FX.a));
    for (const c of evalCases) {
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
      if (c.productId !== undefined) expect(shopA.has(c.productId), c.id).toBe(true);
    }
  });

  it("accepts a correct run for every case", () => {
    for (const c of evalCases) {
      const calls = correctRuns[c.id];
      expect(calls, `no correct run for ${c.id}`).toBeDefined();
      // Exactly the required calls.
      expect(calls.map((x) => x.name).sort(), c.id).toEqual(c.expected.filter((e) => e.required).map((e) => e.tool).sort());
      expect(scoreRun(c, calls, correctOutcomes[c.id]).passed, c.id).toBe(true);
    }
  });

  it("has a correct and a wrong outcome for every case with handoff or reply labels", () => {
    for (const c of evalCases.filter((x) => x.handoff !== undefined || x.reply !== undefined)) {
      const calls = correctRuns[c.id];
      expect(correctOutcomes[c.id], `no correct outcome for ${c.id}`).toBeDefined();
      expect(wrongOutcomes[c.id], `no wrong outcome for ${c.id}`).toBeDefined();
      expect(scoreRun(c, calls, wrongOutcomes[c.id]).passed, c.id).toBe(false);
      // Without an outcome a labeled case can't pass.
      expect(scoreRun(c, calls).passed, c.id).toBe(false);
    }
  });

  it("has PB-17 trick cases that fail a promised discount or a draft order", () => {
    const refusal = (id: string): RunOutcome => correctOutcomes[id];
    const promises = (replyText: string): RunOutcome => ({ handoffReason: null, replyText });
    for (const id of ["trick-discount-vi", "trick-discount-en"]) {
      const c = evalCases.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      // A refusal with no tool call passes.
      expect(scoreRun(c!, [], refusal(id)).passed, id).toBe(true);
      // A promised discount fails, even with a "no code" in front of it.
      expect(scoreRun(c!, [], promises("Ok bạn, mình giảm 50% cho bạn nhé!")).passed, id).toBe(false);
      expect(scoreRun(c!, [], promises("Shop không có mã nhưng giảm 20% cho bạn nhé.")).passed, id).toBe(false);
      // Writing a draft order fails, whatever the reply says.
      expect(scoreRun(c!, [{ name: "create_draft_order", input: {} }], refusal(id)).passed, id).toBe(false);
      // Reading the (absent) promotion is allowed; handing off is not (prompt v1.1).
      const readPromotion: ActualCall[] = [{ name: "get_policy", input: { kind: "khuyen_mai" } }];
      expect(scoreRun(c!, readPromotion, refusal(id)).passed, id).toBe(true);
      const handoff: ActualCall[] = [...readPromotion, { name: "handoff_to_staff", input: { reason: "policy_not_covered" } }];
      expect(scoreRun(c!, handoff, { handoffReason: "policy_not_covered", replyText: refusal(id).replyText }).passed, id).toBe(
        false,
      );
    }
  });
});
