import { describe, expect, it, vi } from "vitest";
import { buildLangfuseBatch, createLangfuseSink, langfuseConfigFromEnv, sendToLangfuse, type Fetch } from "./langfuse";
import type { TurnMetrics } from "./metrics";

const metrics: TurnMetrics = {
  event: "engine_turn",
  promptVersion: "v0",
  model: "claude-sonnet-5-5",
  mode: "customer",
  shopId: "shop-1",
  latencyMs: 1000,
  ttftMs: 600,
  modelCalls: [
    { ms: 400, ttftMs: null, inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheCreationTokens: 0, stopReason: "tool_use" },
    { ms: 500, ttftMs: 300, inputTokens: 150, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0, stopReason: "end_turn" },
  ],
  toolCalls: [
    { name: "get_size_chart", ms: 20, outcome: "ok" },
    { name: "nope", ms: 0, outcome: "unknown_tool" },
  ],
  duplicateToolCalls: 0,
  inputTokens: 250,
  outputTokens: 50,
  handoffReason: null,
  truncated: false,
};

const config = { publicKey: "pk", secretKey: "sk", baseUrl: "https://cloud.langfuse.com" };

describe("langfuse", () => {
  it("is off without keys, on with them, trims the base url", () => {
    expect(langfuseConfigFromEnv({})).toBeNull();
    expect(langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "pk" })).toBeNull();
    expect(createLangfuseSink(null)).toBeNull();
    expect(langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "a", LANGFUSE_SECRET_KEY: "b" })?.baseUrl).toBe(
      "https://cloud.langfuse.com",
    );
    expect(
      langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "a", LANGFUSE_SECRET_KEY: "b", LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com/" })
        ?.baseUrl,
    ).toBe("https://us.cloud.langfuse.com");
  });

  it("builds one trace, a generation per model call and a span per tool call", () => {
    let n = 0;
    const batch = buildLangfuseBatch(metrics, 10_000, () => `id${++n}`);
    expect(batch.map((e) => e.type)).toEqual(["trace-create", "generation-create", "generation-create", "span-create", "span-create"]);
    const trace = batch[0].body;
    expect(trace.timestamp).toBe(new Date(9000).toISOString());
    expect(batch.slice(1).every((e) => e.body.traceId === trace.id)).toBe(true);
    expect(batch[1].body.usageDetails).toMatchObject({ input: 100, output: 10, cache_read_input_tokens: 5 });
    expect(batch[2].body.completionStartTime).toBe(new Date(9300).toISOString());
    expect(batch[3].body.level).toBe("DEFAULT");
    expect(batch[4].body).toMatchObject({ level: "ERROR", statusMessage: "unknown_tool", name: "tool:nope" });
  });

  it("sends no message content: only keys from TurnMetrics reach the batch", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
    };
    walk(buildLangfuseBatch(metrics, 10_000));
    // usageDetails.input/output are token counts; Langfuse's content fields are
    // the top-level body.input/body.output, which must stay absent.
    for (const e of buildLangfuseBatch(metrics, 10_000)) expect(Object.keys(e.body)).not.toEqual(expect.arrayContaining(["input"]));
    for (const e of buildLangfuseBatch(metrics, 10_000)) expect("output" in e.body).toBe(false);
    for (const k of ["messages", "text", "content", "phone", "prompt"]) expect(keys.has(k)).toBe(false);
  });

  it("posts to the ingestion endpoint with basic auth", async () => {
    const fetch = vi.fn<Fetch>(async () => ({ ok: true, status: 207, text: async () => '{"successes":[],"errors":[]}' }));
    expect(await sendToLangfuse(config, metrics, { fetch, now: () => 10_000 })).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://cloud.langfuse.com/api/public/ingestion");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("pk:sk").toString("base64")}`);
    expect(JSON.parse(init.body).batch).toHaveLength(5);
  });

  it("never throws: http error, event errors and network failure return false", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = (status: number, body: string): Fetch => async () => ({ ok: status < 400, status, text: async () => body });
    expect(await sendToLangfuse(config, metrics, { fetch: bad(401, "unauthorized") })).toBe(false);
    expect(await sendToLangfuse(config, metrics, { fetch: bad(207, '{"errors":[{"id":"x","status":400}]}') })).toBe(false);
    expect(await sendToLangfuse(config, metrics, { fetch: async () => { throw new Error("down"); } })).toBe(false);
    spy.mockRestore();
  });
});
