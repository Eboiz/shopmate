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

  it("PB-11 quotes two items, waits for confirmation, then stores two draft lines without taking stock", async () => {
    const items = [
      { variantId: FX.a.vay01MBe, quantity: 1 },
      { variantId: FX.a.ao03STrang, quantity: 1 },
    ];
    const shopperText = "Mình lấy váy linen be size M và áo sơ mi trắng size S, mỗi món 1 cái. Tên Thảo, số 0912345678, địa chỉ 12 Nguyễn Huệ, Q1.";
    const { error: policyError } = await db.from("policies").update({ content: "Nội thành phí 20.000đ; tỉnh khác 30.000đ." }).eq("shop_id", FX.a.shop).eq("kind", "giao_hang");
    if (policyError) throw policyError;
    const first = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text: shopperText }] },
      { model: scriptedModel([toolCalls(toolUse("quote_order", { items }))]), db, store, onMetrics: () => {} },
    );
    expect(first.output.reply.text).toContain("Tổng tiền hàng: 600.000đ (chưa gồm phí giao hàng)");
    expect(first.output.reply.text).toContain("Nội thành phí 20.000đ");
    expect(await first.turnLogged).not.toBeNull();
    const { count: before } = await db.from("orders").select("*", { count: "exact", head: true }).eq("shop_id", FX.a.shop);
    expect(before).toBe(0);

    const second = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [
        { sender: "shopper", text: shopperText },
        { sender: "ai", text: first.output.reply.text },
        { sender: "shopper", text: "Dạ mình xác nhận nha" },
      ] },
      { model: scriptedModel([toolCalls(toolUse("create_draft_order", {
        items, customerName: "Thảo", customerPhone: "0912345678", customerAddress: "12 Nguyễn Huệ, Q1",
      }))]), db, store, onMetrics: () => {} },
    );
    expect(second.output.reply.text).toContain("Nhân viên shop sẽ xác nhận");
    const { data: order, error } = await db.from("orders").select("id, status, total, customer_name, customer_phone, customer_address").eq("shop_id", FX.a.shop).single();
    if (error) throw error;
    expect(order).toMatchObject({ status: "draft", total: 600000, customer_name: "Thảo", customer_phone: "0912345678", customer_address: "12 Nguyễn Huệ, Q1" });
    const { data: lines } = await db.from("order_items").select("variant_id, quantity, unit_price").eq("order_id", order.id);
    expect(lines).toEqual(expect.arrayContaining([
      { variant_id: FX.a.vay01MBe, quantity: 1, unit_price: 350000 },
      { variant_id: FX.a.ao03STrang, quantity: 1, unit_price: 250000 },
    ]));
    expect(lines).toHaveLength(2);
    const { data: stocks } = await db.from("variants").select("id, stock").in("id", items.map((item) => item.variantId));
    expect(stocks).toEqual(expect.arrayContaining([{ id: FX.a.vay01MBe, stock: 2 }, { id: FX.a.ao03STrang, stock: 3 }]));
  });

  it("PB-11 refuses a variant sold out after the quote and suggests only in-stock alternatives", async () => {
    const items = [{ variantId: FX.a.vay01MBe, quantity: 1 }];
    const shopperText = "Mình lấy váy linen be size M 1 cái. Tên Thảo, số 0912345678, địa chỉ Q1.";
    const quoted = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text: shopperText }] },
      { model: scriptedModel([toolCalls(toolUse("quote_order", { items }))]), db, store, onMetrics: () => {} },
    );
    await quoted.turnLogged;
    const { error: stockError } = await db.from("variants").update({ stock: 0 }).eq("id", FX.a.vay01MBe).eq("shop_id", FX.a.shop);
    if (stockError) throw stockError;
    const result = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [
        { sender: "shopper", text: shopperText },
        { sender: "ai", text: quoted.output.reply.text },
        { sender: "shopper", text: "xác nhận" },
      ] },
      { model: scriptedModel([toolCalls(toolUse("create_draft_order", {
        items, customerName: "Thảo", customerPhone: "0912345678", customerAddress: "Q1",
      }))]), db, store, onMetrics: () => {} },
    );
    expect(result.output.reply.text).toContain("chưa tạo đơn");
    expect(result.output.reply.text).toContain("size M màu đen");
    const { count } = await db.from("orders").select("*", { count: "exact", head: true }).eq("shop_id", FX.a.shop);
    expect(count).toBe(0);
  });

  it("PB-11 asks again for an invalid Vietnamese mobile number and writes no order", async () => {
    const items = [{ variantId: FX.a.vay01MBe, quantity: 1 }];
    const shopperText = "Mình lấy váy linen be size M 1 cái. Tên Thảo, số 912345678, địa chỉ Q1.";
    const quoted = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text: shopperText }] },
      { model: scriptedModel([toolCalls(toolUse("quote_order", { items }))]), db, store, onMetrics: () => {} },
    );
    await quoted.turnLogged;
    const model = scriptedModel([
      toolCalls(toolUse("create_draft_order", {
        items, customerName: "Thảo", customerPhone: "912345678", customerAddress: "Q1",
      })),
      finalJson({ text: "Đã tạo đơn", productIds: [], quickReplies: [] }),
    ]);
    const result = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [
        { sender: "shopper", text: shopperText },
        { sender: "ai", text: quoted.output.reply.text },
        { sender: "shopper", text: "xác nhận" },
      ] },
      { model, db, store, onMetrics: () => {} },
    );
    expect(result.output.reply.text).toContain("10 chữ số");
    expect(result.output.reply.text).not.toContain("Đã tạo đơn");
    const { count } = await db.from("orders").select("*", { count: "exact", head: true }).eq("shop_id", FX.a.shop);
    expect(count).toBe(0);
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

  // PB-06 AC4 with the real recommend_size and size charts: the model answers
  // instead of calling handoff_to_staff, and the engine still hands off.
  it.each([
    ["outside the chart", FX.a.vay01, "cao 1m80 nặng 75kg mặc size nào?", "size_out_of_range", "ngoài bảng size"],
    ["product without a chart", FX.a.ao03, "cao 1m60 nặng 50kg mặc size nào?", "not_covered_by_data", "chưa có bảng size"],
  ] as const)("size %s: says it can't advise and sets needs_human", async (_label, productId, text, reason, says) => {
    const model = scriptedModel([
      toolCalls(toolUse("recommend_size", { productId, heightCm: 160, weightKg: 50 })),
      finalJson({ text: "Dạ bạn mặc size M nhé", productIds: [], quickReplies: [] }),
    ]);
    try {
      const result = await runEngine(
        { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text }], productId },
        { model, db, store, onMetrics: () => {} },
      );
      expect(result.handoffReason).toBe(reason);
      expect(result.output.reply.text).toContain(says);
      const { data: conversation } = await db.from("conversations").select("mode").eq("id", FX.a.conversation).single();
      expect(conversation?.mode).toBe("needs_human");
      const row = await turnRow(await result.turnLogged);
      expect(row.handoff_reason).toBe(reason);
      // The shopper's own numbers reached the size function, not the model's 160 / 50.
      const call = (row.tool_calls as { name: string; input: { heightCm: number; weightKg: number } }[])[0];
      expect(call.input).toMatchObject({ heightCm: Number(text.match(/1m(\d+)/)![1]) + 100, weightKg: Number(text.match(/(\d+)kg/)![1]) });
    } finally {
      await db.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation);
    }
  });

  it("size inside the chart: the reply names the size the function computed", async () => {
    // 158 cm / 50 kg on Váy suông linen is M; the model says L twice, so the
    // engine writes the reply from the tool result.
    const model = scriptedModel([
      toolCalls(toolUse("recommend_size", { productId: FX.a.vay01, heightCm: 158, weightKg: 50 })),
      finalJson({ text: "Dạ bạn mặc size L nhé", productIds: [], quickReplies: [] }),
      finalJson({ text: "Dạ size L ạ", productIds: [], quickReplies: [] }),
    ]);
    const result = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text: "cao 158cm nặng 50kg mặc size gì?" }], productId: FX.a.vay01 },
      { model, db, store, onMetrics: () => {} },
    );
    expect(result.handoffReason).toBeNull();
    expect(result.output.reply.text).toContain("size M");
    expect(result.output.reply.text).not.toContain("size L");
    expect(result.output.reply.products.map((p) => p.productId)).toEqual([FX.a.vay01]);
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
