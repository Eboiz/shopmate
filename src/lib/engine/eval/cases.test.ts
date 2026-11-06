import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { toModelMessages } from "../messages";
import { FX } from "../test/two-shops";
import { evalCases } from "./cases";
import { scoreRun, type ActualCall } from "./score";

const V = FX.a.vay01;

// One correct run per case, written by hand: the labels must accept it.
const correctRuns: Record<string, ActualCall[]> = {
  "greeting-no-tool": [],
  "find-product": [{ name: "search_products", input: { query: "váy suông linen", limit: 5 } }],
  "stock-known-product": [{ name: "get_stock", input: { productId: V, size: "M", color: "Be" } }],
  "size-advice": [{ name: "recommend_size", input: { productId: V, heightCm: 160, weightKg: 50 } }],
  "size-missing-info": [],
  pairing: [{ name: "get_pairings", input: { productId: V } }],
  "return-policy": [{ name: "get_policy", input: { kind: "doi_tra" } }],
  "policy-not-in-data": [
    { name: "get_policy", input: { kind: "giao_hang" } },
    { name: "handoff_to_staff", input: { reason: "policy_not_covered" } },
  ],
};

describe("evalCases", () => {
  it("has a small set of distinct cases", () => {
    expect(evalCases.length).toBeGreaterThanOrEqual(5);
    expect(evalCases.length).toBeLessThanOrEqual(10);
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
      expect(scoreRun(c, calls).passed, c.id).toBe(true);
    }
  });
});
