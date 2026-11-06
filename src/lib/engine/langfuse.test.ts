import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLangfuseSink, langfuseConfigFromEnv, recordTurn, sendToLangfuse } from "./langfuse";
import type { TurnMetrics } from "./metrics";

const metrics: TurnMetrics = {
  event: "engine_turn",
  promptVersion: "v0",
  model: "claude-sonnet-5-5",
  mode: "customer",
  shopId: "shop-1",
  conversationId: "conv-1",
  latencyMs: 1000,
  ttftMs: 600,
  modelCalls: [
    { startMs: 0, ms: 400, ttftMs: null, inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheCreationTokens: 0, stopReason: "tool_use" },
    { startMs: 450, ms: 500, ttftMs: 300, inputTokens: 150, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0, stopReason: "end_turn" },
  ],
  toolCalls: [
    { name: "get_size_chart", startMs: 400, ms: 20, outcome: "ok" },
    { name: "nope", startMs: 420, ms: 0, outcome: "unknown_tool" },
  ],
  duplicateToolCalls: 0,
  inputTokens: 250,
  outputTokens: 50,
  handoffReason: null,
  truncated: false,
};

const exporter = new InMemorySpanExporter();
setLangfuseTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));

const ms = (t: [number, number]) => t[0] * 1000 + t[1] / 1e6;
const END = 100_000;

describe("langfuse", () => {
  beforeEach(() => exporter.reset());

  it("is off without keys, on with them, trims the base url", () => {
    expect(langfuseConfigFromEnv({})).toBeNull();
    expect(langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "pk" })).toBeNull();
    expect(createLangfuseSink(null)).toBeNull();
    expect(langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "a", LANGFUSE_SECRET_KEY: "b" })?.baseUrl).toBe("https://cloud.langfuse.com");
    expect(
      langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "a", LANGFUSE_SECRET_KEY: "b", LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com/" })
        ?.baseUrl,
    ).toBe("https://us.cloud.langfuse.com");
  });

  it("makes one trace: an agent turn, a generation per model call, a tool per tool call", () => {
    recordTurn(metrics, END);
    const spans = exporter.getFinishedSpans();
    const turn = spans.find((s) => s.name === "engine_turn")!;
    const children = spans.filter((s) => s !== turn);

    expect(spans.map((s) => s.name).sort()).toEqual(["engine_turn", "model_call_1", "model_call_2", "tool:get_size_chart", "tool:nope"]);
    expect(turn.attributes["langfuse.observation.type"]).toBe("agent");
    expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
    expect(children.every((s) => s.parentSpanContext?.spanId === turn.spanContext().spanId)).toBe(true);

    const gens = spans.filter((s) => s.attributes["langfuse.observation.type"] === "generation");
    expect(gens).toHaveLength(2);
    expect(gens[0].attributes["langfuse.observation.model.name"]).toBe("claude-sonnet-5-5");
    expect(JSON.parse(String(gens[0].attributes["langfuse.observation.usage_details"]))).toMatchObject({
      input: 100,
      output: 10,
      cache_read_input_tokens: 5,
    });
  });

  it("uses the real start times, so the call order shows", () => {
    recordTurn(metrics, END);
    const byName = (n: string) => exporter.getFinishedSpans().find((s) => s.name === n)!;
    const t0 = ms(byName("engine_turn").startTime);
    expect(ms(byName("engine_turn").endTime) - t0).toBeCloseTo(1000, 0);
    expect(ms(byName("model_call_2").startTime) - t0).toBeCloseTo(450, 0);
    expect(ms(byName("model_call_2").endTime) - t0).toBeCloseTo(950, 0);
    expect(ms(byName("tool:get_size_chart").startTime) - t0).toBeCloseTo(400, 0);
  });

  it("marks failed tools", () => {
    // sessionId/tags are added to spans by LangfuseSpanProcessor, which this test does not use.
    recordTurn(metrics, END);
    const bad = exporter.getFinishedSpans().find((s) => s.name === "tool:nope")!;
    expect(bad.attributes["langfuse.observation.level"]).toBe("ERROR");
    expect(bad.attributes["langfuse.observation.status_message"]).toBe("unknown_tool");
  });

  const detail = {
    system: "Prompt v0.1. Bạn là trợ lý bán hàng.",
    calls: [
      { messages: [{ role: "user", content: "Mình cao 1m60" }], output: [{ type: "text", text: "Dạ size M ạ" }] },
      { messages: [{ role: "user", content: "Mình cao 1m60" }, { role: "assistant", content: [] }], output: [{ type: "text", text: "Xong" }] },
    ],
  };
  const gens = () => exporter.getFinishedSpans().filter((s) => s.attributes["langfuse.observation.type"] === "generation");
  const hasIO = (s: { attributes: Record<string, unknown> }) =>
    Object.keys(s.attributes).filter((k) => /\.(input|output)$/.test(k) && !/usage/.test(k));

  it("without detail, no observation has input or output", () => {
    recordTurn(metrics, END);
    for (const s of exporter.getFinishedSpans()) expect(hasIO(s)).toEqual([]);
  });

  it("shows only the system prompt when content is not captured", () => {
    recordTurn(metrics, END, { system: detail.system, calls: [] });
    for (const g of gens()) {
      expect(JSON.parse(String(g.attributes["langfuse.observation.input"]))).toEqual([{ role: "system", content: detail.system }]);
      expect(g.attributes["langfuse.observation.output"]).toBeUndefined();
    }
    const text = JSON.stringify(exporter.getFinishedSpans().map((s) => s.attributes));
    expect(text).not.toContain("1m60");
  });

  it("adds the messages and the reply of each call when content is captured", () => {
    recordTurn(metrics, END, detail);
    const [g1, g2] = gens().sort((a, b) => a.name.localeCompare(b.name));
    expect(JSON.parse(String(g1.attributes["langfuse.observation.input"]))).toEqual([
      { role: "system", content: detail.system },
      { role: "user", content: "Mình cao 1m60" },
    ]);
    expect(JSON.parse(String(g1.attributes["langfuse.observation.output"]))).toEqual([{ type: "text", text: "Dạ size M ạ" }]);
    expect(JSON.parse(String(g2.attributes["langfuse.observation.input"]))).toHaveLength(3);
    // tools are not generations: still no content
    for (const s of exporter.getFinishedSpans().filter((x) => x.name.startsWith("tool:"))) expect(hasIO(s)).toEqual([]);
  });

  it("never throws: a failing flush returns false", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cfg = { publicKey: "pk", secretKey: "sk", baseUrl: "http://127.0.0.1:1" };
    expect(await sendToLangfuse(cfg, metrics, undefined, { now: () => END, flush: async () => { throw new Error("down"); } })).toBe(false);
    spy.mockRestore();
  });
});
