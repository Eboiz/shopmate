import { describe, expect, it } from "vitest";
import type { EvalCase } from "./cases";
import { aggregate, scoreRun } from "./score";

const V = "a0000000-0000-4000-8000-000000000011";
const msg = (text: string) => [{ sender: "shopper" as const, text }];

const findProduct: EvalCase = {
  id: "find-product",
  description: "",
  history: msg("Shop có váy suông linen không?"),
  expected: [
    { tool: "search_products", args: { query: (v: unknown) => typeof v === "string" && v.includes("linen") }, required: true },
    { tool: "get_stock", args: { productId: V }, required: false },
  ],
};
const sizeAdvice: EvalCase = {
  id: "size-advice",
  description: "",
  history: msg("1m60 50kg"),
  productId: V,
  expected: [{ tool: "recommend_size", args: { productId: V, heightCm: 160, weightKg: 50 }, required: true }],
};
const stockKnown: EvalCase = {
  id: "stock-known-product",
  description: "",
  history: msg("Còn size M màu be không?"),
  productId: V,
  expected: [{ tool: "get_stock", args: { productId: V, size: "M" }, required: true }],
};
const greeting: EvalCase = { id: "greeting-no-tool", description: "", history: msg("Chào shop"), expected: [] };

describe("scoreRun", () => {
  it("passes a fully correct run", () => {
    const s = scoreRun(findProduct, [{ name: "search_products", input: { query: "vay suong linen", limit: 5 } }]);
    expect(s).toEqual({
      requiredTotal: 1,
      requiredHit: 1,
      callsTotal: 1,
      paramMatched: 1,
      paramMismatched: 0,
      unnecessary: 0,
      passed: true,
    });
    expect(aggregate([s]).recall).toBe(1);
  });

  it("counts a missing required tool", () => {
    const s = scoreRun(findProduct, [{ name: "get_stock", input: { productId: V } }]);
    expect(s.requiredHit).toBe(0);
    expect(s.unnecessary).toBe(0);
    expect(s.passed).toBe(false);
  });

  it("counts the right tool with the wrong arguments", () => {
    const s = scoreRun(sizeAdvice, [{ name: "recommend_size", input: { productId: V, heightCm: 170, weightKg: 50 } }]);
    expect(s.paramMismatched).toBe(1);
    expect(s.requiredHit).toBe(0);
    expect(s.passed).toBe(false);
  });

  it("counts a call to a tool that isn't expected", () => {
    const s = scoreRun(stockKnown, [
      { name: "search_products", input: { query: "váy" } },
      { name: "get_stock", input: { productId: V, size: "M" } },
    ]);
    expect(s.unnecessary).toBe(1);
    expect(s.passed).toBe(false);
  });

  it("counts a repeated call as unnecessary", () => {
    const call = { name: "get_stock", input: { productId: V, size: "M" } };
    const s = scoreRun(stockKnown, [call, { name: "get_stock", input: { size: "M", productId: V } }]);
    expect(s.unnecessary).toBe(1);
    expect(s.paramMatched).toBe(1);
  });

  it("expects no call when expected is empty", () => {
    expect(scoreRun(greeting, [{ name: "get_policy", input: { kind: "doi_tra" } }])).toMatchObject({
      unnecessary: 1,
      passed: false,
    });
    expect(scoreRun(greeting, []).passed).toBe(true);
  });

  it("does not require optional tools", () => {
    const s = scoreRun(findProduct, [{ name: "search_products", input: { query: "linen" } }]);
    expect(s.requiredTotal).toBe(1);
    expect(s.passed).toBe(true);
  });

  it("applies function matchers", () => {
    expect(scoreRun(findProduct, [{ name: "search_products", input: { query: "áo" } }])).toMatchObject({
      paramMismatched: 1,
      requiredHit: 0,
    });
  });
});

describe("aggregate", () => {
  it("adds up runs", () => {
    const runs = [
      scoreRun(findProduct, [{ name: "search_products", input: { query: "linen" } }]),
      scoreRun(greeting, []),
      scoreRun(stockKnown, [
        { name: "search_products", input: { query: "váy" } },
        { name: "get_stock", input: { productId: V, size: "L" } },
      ]),
    ];
    const a = aggregate(runs);
    expect(a.passRate).toBeCloseTo(2 / 3);
    expect(a.recall).toBeCloseTo(1 / 2); // 1 of 2 required calls hit
    expect(a.paramAccuracy).toBeCloseTo(1 / 2); // search matched, get_stock size L mismatched
    expect(a.necessityPrecision).toBeCloseTo(1 - 1 / 3); // 1 unnecessary of 3 calls
  });

  it("handles no runs", () => {
    expect(aggregate([])).toEqual({ passRate: 0, recall: null, paramAccuracy: null, necessityPrecision: null });
  });
});
