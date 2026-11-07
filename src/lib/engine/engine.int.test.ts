import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicModel } from "./anthropic-model";
import { runEngine } from "./engine";
import type { TurnMetrics } from "./metrics";
import { FALLBACK_TEXT } from "./model-reply";
import { createSupabaseStore } from "./store";
import { finalJson, scriptedModel, toolCalls, toolUse } from "./test/fake-model";
import { FX, seedTwoShops } from "./test/two-shops";

const db = createAdminClient();
const store = createSupabaseStore(db);

async function turnRow(id: string | null) {
  expect(id).not.toBeNull();
  const { data, error } = await db.from("ai_turns").select("*").eq("id", id!).single();
  if (error) throw error;
  return data;
}

describe("runEngine on the real database", () => {
  beforeEach(() => seedTwoShops(db));

  it("shop A never sees shop B", async () => {
    const search = toolUse("search_products", { query: "vay suong linen" });
    const stock = toolUse("get_stock", { productId: FX.b.vay01 });
    const model = scriptedModel([
      toolCalls(search),
      toolCalls(stock),
      finalJson({ text: "Dạ còn ạ", productIds: [FX.b.vay01, FX.a.vay01], quickReplies: [] }),
    ]);
    const metrics: TurnMetrics[] = [];
    const result = await runEngine(
      {
        mode: "customer",
        conversationId: FX.a.conversation,
        history: [{ sender: "shopper", text: "váy suông linen còn không" }],
      },
      { model, db, store, onMetrics: (m) => metrics.push(m) },
    );

    const searchResult = model.calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    const searchContent = searchResult[0].content as string;
    expect(searchContent).toContain(FX.a.vay01);
    expect(searchContent).toContain("350000");
    expect(searchContent).not.toContain("420000");
    expect(searchContent).not.toContain(FX.b.vay01);

    const stockResult = model.calls[2].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(JSON.parse(stockResult[0].content as string).error).toBe("product_not_found");

    expect(result.output.reply.products).toEqual([
      { productId: FX.a.vay01, name: "Váy suông linen", price: 350000, imageUrl: null, sizesInStock: ["M"] },
    ]);

    const row = await turnRow(await result.turnLogged);
    const [m] = metrics;
    expect(row.shop_id).toBe(FX.a.shop);
    expect(row.tool_calls).toHaveLength(2);
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    expect(row.latency_ms).toBe(m.latencyMs);
    expect(m.toolCalls.map((c) => c.outcome)).toEqual(["ok", "product_not_found"]);
    expect(row.input_tokens).toBe(m.inputTokens);
    expect(row.output_tokens).toBe(m.outputTokens);
    expect(row.ttft_ms).toBe(m.ttftMs);
    expect(row.model_calls).toBe(m.modelCalls.length);
  });

  it("too many tool calls on real DB", async () => {
    const model = scriptedModel(Array.from({ length: 6 }, () => toolCalls(toolUse("get_policy", { kind: "doi_tra" }))));
    try {
      const result = await runEngine(
        { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text: "đổi trả sao" }] },
        { model, db, store, onMetrics: () => {} },
      );
      const { data: conversation } = await db.from("conversations").select("mode").eq("id", FX.a.conversation).single();
      expect(conversation?.mode).toBe("needs_human");
      const row = await turnRow(await result.turnLogged);
      expect(row.handoff_reason).toBe("too_many_tool_calls");
    } finally {
      await db.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation);
    }
  });
});

// Real Claude: runs only with ANTHROPIC_API_KEY in .env.test.local. CI never runs it.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("live Claude smoke test", () => {
  beforeEach(() => seedTwoShops(db));

  it("answers a stock question for shop A in staff_draft", { timeout: 120_000 }, async () => {
    const error = vi.spyOn(console, "error");
    const metrics: TurnMetrics[] = [];
    const result = await runEngine(
      { mode: "staff_draft", history: [{ sender: "shopper", text: "váy suông linen màu be size M còn không?" }] },
      { model: createAnthropicModel(new Anthropic()), db, store, staffShopId: FX.a.shop, onMetrics: (m) => metrics.push(m) },
    );
    const row = await turnRow(await result.turnLogged);
    const [m] = metrics;
    console.info(
      "live smoke:",
      JSON.stringify({
        latencyMs: m.latencyMs,
        ttftMs: m.ttftMs,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.modelCalls.reduce((s, c) => s + c.cacheReadTokens, 0),
        modelCalls: m.modelCalls.length,
        toolCalls: m.toolCalls.map((c) => `${c.name}:${c.outcome}`),
      }),
    );

    expect(result.output.reply.text.trim()).not.toBe("");
    expect(result.output.reply.text).not.toBe(FALLBACK_TEXT);
    expect(error.mock.calls.some((args) => String(args[0]).includes("max_tokens"))).toBe(false);
    const names = (row.tool_calls as { name: string }[]).map((c) => c.name);
    expect(names.some((n) => n === "get_stock" || n === "search_products")).toBe(true);
    expect(result.output.reply.text).not.toContain("420");
    expect(m.ttftMs).not.toBeNull();
    expect(m.ttftMs!).toBeGreaterThan(0);
    expect(m.ttftMs!).toBeLessThanOrEqual(m.latencyMs);
    expect(m.modelCalls.length).toBeGreaterThanOrEqual(1);
    expect(m.inputTokens).toBeGreaterThan(0);
    expect(m.outputTokens).toBeGreaterThan(0);
  });
});
