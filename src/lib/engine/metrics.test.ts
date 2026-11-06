import { describe, expect, it } from "vitest";
import type { Tables } from "@/contract";
import {
  countDuplicateCalls,
  percentile,
  sampleFromMetrics,
  sampleFromTurnRow,
  summarize,
  toolOutcome,
  type TurnSample,
} from "./metrics";

describe("toolOutcome", () => {
  it("is ok for a successful run", () => {
    expect(toolOutcome({ log: null, content: "{}", isError: false })).toBe("ok");
  });

  it("is the error code otherwise", () => {
    expect(toolOutcome({ log: null, content: '{"error":"tool_not_allowed"}', isError: true })).toBe("tool_not_allowed");
    expect(toolOutcome({ log: null, content: '{"error":"invalid_input","details":"…"}', isError: true })).toBe(
      "invalid_input",
    );
  });
});

describe("countDuplicateCalls", () => {
  it("compares inputs with sorted keys and doesn't count the first call", () => {
    expect(
      countDuplicateCalls([
        { name: "get_stock", input: { productId: "p", size: "M" } },
        { name: "get_stock", input: { size: "M", productId: "p" } },
      ]),
    ).toBe(1);
    expect(
      countDuplicateCalls([
        { name: "get_policy", input: { kind: "doi_tra" } },
        { name: "get_policy", input: { kind: "giao_hang" } },
        { name: "get_stock", input: { kind: "doi_tra" } },
      ]),
    ).toBe(0);
    expect(countDuplicateCalls([{ name: "a", input: {} }, { name: "a", input: {} }, { name: "a", input: {} }])).toBe(2);
    expect(countDuplicateCalls([])).toBe(0);
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1).reverse();
    expect([50, 90, 99, 100].map((p) => percentile(values, p))).toEqual([50, 90, 99, 100]);
    expect([50, 90, 99].map((p) => percentile([10], p))).toEqual([10, 10, 10]);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });
});

const row = (over: Partial<Tables<"ai_turns">>): Tables<"ai_turns"> => ({
  id: "t",
  shop_id: "s",
  conversation_id: null,
  mode: "customer",
  latency_ms: 100,
  tool_calls: [],
  postcheck: null,
  handoff_reason: null,
  input_tokens: 1,
  output_tokens: 2,
  created_at: "2026-11-06T00:00:00Z",
  ttft_ms: null,
  model_calls: 0,
  model: null,
  prompt_version: null,
  ...over,
});

describe("sampleFromTurnRow", () => {
  it("reads ttft and model calls, 0 meaning unknown", () => {
    expect(sampleFromTurnRow(row({ ttft_ms: 120, model_calls: 3 }))).toMatchObject({ ttftMs: 120, modelCalls: 3 });
    expect(sampleFromTurnRow(row({ model_calls: 0 })).modelCalls).toBeNull();
    expect(sampleFromTurnRow(row({ ttft_ms: null })).ttftMs).toBeNull();
  });

  it("derives each tool outcome from the log", () => {
    const sample = sampleFromTurnRow(
      row({
        tool_calls: [
          { name: "get_stock", input: {}, output: {} },
          { name: "get_stock", input: {}, error: "internal_error: db down" },
          { name: "search_products", input: {}, error: "invalid_input" },
        ],
      }),
    );
    expect(sample.toolCalls).toEqual([
      { name: "get_stock", outcome: "ok" },
      { name: "get_stock", outcome: "internal_error" },
      { name: "search_products", outcome: "invalid_input" },
    ]);
  });
});

describe("sampleFromMetrics", () => {
  it("keeps the measurements", () => {
    const sample = sampleFromMetrics({
      event: "engine_turn",
      promptVersion: "v0",
      model: "m",
      mode: "staff_draft",
      shopId: "s",
      latencyMs: 300,
      ttftMs: 120,
      modelCalls: [
        { ms: 1, ttftMs: null, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, stopReason: "tool_use" },
        { ms: 1, ttftMs: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, stopReason: "end_turn" },
      ],
      toolCalls: [{ name: "get_stock", ms: 5, outcome: "ok" }],
      duplicateToolCalls: 0,
      inputTokens: 2,
      outputTokens: 2,
      handoffReason: null,
      truncated: false,
    });
    expect(sample).toEqual({
      mode: "staff_draft",
      latencyMs: 300,
      ttftMs: 120,
      inputTokens: 2,
      outputTokens: 2,
      modelCalls: 2,
      toolCalls: [{ name: "get_stock", outcome: "ok" }],
      handoffReason: null,
    });
  });
});

const sample = (over: Partial<TurnSample>): TurnSample => ({
  mode: "customer",
  latencyMs: 100,
  ttftMs: null,
  inputTokens: 10,
  outputTokens: 5,
  modelCalls: 1,
  toolCalls: [],
  handoffReason: null,
  ...over,
});

describe("summarize", () => {
  it("computes latency percentiles and tool rates per mode and tool use", () => {
    const outcomes = ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "invalid_input", "product_not_found"];
    const samples = Array.from({ length: 10 }, (_, i) =>
      sample({
        latencyMs: (i + 1) * 100,
        ttftMs: (i + 1) * 10,
        toolCalls: [{ name: i < 5 ? "get_stock" : "search_products", outcome: outcomes[i] }],
      }),
    );
    const noTools = [sample({ latencyMs: 7 }), sample({ latencyMs: 9 })];
    const staff = [sample({ mode: "staff_draft", latencyMs: 5000 })];
    const s = summarize([...samples, ...noTools, ...staff]);

    const withTools = s.byMode.customer.withTools;
    expect(withTools.turns).toBe(10);
    expect(withTools.latency).toEqual({ p50: 500, p90: 900, p99: 1000 });
    expect(withTools.ttft).toEqual({ p50: 50, p90: 90, p99: 100, n: 10 });
    expect(withTools.tools.total).toBe(10);
    expect(withTools.tools.okRate).toBeCloseTo(0.8);
    expect(withTools.tools.invalidInputRate).toBeCloseTo(0.1);
    expect(withTools.tools.notFoundRate).toBeCloseTo(0.1);
    expect(withTools.tools.byOutcome).toEqual({ ok: 8, invalid_input: 1, product_not_found: 1 });
    expect(withTools.tools.byTool).toEqual({
      get_stock: { total: 5, okRate: 1 },
      search_products: { total: 5, okRate: 0.6 },
    });

    expect(s.byMode.customer.noTools.turns).toBe(2);
    expect(s.byMode.customer.noTools.latency.p50).toBe(7);
    expect(s.byMode.customer.noTools.ttft).toEqual({ p50: null, p90: null, p99: null, n: 0 });
    expect(s.byMode.staff_draft.noTools.turns).toBe(1);
    expect(s.byMode.staff_draft.noTools.latency.p50).toBe(5000);
    expect(s.byMode.customer.noTools.latency.p99).toBe(9);
  });

  it("averages calls over turns without a handoff, and knows when model calls are unknown", () => {
    const unknown = summarize([sample({ modelCalls: null }), sample({ modelCalls: null })]);
    expect(unknown.byMode.customer.noTools.calls.modelAvg).toBeNull();

    const s = summarize([
      sample({ modelCalls: 2, toolCalls: [{ name: "get_stock", outcome: "ok" }] }),
      sample({ modelCalls: 4, toolCalls: [{ name: "get_stock", outcome: "ok" }, { name: "get_stock", outcome: "ok" }, { name: "get_stock", outcome: "ok" }] }),
      sample({
        modelCalls: 6,
        toolCalls: Array.from({ length: 5 }, () => ({ name: "get_policy", outcome: "ok" })),
        handoffReason: "too_many_tool_calls",
      }),
    ]);
    const g = s.byMode.customer.withTools;
    expect(g.calls.modelAvg).toBe(3);
    expect(g.calls.toolAvg).toBe(2);
    expect(g.handoff.rate).toBeCloseTo(1 / 3);
    expect(g.handoff.byReason).toEqual({ too_many_tool_calls: 1 });
    expect(g.tokens).toEqual({ inputAvg: 10, outputAvg: 5, inputTotal: 30, outputTotal: 15 });
  });

  it("handles no samples", () => {
    const s = summarize([]);
    for (const mode of ["customer", "staff_draft"] as const) {
      for (const g of [s.byMode[mode].noTools, s.byMode[mode].withTools]) {
        expect(g.turns).toBe(0);
        expect(g.latency).toEqual({ p50: null, p90: null, p99: null });
        expect(g.tools.okRate).toBeNull();
        expect(g.tokens.inputAvg).toBeNull();
        expect(g.calls).toEqual({ modelAvg: null, toolAvg: null });
        expect(g.handoff.rate).toBeNull();
      }
    }
  });
});
