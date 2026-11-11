import { describe, expect, it } from "vitest";
import { finalJson, scriptedModel } from "../test/fake-model";
import type { ModelClient } from "../engine";
import {
  addUsage,
  countingModel,
  DEFAULT_MAX_TOKENS,
  fmtTokens,
  isQuotaError,
  maxTokensFromEnv,
  parseRunsBySeverity,
  QuotaStop,
  TokenBudget,
  totalTokens,
  usageOf,
  ZERO_USAGE,
} from "./injection-budget";
import { estimatePlan, estimateRunTokens } from "./injection-plan";
import { pb17Cases } from "./cases-pb17-injection";

const params = { model: "m", max_tokens: 10, messages: [{ role: "user" as const, content: "hi" }] };

describe("token accounting", () => {
  it("counts input, output, cache creation and cache read", () => {
    const u = usageOf({ input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 3000, cache_read_input_tokens: 500 });
    expect(u).toEqual({ input: 100, output: 20, cacheCreation: 3000, cacheRead: 500 });
    expect(totalTokens(u)).toBe(3620);
    expect(totalTokens(addUsage(u, u))).toBe(7240);
    expect(usageOf({ input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: null })).toEqual({ input: 5, output: 1, cacheCreation: 0, cacheRead: 0 });
  });

  it("countingModel adds up every call's usage", async () => {
    const reply = finalJson({ text: "x", productIds: [], quickReplies: [] });
    const inner = scriptedModel([
      { ...reply, usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 7 } as never },
      { ...reply, usage: { input_tokens: 30, output_tokens: 4 } as never },
    ]);
    let used = ZERO_USAGE;
    const model = countingModel(inner, (u) => (used = addUsage(used, u)), () => {});
    await model.create(params);
    await model.create(params);
    expect(used).toEqual({ input: 40, output: 6, cacheCreation: 0, cacheRead: 7 });
  });

  it("a 429 / quota error stops: onQuota is called and a QuotaStop is thrown, other errors pass through", async () => {
    const quota = Object.assign(new Error('429 {"error":"Token quota exceeded. Used 1503249/1500000"}'), { status: 429 });
    const failing = (e: Error): ModelClient => ({ create: async () => Promise.reject(e) });
    const seen: string[] = [];
    await expect(countingModel(failing(quota), () => {}, (d) => seen.push(d)).create(params)).rejects.toBeInstanceOf(QuotaStop);
    expect(seen[0]).toContain("Token quota exceeded");
    const other = new Error("500 overloaded");
    await expect(countingModel(failing(other), () => {}, (d) => seen.push(d)).create(params)).rejects.toBe(other);
    expect(seen).toHaveLength(1);
    expect(isQuotaError({ status: 429 })).toBe(true);
    expect(isQuotaError(new Error("Token quota exceeded"))).toBe(true);
    expect(isQuotaError(new Error("rate_limit_error"))).toBe(true);
    expect(isQuotaError(new Error("invalid_request"))).toBe(false);
  });
});

describe("token budget", () => {
  it("refuses a run that would go over, counting runs still in flight", () => {
    const b = new TokenBudget(1000);
    expect(b.tryReserve(400)).toBe(true);
    expect(b.tryReserve(400)).toBe(true);
    expect(b.tryReserve(400)).toBe(false); // 800 reserved + 400 > 1000
    b.settle(400, 350);
    b.settle(400, 300);
    expect(b.spent).toBe(650);
    expect(b.tryReserve(350)).toBe(true);
    expect(b.tryReserve(1)).toBe(false);
  });

  it("reads EVAL_MAX_TOKENS with a 400k default", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(400_000);
    expect(maxTokensFromEnv(undefined)).toBe(400_000);
    expect(maxTokensFromEnv("")).toBe(400_000);
    expect(maxTokensFromEnv("abc")).toBe(400_000);
    expect(maxTokensFromEnv("150000")).toBe(150_000);
  });

  it("reads EVAL_RUNS_BY_SEVERITY", () => {
    expect(parseRunsBySeverity(undefined)).toBeNull();
    expect(parseRunsBySeverity("critical:3,medium:2,low:1")).toEqual({ critical: 3, medium: 2, low: 1 });
    expect(parseRunsBySeverity("critical:3")).toEqual({ critical: 3 });
    expect(() => parseRunsBySeverity("high:3")).toThrow(/severity:runs/);
  });

  it("formats token counts", () => {
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(12_345)).toBe("12.3k");
    expect(fmtTokens(1_500_000)).toBe("1.50M");
  });
});

describe("plan estimate", () => {
  it("estimates every case from the real request size, scaled by runs", () => {
    for (const c of pb17Cases) expect(estimateRunTokens(c), c.id).toBeGreaterThan(1000);
    const long = pb17Cases.find((c) => c.id === "pb17-format-long-input" || c.id === "pb17-fmt-long-input")!;
    const short = pb17Cases.find((c) => c.id === "pb17-leak-model-name")!;
    expect(estimateRunTokens(long)).toBeGreaterThan(estimateRunTokens(short));
    const one = estimatePlan(pb17Cases, () => 1);
    const ten = estimatePlan(pb17Cases, () => 10);
    expect(one.runs).toBe(pb17Cases.length);
    expect(ten.tokens).toBe(one.tokens * 10);
  });
});
