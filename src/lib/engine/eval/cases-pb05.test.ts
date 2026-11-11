import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { toModelMessages } from "../messages";
import { FX } from "../test/two-shops";
import { evalCases } from "./cases";
import { pb05EvalCases } from "./cases-pb05";
import { scoreRun, type ActualCall, type RunOutcome } from "./score";

const V = FX.a.vay01;

// One correct run per case, written by hand: the labels must accept it.
const correct: Record<string, { calls: ActualCall[]; outcome: RunOutcome }> = {
  "pb05-ac1-exact": {
    calls: [{ name: "get_stock", input: { productId: V, size: "M", color: "be" } }],
    outcome: { handoffReason: null, replyText: "Dạ váy màu be size M còn 2 cái ạ, giá 350.000đ." },
  },
  "pb05-no-diacritics-by-name": {
    calls: [
      { name: "search_products", input: { query: "vay suong linen", limit: 5 } },
      { name: "get_stock", input: { productId: V, size: "M", color: "Be" } },
    ],
    outcome: { handoffReason: null, replyText: "Dạ Váy suông linen màu be size M còn hàng, giá 350k ạ." },
  },
  "pb05-ac2-no-diacritics": {
    // Filtered first (L be: 0), then the whole product for alternatives.
    calls: [
      { name: "get_stock", input: { productId: V, size: "L", color: "be" } },
      { name: "get_stock", input: { productId: V } },
    ],
    outcome: { handoffReason: null, replyText: "Dạ màu be size L hết hàng rồi ạ. Váy còn size M màu be và màu đen nhé." },
  },
  "pb05-ac3-no-diacritics": {
    calls: [{ name: "search_products", input: { query: "tui xach da", limit: 5 } }],
    outcome: { handoffReason: null, replyText: "Dạ shop chưa tìm thấy túi xách da. Bạn tìm kiểu túi nào, màu gì ạ?" },
  },
};

// And one wrong outcome per case: the labels must reject it.
const wrong: Record<string, RunOutcome> = {
  "pb05-ac1-exact": { handoffReason: null, replyText: "Dạ váy màu be size M còn hàng, giá 389.000đ ạ." },
  "pb05-no-diacritics-by-name": { handoffReason: null, replyText: "Dạ màu be size M tạm hết rồi ạ, giá 350.000đ." },
  "pb05-ac2-no-diacritics": { handoffReason: null, replyText: "Dạ size L còn hàng ạ." },
  "pb05-ac3-no-diacritics": { handoffReason: null, replyText: "Ý bạn là túi tote? Hay túi đeo chéo?" },
};

describe("pb05EvalCases", () => {
  it("have ids distinct from each other and from cases.ts", () => {
    const ids = [...evalCases, ...pb05EvalCases].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("use valid histories, tools and fixture products", () => {
    const shopA = new Set<string>(Object.values(FX.a));
    for (const c of pb05EvalCases) {
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
      if (c.productId !== undefined) expect(shopA.has(c.productId), c.id).toBe(true);
    }
  });

  it("accept a correct run and reject a wrong outcome", () => {
    for (const c of pb05EvalCases) {
      const run = correct[c.id];
      expect(run, `no correct run for ${c.id}`).toBeDefined();
      expect(scoreRun(c, run.calls, run.outcome), c.id).toMatchObject({ passed: true });
      expect(scoreRun(c, run.calls, wrong[c.id]).passed, c.id).toBe(false);
      // A handoff where none is expected fails too.
      expect(scoreRun(c, run.calls, { ...run.outcome, handoffReason: "product_not_found" }).passed, c.id).toBe(false);
    }
  });

  it("fail a run that skips the stock or search lookup", () => {
    for (const c of pb05EvalCases) expect(scoreRun(c, [], correct[c.id].outcome).passed, c.id).toBe(false);
  });
});
