import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  engineOutputSchema,
  toolCallLogSchema,
  type EngineInput,
  type ProductCard,
  type ToolName,
} from "@/contract";
import {
  HANDOFF_TEXT,
  MAX_OUTPUT_TOKENS,
  NO_SIZE_CHART_HANDOFF_TEXT,
  PRODUCT_NOT_FOUND_HANDOFF_TEXT,
  SIZE_OUT_OF_RANGE_HANDOFF_TEXT,
  runBatch,
  runEngine,
  STAFF_DRAFT_GIVE_UP_TEXT,
  type EngineDeps,
  type EngineResult,
} from "./engine";
import { FALLBACK_TEXT, MODEL_REPLY_JSON_SCHEMA } from "./model-reply";
import { DISCOUNT_HANDOFF_TEXT } from "./discount-guard";
import { PROMPT_VERSION } from "./prompt";
import type { EngineStore, TurnContext } from "./store";
import { finalJson, scriptedModel, toolCalls, toolUse, type ScriptedResponse } from "./test/fake-model";
import type { TurnDetail, TurnMetrics } from "./metrics";
import { ToolError, type Db, type ToolHandlers } from "./types";

const SHOP_A = "a0000000-0000-4000-8000-000000000001";
const SHOP_B = "b0000000-0000-4000-8000-000000000001";
const CONV = "a0000000-0000-4000-8000-000000000031";
const PRODUCT = "a0000000-0000-4000-8000-000000000011";
const VARIANT = "a0000000-0000-4000-8000-000000000021";
const ORDER = "a0000000-0000-4000-8000-000000000061";
const SECRET_TEXT = "Tôi tên Thảo, số 0912345678";

const customerInput = (extra: Partial<EngineInput> = {}): EngineInput =>
  ({ mode: "customer", conversationId: CONV, history: [{ sender: "shopper", text: SECRET_TEXT }], ...extra }) as EngineInput;
const staffInput = (): EngineInput => ({ mode: "staff_draft", history: [{ sender: "shopper", text: "váy còn không" }] });

const card = (productId: string): ProductCard => ({
  productId,
  name: "Váy suông linen",
  price: 350000,
  imageUrl: null,
  sizesInStock: ["M"],
});

type Handler = (...args: unknown[]) => Promise<unknown>;
const handler = (impl: Handler) => vi.fn<Handler>(impl);

function fakeStore(context: TurnContext = { conversation: { shopId: SHOP_A, mode: "ai" }, product: null }) {
  return {
    loadTurnContext: vi.fn<EngineStore["loadTurnContext"]>(async () => context),
    productCards: vi.fn<EngineStore["productCards"]>(async (_shopId, ids) => ids.map(card)),
    setNeedsHuman: vi.fn<EngineStore["setNeedsHuman"]>(async () => {}),
    setAiMode: vi.fn<NonNullable<EngineStore["setAiMode"]>>(async () => {}),
    insertTurn: vi.fn<EngineStore["insertTurn"]>(async () => "turn-1"),
  };
}

const stockOut = { productId: PRODUCT, name: "Váy suông linen", price: 350000, variants: [] };
const quoteOut = { lines: [], total: 0 };
const orderQuote = { lines: [{
  variantId: VARIANT, productId: PRODUCT, name: "Váy suông linen", size: "M", color: "be",
  quantity: 1, unitPrice: 350000, lineTotal: 350000,
}], total: 350000 };
const orderHistory: EngineInput["history"] = [
  { sender: "shopper", text: "Mình lấy váy size M màu be, tên Thảo, số 0912345678, giao tới Q1." },
  { sender: "ai", text: "Dạ, đơn hàng dự kiến:\n1. Váy suông linen...\nBạn xác nhận đơn này chứ?" },
  { sender: "shopper", text: "Dạ mình xác nhận nha" },
];
const orderStore = () => fakeStore({
  conversation: { shopId: SHOP_A, mode: "ai" }, product: null,
  previousQuote: { items: draftOrder.items, quote: orderQuote },
});

function fakeHandlers() {
  return {
    search_products: handler(async () => ({ products: [] })),
    get_stock: handler(async () => stockOut),
    recommend_size: handler(async () => ({ status: "no_chart" })),
    get_pairings: handler(async () => ({ pairings: [] })),
    get_policy: handler(async () => ({ kind: "doi_tra", content: "Đổi trong 7 ngày" })),
    quote_order: handler(async () => quoteOut),
    create_draft_order: handler(async () => ({ status: "created", orderId: ORDER, total: 1 })),
    handoff_to_staff: handler(async () => ({ mode: "needs_human" })),
  };
}

const draftOrder = { items: [{ variantId: VARIANT, quantity: 1 }], customerName: "Thảo", customerPhone: "0912345678", customerAddress: "Q1" };
const reply = (text = "Chào bạn", productIds: string[] = []) => finalJson({ text, productIds, quickReplies: [] });

let clock: { t: number };
let results: EngineResult[];

function setup(responses: ScriptedResponse[], over: { store?: ReturnType<typeof fakeStore>; deps?: Partial<EngineDeps> } = {}) {
  const store = over.store ?? fakeStore();
  const handlers = fakeHandlers();
  const model = scriptedModel(responses, clock);
  const onMetrics = vi.fn<(m: TurnMetrics, detail?: TurnDetail) => void>();
  const deps: Partial<EngineDeps> = {
    model,
    store,
    handlers: handlers as unknown as ToolHandlers,
    db: {} as Db,
    now: () => clock.t,
    modelName: "test-model",
    onMetrics,
    ...over.deps,
  };
  const run = async (input: EngineInput) => {
    const result = await runEngine(input, deps);
    results.push(result);
    return result;
  };
  return { store, handlers, model, onMetrics, run };
}

const toolResults = (params: Anthropic.MessageCreateParamsNonStreaming) => {
  const last = params.messages.at(-1)!;
  return (last.content as Anthropic.ToolResultBlockParam[]).filter((b) => b.type === "tool_result");
};

beforeEach(() => {
  clock = { t: 1000 };
  results = [];
});

afterEach(() => {
  // output always matches the contract
  for (const r of results) expect(() => engineOutputSchema.parse(r.output)).not.toThrow();
  vi.restoreAllMocks();
});

describe("runEngine", () => {
  it("answers without tools", async () => {
    const { store, run } = setup([reply("Chào bạn", [PRODUCT])]);
    const result = await run(customerInput());
    expect(result.output.reply).toEqual({ text: "Chào bạn", products: [card(PRODUCT)], quickReplies: [] });
    expect(store.productCards).toHaveBeenCalledWith(SHOP_A, [PRODUCT]);
    expect(result.handoffReason).toBeNull();
    expect(result.output.personalReplyNeeded).toBe(false);
  });

  describe("PB-11 ordering in chat", () => {
    it("reads back only quote_order prices and the separate shipping policy before confirmation", async () => {
      const { handlers, store, model, run } = setup([
        toolCalls(toolUse("quote_order", { items: draftOrder.items }), toolUse("create_draft_order", draftOrder)),
      ]);
      handlers.quote_order.mockResolvedValue(orderQuote);
      handlers.get_policy.mockResolvedValue({ kind: "giao_hang", content: "Nội thành 20.000đ, miễn phí từ 500.000đ." });
      const result = await run(customerInput({ history: [
        { sender: "shopper", text: "Mình lấy váy size M màu be, tên Thảo, số 0912345678, giao tới Q1." },
      ] }));
      expect(handlers.create_draft_order).not.toHaveBeenCalled();
      expect(handlers.get_policy).toHaveBeenCalledWith({ kind: "giao_hang" }, expect.anything(), expect.anything());
      expect(result.output.reply.text).toContain("350.000đ/món");
      expect(result.output.reply.text).toContain("Tổng tiền hàng: 350.000đ (chưa gồm phí giao hàng)");
      expect(result.output.reply.text).toContain("Nội thành 20.000đ");
      expect(result.output.reply.text).toContain("Bạn xác nhận đơn này chứ?");
      expect(model.calls).toHaveLength(1);
      expect(store.insertTurn).toHaveBeenCalledTimes(1);
    });

    it("creates one draft after explicit confirmation, using the quoted items", async () => {
      const { handlers, run } = setup([toolCalls(toolUse("create_draft_order", draftOrder))], { store: orderStore() });
      handlers.quote_order.mockResolvedValue(orderQuote);
      const result = await run(customerInput({ history: orderHistory }));
      expect(handlers.create_draft_order).toHaveBeenCalledTimes(1);
      expect(result.output.reply.text).toContain("Nhân viên shop sẽ xác nhận");
      expect(result.output.reply.text).toContain("COD");
    });

    it("blocks a write before confirmation or when the customer changes the items", async () => {
      const before = setup([toolCalls(toolUse("create_draft_order", draftOrder)), reply()], { store: orderStore() });
      const first = await before.run(customerInput({ history: [orderHistory[0]] }));
      expect(before.handlers.create_draft_order).not.toHaveBeenCalled();
      expect(first.output.reply.text).toContain("xin bạn xác nhận");

      const changed = setup([toolCalls(toolUse("create_draft_order", { ...draftOrder, items: [{ variantId: VARIANT, quantity: 2 }] })), reply()], { store: orderStore() });
      const second = await changed.run(customerInput({ history: orderHistory }));
      expect(changed.handlers.create_draft_order).not.toHaveBeenCalled();
      expect(second.output.reply.text).toContain("báo giá đúng các món");
    });

    it("asks again for an invalid phone and never writes", async () => {
      const invalid = { ...draftOrder, customerPhone: "912345678" };
      const { handlers, run } = setup([toolCalls(toolUse("create_draft_order", invalid)), reply()], { store: orderStore() });
      const result = await run(customerInput({ history: orderHistory }));
      expect(handlers.create_draft_order).not.toHaveBeenCalled();
      expect(result.output.reply.text).toContain("10 chữ số");
    });

    it("re-quotes a changed price and requires a new confirmation before writing", async () => {
      const { handlers, run } = setup([toolCalls(toolUse("create_draft_order", draftOrder))], { store: orderStore() });
      handlers.quote_order.mockResolvedValue({
        lines: [{ ...orderQuote.lines[0], unitPrice: 360000, lineTotal: 360000 }], total: 360000,
      });
      handlers.get_policy.mockResolvedValue({ kind: "giao_hang", content: "Phí 20.000đ" });
      const result = await run(customerInput({ history: orderHistory }));
      expect(handlers.create_draft_order).not.toHaveBeenCalled();
      expect(result.output.reply.text).toContain("360.000đ");
      expect(result.output.reply.text).toContain("Bạn xác nhận đơn này chứ?");
    });

    it("reports a sold-out item and offers only variants still in stock", async () => {
      const { handlers, run } = setup([toolCalls(toolUse("create_draft_order", draftOrder))], { store: orderStore() });
      handlers.quote_order.mockResolvedValue(orderQuote);
      handlers.create_draft_order.mockResolvedValue({ status: "out_of_stock", variantIds: [VARIANT] });
      handlers.get_stock.mockResolvedValue({ productId: PRODUCT, name: "Váy suông linen", price: 350000, variants: [
        { variantId: VARIANT, size: "M", color: "be", stock: 0 },
        { variantId: "a0000000-0000-4000-8000-000000000022", size: "L", color: "be", stock: 3 },
      ] });
      const result = await run(customerInput({ history: orderHistory }));
      expect(result.output.reply.text).toContain("chưa tạo đơn");
      expect(result.output.reply.text).toContain("size L màu be");
      expect(handlers.get_stock).toHaveBeenCalledWith({ productId: PRODUCT }, expect.anything(), expect.anything());
    });
  });

  it("enforces the shopper's size and builds pairing cards and reasons from tool data", async () => {
    const pair = {
      productId: PRODUCT, name: "Váy suông linen", price: 350000,
      imageUrl: null, reason: "Áo trắng hợp váy be", sizesInStock: ["M"],
    };
    const foreign = "b0000000-0000-4000-8000-000000000011";
    const store = fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy suông linen" } });
    const { handlers, run } = setup([
      toolCalls(toolUse("get_pairings", { productId: foreign, size: "S" })),
      reply("Mình gợi ý món không có trong cặp", [foreign]),
    ], { store });
    handlers.get_pairings.mockResolvedValue({ pairings: [pair] });
    const result = await run(customerInput({ productId: PRODUCT, history: [{ sender: "shopper", text: "Mình size M, gợi ý đồ phối" }] }));
    expect(handlers.get_pairings.mock.calls[0][0]).toEqual({ productId: PRODUCT, size: "M" });
    expect(store.productCards).toHaveBeenCalledWith(SHOP_A, [PRODUCT]);
    expect(result.output.reply.products).toEqual([card(PRODUCT)]);
    expect(result.output.reply.text).toContain("Áo trắng hợp váy be");
    expect(result.output.reply.text).not.toContain("món không có trong cặp");
  });

  it("does not show invented matching items when get_pairings is empty", async () => {
    const { store, run } = setup([
      toolCalls(toolUse("get_pairings", { productId: PRODUCT })),
      reply("Gợi ý áo ngẫu nhiên", [PRODUCT]),
    ]);
    const result = await run(customerInput());
    expect(result.output.reply.products).toEqual([]);
    expect(result.output.reply.text).not.toContain("áo ngẫu nhiên");
    expect(store.productCards).not.toHaveBeenCalled();
  });

  it("queries declared pairings when the model forgets the tool", async () => {
    const store = fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy suông linen" } });
    const { handlers, run } = setup([reply("Áo tưởng tượng hợp váy này", [PRODUCT])], { store });
    handlers.get_pairings.mockResolvedValue({ pairings: [{
      productId: PRODUCT, name: "Váy suông linen", price: 350000,
      imageUrl: null, reason: "Hạnh chọn vì cùng tông", sizesInStock: ["M"],
    }] });
    const result = await run(customerInput({
      productId: PRODUCT,
      history: [{ sender: "shopper", text: "Mình size M, gợi ý món phối với váy này" }],
    }));
    expect(handlers.get_pairings.mock.calls[0][0]).toEqual({ productId: PRODUCT, size: "M" });
    expect(result.output.reply.text).toContain("Hạnh chọn vì cùng tông");
    expect(result.output.reply.text).not.toContain("Áo tưởng tượng");
  });

  it("asks for the product when a matching question has no product or tool result", async () => {
    const { handlers, run } = setup([reply("Mình nghĩ áo lạ hợp", [PRODUCT])]);
    const result = await run(customerInput({ history: [{ sender: "shopper", text: "Gợi ý đồ phối" }] }));
    expect(handlers.get_pairings).not.toHaveBeenCalled();
    expect(result.output.reply.products).toEqual([]);
    expect(result.output.reply.text).toContain("sản phẩm nào");
  });

  it("server adds shop_id", async () => {
    const use = toolUse("search_products", { query: "váy" });
    const { handlers, model, run } = setup([toolCalls(use), reply()]);
    await run(customerInput());
    expect(handlers.search_products.mock.calls[0][1]).toEqual({ shopId: SHOP_A, conversationId: CONV });
    expect(toolResults(model.calls[1])).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: use.id, is_error: false }),
    ]);
  });

  describe("staff_draft", () => {
    it("gets its shop from deps, never from the input", async () => {
      const store = fakeStore({ conversation: null, product: null });
      const { handlers, model, run } = setup([toolCalls(toolUse("get_policy", { kind: "doi_tra" })), reply()], {
        store,
        deps: { staffShopId: SHOP_A },
      });
      await run(staffInput());
      expect(store.loadTurnContext).toHaveBeenCalledWith({ conversationId: null, shopId: SHOP_A, productId: null });
      expect(handlers.get_policy.mock.calls[0][1]).toEqual({ shopId: SHOP_A, conversationId: null });
      const names = (model.calls[0].tools as Anthropic.Tool[]).map((t) => t.name);
      expect(names).not.toContain("create_draft_order");
      expect(names).not.toContain("handoff_to_staff");
      expect(names).toContain("get_stock");
    });

    it("marks a complaint as personalReplyNeeded without calling the model (PB-20)", async () => {
      const store = fakeStore({ conversation: null, product: null });
      const { model, onMetrics, run } = setup([reply()], { store, deps: { staffShopId: SHOP_A } });
      const result = await run({ mode: "staff_draft", history: [{ sender: "shopper", text: "Áo nhận về bị rách, mình muốn khiếu nại" }] });
      expect(result.output.personalReplyNeeded).toBe(true);
      expect(result.output.reply.products).toEqual([]);
      expect(model.calls).toHaveLength(0);
      expect(store.loadTurnContext).not.toHaveBeenCalled();
      expect(onMetrics).not.toHaveBeenCalled();
      expect(await result.turnLogged).toBeNull();
    });

    it("drafts a normal question (personalReplyNeeded false)", async () => {
      const store = fakeStore({ conversation: null, product: null });
      const { model, run } = setup([reply("Dạ còn size M ạ")], { store, deps: { staffShopId: SHOP_A } });
      const result = await run(staffInput());
      expect(result.output).toEqual({
        reply: { text: "Dạ còn size M ạ", products: [], quickReplies: [] },
        personalReplyNeeded: false,
      });
      expect(model.calls).toHaveLength(1);
    });

    it("leaves complaint detection in customer mode to the model's handoff", async () => {
      const { model, run } = setup([reply("Dạ")]);
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "mình muốn khiếu nại" }] }));
      expect(result.output.personalReplyNeeded).toBe(false);
      expect(model.calls).toHaveLength(1);
    });

    it("refuses to run without a resolved staff shop", async () => {
      const { store, model, run } = setup([reply()]);
      await expect(run(staffInput())).rejects.toMatchObject({ code: "staff_shop_not_resolved" });
      expect(store.loadTurnContext).not.toHaveBeenCalled();
      expect(model.calls).toHaveLength(0);
    });

    it("rejects a shopId in the input", async () => {
      const { run } = setup([reply()], { deps: { staffShopId: SHOP_A } });
      await expect(run({ ...staffInput(), shopId: SHOP_B } as unknown as EngineInput)).rejects.toThrow();
    });

    it("blocks write tools in staff_draft in code", async () => {
      const store = fakeStore({ conversation: null, product: null });
      const { handlers, model, run } = setup(
        [toolCalls(toolUse("create_draft_order", draftOrder), toolUse("handoff_to_staff", { reason: "complaint" })), reply("Nháp")],
        { store, deps: { staffShopId: SHOP_A } },
      );
      const result = await run(staffInput());
      expect(handlers.create_draft_order).not.toHaveBeenCalled();
      expect(handlers.handoff_to_staff).not.toHaveBeenCalled();
      for (const r of toolResults(model.calls[1])) {
        expect(r.is_error).toBe(true);
        expect(JSON.parse(r.content as string).error).toBe("tool_not_allowed");
      }
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
      expect(result.output.reply.text).toBe("Nháp");
    });

    it("keeps calling a blocked tool until the call limit", async () => {
      const store = fakeStore({ conversation: null, product: null });
      const responses = Array.from({ length: 6 }, () => toolCalls(toolUse("create_draft_order", draftOrder)));
      const { handlers, model, run } = setup(responses, { store, deps: { staffShopId: SHOP_A } });
      const result = await run(staffInput());
      expect(model.calls).toHaveLength(6);
      expect(handlers.create_draft_order).not.toHaveBeenCalled();
      for (const call of model.calls.slice(1)) {
        const [r] = toolResults(call);
        expect(r.is_error).toBe(true);
        expect(JSON.parse(r.content as string).error).toBe("tool_not_allowed");
      }
      expect(result.handoffReason).toBe("too_many_tool_calls");
      expect(result.output.reply.text).toBe(STAFF_DRAFT_GIVE_UP_TEXT);
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
      await result.turnLogged;
      const row = store.insertTurn.mock.calls[0][0];
      expect(row.tool_calls).toHaveLength(5);
      for (const log of row.tool_calls as { error: string }[]) expect(log.error).toBe("tool_not_allowed");
    });

    it("recovers if the model backs off after a blocked call", async () => {
      const store = fakeStore({ conversation: null, product: null });
      const { handlers, model, run } = setup([toolCalls(toolUse("create_draft_order", draftOrder)), reply("Nháp trả lời")], {
        store,
        deps: { staffShopId: SHOP_A },
      });
      const result = await run(staffInput());
      expect(result.output.reply.text).toBe("Nháp trả lời");
      expect(handlers.create_draft_order).not.toHaveBeenCalled();
      expect(model.calls).toHaveLength(2);
    });

    it("over the limit gives up without a handoff", async () => {
      const store = fakeStore({ conversation: null, product: null });
      const responses = Array.from({ length: 6 }, () => toolCalls(toolUse("get_policy", { kind: "doi_tra" })));
      const { run } = setup(responses, { store, deps: { staffShopId: SHOP_A } });
      const result = await run(staffInput());
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
      expect(result.output.reply.text).toBe(STAFF_DRAFT_GIVE_UP_TEXT);
      expect(result.handoffReason).toBe("too_many_tool_calls");
    });
  });

  it("truncated response is explicit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, handlers, model, run } = setup([
      {
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"text":"Dạ còn', citations: null }, toolUse("get_stock", { productId: PRODUCT })],
      },
    ]);
    const result = await run(customerInput());
    expect(result.output.reply).toEqual({ text: FALLBACK_TEXT, products: [], quickReplies: [] });
    for (const h of Object.values(handlers)) expect(h).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("max_tokens");
    expect(result.handoffReason).toBeNull();
    expect(store.setNeedsHuman).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(1);
  });

  it("sends the output budget", async () => {
    const { model, run } = setup([reply()]);
    await run(customerInput());
    const params = model.calls[0];
    expect(params.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBe(4096);
    expect(params.model).toBe("test-model");
    expect(params.output_config?.effort).toBe("medium");
    expect(params.output_config?.format?.schema).toEqual(MODEL_REPLY_JSON_SCHEMA);
  });

  it("a failing tool does not crash the reply", async () => {
    const { handlers, model, store, run } = setup([toolCalls(toolUse("get_stock", { productId: PRODUCT })), reply("Xin lỗi")]);
    handlers.get_stock.mockImplementation(async () => {
      throw new Error("db down");
    });
    const result = await run(customerInput());
    const [r] = toolResults(model.calls[1]);
    expect(r.is_error).toBe(true);
    expect(JSON.parse(r.content as string).error).toBe("internal_error");
    expect(result.output.reply.text).toBe("Xin lỗi");
    await result.turnLogged;
    expect((store.insertTurn.mock.calls[0][0].tool_calls as { error: string }[])[0].error).toContain("db down");
  });

  describe("tool call limit", () => {
    it("hands off after more than 5 tool calls", async () => {
      const responses = Array.from({ length: 6 }, () => toolCalls(toolUse("get_policy", { kind: "doi_tra" })));
      const { store, handlers, model, run } = setup(responses);
      const result = await run(customerInput());
      expect(handlers.get_policy).toHaveBeenCalledTimes(5);
      expect(result.handoffReason).toBe("too_many_tool_calls");
      expect(store.setNeedsHuman).toHaveBeenCalledTimes(1);
      expect(store.setNeedsHuman).toHaveBeenCalledWith({ shopId: SHOP_A, conversationId: CONV });
      expect(result.output.reply.text).toBe(HANDOFF_TEXT);
      expect(model.calls).toHaveLength(6);
      await result.turnLogged;
      const row = store.insertTurn.mock.calls[0][0];
      expect(row.handoff_reason).toBe("too_many_tool_calls");
      expect(row.tool_calls).toHaveLength(5);
    });

    it("counts parallel calls", async () => {
      const three = () => toolCalls(...Array.from({ length: 3 }, () => toolUse("get_policy", { kind: "doi_tra" })));
      const a = setup([three(), three()]);
      expect((await a.run(customerInput())).handoffReason).toBe("too_many_tool_calls");
      expect(a.handlers.get_policy).toHaveBeenCalledTimes(3);

      const b = setup([toolCalls(...Array.from({ length: 6 }, () => toolUse("get_policy", { kind: "doi_tra" })))]);
      expect((await b.run(customerInput())).handoffReason).toBe("too_many_tool_calls");
      expect(b.handlers.get_policy).toHaveBeenCalledTimes(0);
    });

    it("exactly 5 calls is allowed", async () => {
      const { handlers, run } = setup([
        toolCalls(...Array.from({ length: 5 }, () => toolUse("get_policy", { kind: "doi_tra" }))),
        reply("Xong"),
      ]);
      const result = await run(customerInput());
      expect(result.handoffReason).toBeNull();
      expect(handlers.get_policy).toHaveBeenCalledTimes(5);
      expect(result.output.reply.text).toBe("Xong");
    });
  });

  it("model handoff", async () => {
    const { handlers, model, store, run } = setup([toolCalls(toolUse("handoff_to_staff", { reason: "complaint" })), reply()]);
    const result = await run(customerInput());
    expect(handlers.handoff_to_staff).toHaveBeenCalledTimes(1);
    expect(model.calls).toHaveLength(1);
    expect(result.handoffReason).toBe("complaint");
    expect(result.output.reply).toEqual({ text: HANDOFF_TEXT, products: [], quickReplies: [] });
    // The handler already moved the conversation; runEngine doesn't do it again.
    expect(store.setNeedsHuman).not.toHaveBeenCalled();
  });

  describe("size handoff tells the shopper why", () => {
    const sizeInput = { productId: PRODUCT, heightCm: 190, weightKg: 100 };

    it("measurements outside the chart", async () => {
      const { handlers, run } = setup([
        toolCalls(toolUse("recommend_size", sizeInput)),
        toolCalls(toolUse("handoff_to_staff", { reason: "size_out_of_range" })),
      ]);
      handlers.recommend_size.mockResolvedValue({ status: "out_of_range" });
      const result = await run(customerInput());
      expect(result.handoffReason).toBe("size_out_of_range");
      expect(result.output.reply.text).toBe(SIZE_OUT_OF_RANGE_HANDOFF_TEXT);
      expect(result.output.reply.text).toContain("ngoài bảng size");
    });

    it("product has no size chart", async () => {
      const { run } = setup([
        toolCalls(toolUse("recommend_size", sizeInput)),
        toolCalls(toolUse("handoff_to_staff", { reason: "not_covered_by_data" })),
      ]);
      const result = await run(customerInput());
      expect(result.handoffReason).toBe("not_covered_by_data");
      expect(result.output.reply.text).toBe(NO_SIZE_CHART_HANDOFF_TEXT);
      expect(result.output.reply.text).toContain("chưa có bảng size");
    });

    it("other reasons keep the generic text", async () => {
      const { run } = setup([toolCalls(toolUse("handoff_to_staff", { reason: "complaint" }))]);
      expect((await run(customerInput())).output.reply.text).toBe(HANDOFF_TEXT);
    });
  });

  describe("PB-14 handoff triggers", () => {
    it("shopper asks for a person: model calls handoff_to_staff with asked_for_human", async () => {
      const { handlers, run } = setup([toolCalls(toolUse("handoff_to_staff", { reason: "asked_for_human" }))]);
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "cho mình gặp nhân viên" }] }));
      expect(handlers.handoff_to_staff).toHaveBeenCalledWith({ reason: "asked_for_human" }, expect.anything(), expect.anything());
      expect(result.handoffReason).toBe("asked_for_human");
      expect(result.output.reply.text).toBe(HANDOFF_TEXT);
    });

    it("question not covered by data (e.g. fabric stretch) -> hands off with generic text", async () => {
      const { run } = setup([toolCalls(toolUse("handoff_to_staff", { reason: "not_covered_by_data" }))]);
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "vải có co giãn không" }] }));
      expect(result.handoffReason).toBe("not_covered_by_data");
      expect(result.output.reply.text).toBe(HANDOFF_TEXT);
      expect(result.output.reply.text).not.toContain("bảng size");
    });

    it("question not covered by data (washing instructions) -> hands off with generic text", async () => {
      const { run } = setup([toolCalls(toolUse("handoff_to_staff", { reason: "not_covered_by_data" }))]);
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "áo này giặt máy được không?" }] }));
      expect(result.handoffReason).toBe("not_covered_by_data");
      expect(result.output.reply.text).toBe(HANDOFF_TEXT);
    });

    it("ununderstood twice: model calling handoff_to_staff with misunderstood_twice", async () => {
      const { run } = setup([toolCalls(toolUse("handoff_to_staff", { reason: "misunderstood_twice" }))]);
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "??? kkk" }] }));
      expect(result.handoffReason).toBe("misunderstood_twice");
      expect(result.output.reply.text).toBe(HANDOFF_TEXT);
    });

    it("postcheck failed twice sends product card from data before handoff (PB-07/PB-14)", async () => {
      const store = fakeStore({
        conversation: { shopId: SHOP_A, mode: "ai" },
        product: { id: PRODUCT, name: "Váy suông linen" },
      });
      const { handlers, run } = setup(
        [
          toolCalls(toolUse("get_policy", { kind: "khuyen_mai" })),
          reply("Dạ shop bớt 50k cho bạn nha"),
          reply("Vẫn bớt 50k nhé!"),
        ],
        { store },
      );
      handlers.get_policy.mockResolvedValue({ kind: "khuyen_mai", content: null });
      const result = await run(customerInput({ productId: PRODUCT, history: [{ sender: "shopper", text: "bớt 50k cho mình đi" }] }));
      expect(result.handoffReason).toBe("postcheck_failed");
      expect(result.output.reply.text).toBe(DISCOUNT_HANDOFF_TEXT);
      expect(result.output.reply.products).toEqual([card(PRODUCT)]);
      expect(store.setNeedsHuman).toHaveBeenCalledWith({ shopId: SHOP_A, conversationId: CONV });
    });
  });

  describe("recommend_size gets the measurements the shopper wrote (PB-06)", () => {
    const sizeAsk = (text: string) => customerInput({ history: [{ sender: "shopper", text }] });

    it.each([
      ["Mình cao 1m65 nặng 58kg mặc size nào?", 165, 58],
      ["165cm, 58 ký thì size gì shop", 165, 58],
      ["cao 165 nặng 58 cân", 165, 58],
    ])("%s", async (text, heightCm, weightKg) => {
      // The model converted wrongly (or passed text); the tool still gets the shopper's numbers.
      const { handlers, run } = setup([
        toolCalls(toolUse("recommend_size", { productId: PRODUCT, heightCm: "1m6", weightKg: 50 })),
        reply("Dạ size L ạ"),
      ]);
      handlers.recommend_size.mockResolvedValue({ status: "ok", size: "L", sizeByHeight: "L", sizeByWeight: "L" });
      await run(sizeAsk(text));
      expect(handlers.recommend_size).toHaveBeenCalledTimes(1);
      expect(handlers.recommend_size.mock.calls[0][0]).toEqual({ productId: PRODUCT, heightCm, weightKg });
    });

    it("parses the model's value when the shopper's message has no unit or keyword", async () => {
      const { handlers, run } = setup([
        toolCalls(toolUse("recommend_size", { productId: PRODUCT, heightCm: 1.6, weightKg: "50kg" })),
        reply("Dạ size M ạ"),
      ]);
      handlers.recommend_size.mockResolvedValue({ status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" });
      await run(sizeAsk("mình mặc size nào vừa shop?"));
      expect(handlers.recommend_size.mock.calls[0][0]).toEqual({ productId: PRODUCT, heightCm: 160, weightKg: 50 });
    });
  });

  describe("out of chart or no chart always hands off (PB-06 AC4)", () => {
    const sizeInput = { productId: PRODUCT, heightCm: 190, weightKg: 100 };

    it("out of range: the engine hands off even when the model only answered", async () => {
      const { handlers, model, store, run } = setup([
        toolCalls(toolUse("recommend_size", sizeInput)),
        reply("Dạ bạn mặc size XL nhé"),
      ]);
      handlers.recommend_size.mockResolvedValue({ status: "out_of_range" });
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "cao 1m90 nặng 100kg mặc size gì" }] }));
      expect(model.calls).toHaveLength(2);
      expect(result.handoffReason).toBe("size_out_of_range");
      expect(result.output.reply).toEqual({ text: SIZE_OUT_OF_RANGE_HANDOFF_TEXT, products: [], quickReplies: [] });
      expect(store.setNeedsHuman).toHaveBeenCalledWith({ shopId: SHOP_A, conversationId: CONV });
    });

    it("no chart: the engine hands off with not_covered_by_data", async () => {
      const { store, run } = setup([toolCalls(toolUse("recommend_size", sizeInput)), reply("Dạ bạn mặc size M nhé")]);
      const result = await run(customerInput());
      expect(result.handoffReason).toBe("not_covered_by_data");
      expect(result.output.reply.text).toBe(NO_SIZE_CHART_HANDOFF_TEXT);
      expect(store.setNeedsHuman).toHaveBeenCalledWith({ shopId: SHOP_A, conversationId: CONV });
    });

    it("the model's own handoff_to_staff moves the conversation; the engine doesn't do it twice", async () => {
      const { handlers, store, run } = setup([
        toolCalls(toolUse("recommend_size", sizeInput)),
        toolCalls(toolUse("handoff_to_staff", { reason: "size_out_of_range" })),
      ]);
      handlers.recommend_size.mockResolvedValue({ status: "out_of_range" });
      const result = await run(customerInput());
      expect(handlers.handoff_to_staff).toHaveBeenCalledTimes(1);
      expect(result.handoffReason).toBe("size_out_of_range");
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });

    it("an ok recommend_size after the out-of-range one (another product) does not hand off", async () => {
      const { handlers, run } = setup([
        toolCalls(toolUse("recommend_size", sizeInput)),
        toolCalls(toolUse("recommend_size", { ...sizeInput, heightCm: 160, weightKg: 50 })),
        reply("Dạ bạn mặc size M ạ"),
      ]);
      handlers.recommend_size
        .mockResolvedValueOnce({ status: "out_of_range" })
        .mockResolvedValueOnce({ status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" });
      const result = await run(customerInput());
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.text).toBe("Dạ bạn mặc size M ạ");
    });

    it("staff_draft never hands off; the draft says it can't advise", async () => {
      const { handlers, store, run } = setup(
        [toolCalls(toolUse("recommend_size", sizeInput)), reply("Chưa tư vấn được size: số đo ngoài bảng size.")],
        { deps: { staffShopId: SHOP_A } },
      );
      handlers.recommend_size.mockResolvedValue({ status: "out_of_range" });
      const result = await run(staffInput());
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.text).toBe("Chưa tư vấn được size: số đo ngoài bảng size.");
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });
  });

  describe("the reply's size is the recommend_size result (PB-06 AC5 post-check)", () => {
    const sizeCall = toolCalls(toolUse("recommend_size", { productId: PRODUCT, heightCm: 155, weightKg: 52 }));
    const ask = customerInput({ history: [{ sender: "shopper", text: "cao 1m55 nặng 52kg mặc size nào?" }] });
    const disagree = { status: "ok", size: "M", sizeByHeight: "S", sizeByWeight: "M" };

    const lastUserText = (params: Anthropic.MessageCreateParamsNonStreaming) => {
      const last = params.messages.at(-1)!;
      return typeof last.content === "string" ? last.content : "";
    };

    it("a reply that names the size (and the A1 reason) goes out as written", async () => {
      const text = "Dạ theo chiều cao bạn mặc size S, theo cân nặng size M, nên shop khuyên size M cho thoải mái ạ.";
      const { handlers, model, run } = setup([sizeCall, reply(text)]);
      handlers.recommend_size.mockResolvedValue(disagree);
      const result = await run(ask);
      expect(model.calls).toHaveLength(2);
      expect(result.output.reply.text).toBe(text);
    });

    it("the reply may name sizes another tool returned this turn (in stock)", async () => {
      const text = "Dạ bạn mặc size M ạ. Váy còn size M màu be, size L màu đen.";
      const { handlers, model, run } = setup([
        toolCalls(toolUse("recommend_size", { productId: PRODUCT, heightCm: 160, weightKg: 50 }), toolUse("get_stock", { productId: PRODUCT })),
        reply(text),
      ]);
      handlers.recommend_size.mockResolvedValue({ status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" });
      handlers.get_stock.mockResolvedValue({
        ...stockOut,
        variants: [
          { variantId: VARIANT, size: "M", color: "be", stock: 2 },
          { variantId: ORDER, size: "L", color: "đen", stock: 1 },
        ],
      });
      const result = await run(ask);
      expect(model.calls).toHaveLength(2);
      expect(result.output.reply.text).toBe(text);
    });

    it("a wrong size is regenerated once, with the tool's size spelled out", async () => {
      const { handlers, model, run } = setup([sizeCall, reply("Dạ bạn mặc size S nhé"), reply("Dạ bạn mặc size M ạ")]);
      handlers.recommend_size.mockResolvedValue(disagree);
      const result = await run(ask);
      expect(model.calls).toHaveLength(3);
      expect(lastUserText(model.calls[2])).toContain("size M");
      expect(result.output.reply.text).toBe("Dạ bạn mặc size M ạ");
      expect(result.handoffReason).toBeNull();
    });

    it("a reply that names no size at all is regenerated too", async () => {
      const { handlers, model, run } = setup([sizeCall, reply("Dạ bạn chọn màu nào ạ?"), reply("Dạ size M ạ, bạn chọn màu nào?")]);
      handlers.recommend_size.mockResolvedValue(disagree);
      const result = await run(ask);
      expect(model.calls).toHaveLength(3);
      expect(result.output.reply.text).toBe("Dạ size M ạ, bạn chọn màu nào?");
    });

    it("wrong twice: the reply is written from the tool result, with the product card", async () => {
      const { handlers, model, store, run } = setup([sizeCall, reply("Dạ size L ạ"), reply("Dạ size XL ạ")]);
      handlers.recommend_size.mockResolvedValue(disagree);
      const result = await run(ask);
      expect(model.calls).toHaveLength(3);
      expect(result.output.reply.text).toContain("size M");
      expect(result.output.reply.text).toContain("size S");
      expect(result.output.reply.text).not.toMatch(/size (L|XL)\b/);
      expect(result.output.reply.products).toEqual([card(PRODUCT)]);
      expect(store.productCards).toHaveBeenCalledWith(SHOP_A, [PRODUCT]);
      expect(result.handoffReason).toBeNull();
    });
  });

  describe("product name that matches nothing (PB-05)", () => {
    const UNKNOWN = "Shop có áo khoác da không?";
    const followUp = (answer: string): EngineInput => customerInput({
      history: [
        { sender: "shopper", text: UNKNOWN },
        { sender: "ai", text: "Dạ shop chưa tìm thấy áo khoác da. Bạn mô tả rõ hơn giúp mình nhé?" },
        { sender: "shopper", text: answer },
      ],
    });
    const missedBefore = (previousTurnMissedProduct: boolean) =>
      fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: null, previousTurnMissedProduct });
    const emptySearch = (query: string) => toolCalls(toolUse("search_products", { query }));
    const clarify = reply("Dạ shop chưa có áo khoác da. Bạn tìm áo khoác loại nào ạ?");

    it("first miss: the model's clarifying question goes out, no handoff", async () => {
      const { store, run } = setup([emptySearch("áo khoác da"), clarify], { store: missedBefore(false) });
      const result = await run(customerInput({ history: [{ sender: "shopper", text: UNKNOWN }] }));
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.text).toContain("Bạn tìm áo khoác loại nào");
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });

    it("second miss in a row: the engine hands off to staff, whatever the model wrote", async () => {
      const { store, run } = setup([emptySearch("áo khoác da bò"), clarify], { store: missedBefore(true) });
      const result = await run(followUp("áo khoác da bò màu nâu ấy"));
      expect(result.handoffReason).toBe("misunderstood_twice");
      expect(result.output.reply).toEqual({ text: PRODUCT_NOT_FOUND_HANDOFF_TEXT, products: [], quickReplies: [] });
      expect(store.setNeedsHuman).toHaveBeenCalledWith({ shopId: SHOP_A, conversationId: CONV });
      await result.turnLogged;
      expect(store.insertTurn.mock.calls[0][0].handoff_reason).toBe("misunderstood_twice");
    });

    it("second miss hands off misunderstood_twice although the model also searched a broader query", async () => {
      // Valid 12-char hex tails ("01".."05"), so get_stock really runs ok on one.
      const jackets = [1, 2, 3, 4, 5].map((n) => `a0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`);
      const { handlers, store, run } = setup(
        [
          toolCalls(
            toolUse("search_products", { query: "áo khoác" }),
            toolUse("search_products", { query: "áo khoác da" }),
            toolUse("get_stock", { productId: jackets[0] }),
          ),
          clarify,
        ],
        { store: missedBefore(true) },
      );
      handlers.search_products.mockImplementation(async (...args: unknown[]) => {
        const query = (args[0] as { query?: string }).query;
        return query === "áo khoác"
          ? { products: jackets.map((productId) => ({ productId, name: "Áo khoác", category: "áo khoác", price: 350000, imageUrl: null, colors: [], sizes: [] })) }
          : { products: [] };
      });
      const result = await run(followUp("loại áo khoác da màu đen ấy"));
      expect(result.handoffReason).toBe("misunderstood_twice");
      expect(result.output.reply).toEqual({ text: PRODUCT_NOT_FOUND_HANDOFF_TEXT, products: [], quickReplies: [] });
      expect(store.setNeedsHuman).toHaveBeenCalledWith({ shopId: SHOP_A, conversationId: CONV });
      await result.turnLogged;
      const row = store.insertTurn.mock.calls[0][0];
      expect(row.handoff_reason).toBe("misunderstood_twice");
      expect(row.postcheck).toEqual({ productMiss: true });
    });

    it("the answer finds a product: no handoff", async () => {
      const { handlers, store, run } = setup([emptySearch("váy suông"), reply("Dạ váy suông linen còn ạ")], { store: missedBefore(true) });
      handlers.search_products.mockResolvedValue({
        products: [{ productId: PRODUCT, name: "Váy suông linen", category: "váy", price: 350000, imageUrl: null, colors: ["be"], sizes: ["M"] }],
      });
      const result = await run(followUp("à váy suông linen"));
      expect(result.handoffReason).toBeNull();
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });

    it("the answer is about the product being viewed (get_stock works): no handoff", async () => {
      const { store, run } = setup(
        [toolCalls(toolUse("search_products", { query: "da" }), toolUse("get_stock", { productId: PRODUCT })), reply("Dạ còn ạ")],
        {
          // The product is on screen, so the turn's product tool ran on a found id.
          store: fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy suông linen" }, previousTurnMissedProduct: true }),
        },
      );
      const result = await run(followUp("cái mình đang xem đó"));
      expect(result.handoffReason).toBeNull();
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
      await result.turnLogged;
      expect(store.insertTurn.mock.calls[0][0].postcheck).toEqual({ productMiss: false });
    });

    it("no search this turn, a failed search, or a fresh question: no handoff", async () => {
      const noSearch = setup([reply("Dạ bạn cần gì ạ?")], { store: missedBefore(true) });
      expect((await noSearch.run(followUp("thôi để mình xem"))).handoffReason).toBeNull();

      const failing = setup([emptySearch("áo khoác"), reply("Dạ")], { store: missedBefore(true) });
      failing.handlers.search_products.mockRejectedValue(new Error("db down"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await failing.run(followUp("áo khoác"))).handoffReason).toBeNull();

      // Not an answer to the AI (first message, or staff replied in between).
      const fresh = setup([emptySearch("áo khoác"), clarify], { store: missedBefore(true) });
      expect((await fresh.run(customerInput({ history: [{ sender: "shopper", text: UNKNOWN }] }))).handoffReason).toBeNull();
      const afterStaff = setup([emptySearch("áo khoác"), clarify], { store: missedBefore(true) });
      const history = [
        { sender: "shopper" as const, text: UNKNOWN },
        { sender: "staff" as const, text: "Shop sẽ nhập áo khoác tuần sau" },
        { sender: "shopper" as const, text: "áo khoác da" },
      ];
      expect((await afterStaff.run(customerInput({ history }))).handoffReason).toBeNull();
    });

    it("never in staff_draft mode", async () => {
      const store = fakeStore({ conversation: null, product: null, previousTurnMissedProduct: true });
      const { run } = setup([emptySearch("áo khoác da"), clarify], { store, deps: { staffShopId: SHOP_A } });
      const result = await run({
        mode: "staff_draft",
        history: [
          { sender: "shopper", text: UNKNOWN },
          { sender: "ai", text: "?" },
          { sender: "shopper", text: "áo khoác da" },
        ],
      });
      expect(result.handoffReason).toBeNull();
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });
  });

  describe("stock answer (PB-05)", () => {
    const L_BE = "a0000000-0000-4000-8000-000000000022";
    const M_DEN = "a0000000-0000-4000-8000-000000000023";
    const variant = (variantId: string, size: string, color: string, stock: number) => ({ variantId, size, color, stock });
    const soldOut = { ...stockOut, variants: [variant(L_BE, "L", "be", 0)] };
    const whole = { ...stockOut, variants: [variant(VARIANT, "M", "be", 2), variant(L_BE, "L", "be", 0), variant(M_DEN, "M", "đen", 5)] };

    it("sold out: the stock and price the model answers from are the tool's, and so are the alternatives and the card", async () => {
      const { handlers, model, store, run } = setup([
        toolCalls(toolUse("get_stock", { productId: PRODUCT, size: "L", color: "be" })),
        toolCalls(toolUse("get_stock", { productId: PRODUCT })),
        reply("Dạ màu be size L hết hàng rồi ạ. Váy còn M be và M đen, giá 350.000đ.", [PRODUCT]),
      ]);
      handlers.get_stock.mockResolvedValueOnce(soldOut).mockResolvedValueOnce(whole);
      const result = await run(customerInput({ productId: PRODUCT, history: [{ sender: "shopper", text: "váy này màu be size L còn không?" }] }));

      // The shop id comes from the conversation, never from the model.
      expect(handlers.get_stock.mock.calls.map((c) => [c[0], (c[1] as { shopId: string }).shopId])).toEqual([
        [{ productId: PRODUCT, size: "L", color: "be" }, SHOP_A],
        [{ productId: PRODUCT }, SHOP_A],
      ]);
      expect(JSON.parse(toolResults(model.calls[1])[0].content as string)).toEqual(soldOut);
      expect(JSON.parse(toolResults(model.calls[2])[0].content as string)).toEqual(whole);
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.products).toEqual([card(PRODUCT)]);
      expect(store.productCards).toHaveBeenCalledWith(SHOP_A, [PRODUCT]);

      // Both outputs are logged with the turn: what a reply's numbers are checked against (PB-07).
      await result.turnLogged;
      expect(store.insertTurn.mock.calls[0][0].tool_calls).toEqual([
        { name: "get_stock", input: { productId: PRODUCT, size: "L", color: "be" }, output: soldOut },
        { name: "get_stock", input: { productId: PRODUCT }, output: whole },
      ]);
    });

    it("a product id from another shop is a tool error, not a stock number", async () => {
      const { handlers, model, run } = setup([
        toolCalls(toolUse("get_stock", { productId: PRODUCT })),
        reply("Dạ mình chưa kiểm tra được ạ"),
      ]);
      handlers.get_stock.mockRejectedValue(new ToolError("product_not_found"));
      const result = await run(customerInput());
      const [res] = toolResults(model.calls[1]);
      expect(res.is_error).toBe(true);
      expect(JSON.parse(res.content as string)).toMatchObject({ error: "product_not_found" });
      expect(result.handoffReason).toBeNull();
    });
  });

  describe("turn log", () => {
    it("logs the turn", async () => {
      const { store, run } = setup([
        { ...toolCalls(toolUse("get_policy", { kind: "doi_tra" })), usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage, _ms: 150 },
        { ...reply(), usage: { input_tokens: 20, output_tokens: 7 } as Anthropic.Usage, _ms: 100 },
      ]);
      const result = await run(customerInput());
      expect(await result.turnLogged).toBe("turn-1");
      const row = store.insertTurn.mock.calls[0][0];
      expect(row).toMatchObject({
        shop_id: SHOP_A,
        conversation_id: CONV,
        mode: "customer",
        input_tokens: 30,
        output_tokens: 12,
        latency_ms: 250,
        handoff_reason: null,
      });
      expect(() => toolCallLogSchema.array().parse(row.tool_calls)).not.toThrow();
    });

    it("turn log failure does not crash", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const store = fakeStore();
      store.insertTurn.mockRejectedValue(new Error("insert failed"));
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const { run } = setup([reply("Chào")], { store });
        const result = await run(customerInput());
        expect(result.output.reply.text).toBe("Chào");
        expect(await result.turnLogged).toBeNull();
        expect(error).toHaveBeenCalled();
        await new Promise((r) => setTimeout(r, 10));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });

    it("returns the output before the turn is written", async () => {
      const store = fakeStore();
      let release!: (id: string) => void;
      store.insertTurn.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));
      const { run } = setup([reply("Chào")], { store });
      const result = await run(customerInput());
      expect(result.output.reply.text).toBe("Chào");
      expect(store.insertTurn).toHaveBeenCalledTimes(1);
      let done = false;
      void result.turnLogged.then(() => (done = true));
      await Promise.resolve();
      expect(done).toBe(false);
      release("turn-9");
      expect(await result.turnLogged).toBe("turn-9");
    });

    it("latency excludes the log write", async () => {
      const store = fakeStore();
      store.insertTurn.mockImplementation(async () => {
        clock.t += 500;
        return "turn-1";
      });
      const { onMetrics, run } = setup([{ ...reply(), _ms: 250 }], { store });
      const result = await run(customerInput());
      await result.turnLogged;
      expect(store.insertTurn.mock.calls[0][0].latency_ms).toBe(250);
      expect(onMetrics.mock.calls[0][0].latencyMs).toBe(250);
    });
  });

  describe("trace detail", () => {
    it("gives the sink the system prompt, and no customer text unless capture is on", async () => {
      const { onMetrics, run } = setup([reply("Dạ size M ạ")]);
      await run(customerInput());
      const detail = onMetrics.mock.calls[0][1]!;
      expect(detail.system).toContain(`Prompt ${PROMPT_VERSION}`);
      expect(detail.calls).toEqual([]);
    });

    it("with capture on, gives the messages and the reply of every model call", async () => {
      const { onMetrics, run } = setup([reply("Dạ size M ạ")], { deps: { captureContent: true } });
      await run(customerInput());
      const detail = onMetrics.mock.calls[0][1]!;
      expect(detail.calls).toHaveLength(1);
      expect(JSON.stringify(detail.calls[0].messages)).toContain("user");
      expect(JSON.stringify(detail.calls[0].output)).toContain("Dạ size M ạ");
    });
  });

  it("reads context in one store call", async () => {
    const store = fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy" } });
    const order: string[] = [];
    store.productCards.mockImplementation(async (_s, ids) => {
      order.push("productCards");
      return ids.map(card);
    });
    const { model, run } = setup([toolCalls(toolUse("get_policy", { kind: "doi_tra" })), reply("x", [PRODUCT])], { store });
    const create = model.create.bind(model);
    model.create = async (...args) => {
      order.push("model");
      return create(...args);
    };
    await run(customerInput({ productId: PRODUCT }));
    expect(store.loadTurnContext).toHaveBeenCalledTimes(1);
    expect(store.loadTurnContext).toHaveBeenCalledWith({ conversationId: CONV, shopId: null, productId: PRODUCT });
    expect(Object.keys(store).sort()).toEqual(["insertTurn", "loadTurnContext", "productCards", "setAiMode", "setNeedsHuman"]);
    expect(order).toEqual(["model", "model", "productCards"]);
  });

  it("system and tools are computed once", async () => {
    const store = fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy" } });
    const { model, run } = setup(
      [toolCalls(toolUse("get_policy", { kind: "doi_tra" })), toolCalls(toolUse("get_policy", { kind: "giao_hang" })), reply()],
      { store },
    );
    await run(customerInput({ productId: PRODUCT }));
    expect(model.calls).toHaveLength(3);
    for (const call of model.calls) {
      expect(call.system).toEqual(model.calls[0].system);
      expect(call.tools).toEqual(model.calls[0].tools);
    }
    const system = model.calls[0].system as Anthropic.TextBlockParam[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system).toHaveLength(2);
    expect(system[1].text).toContain(PRODUCT);
  });

  describe("concurrency", () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    function tracker() {
      let active = 0;
      let max = 0;
      const track = async <T>(ms: number, value: T) => {
        active++;
        max = Math.max(max, active);
        await delay(ms);
        active--;
        return value;
      };
      return { track, max: () => max };
    }

    it("tool results keep tool_use order under concurrency", async () => {
      const uses = [
        toolUse("get_policy", { kind: "doi_tra" }),
        toolUse("get_stock", { productId: PRODUCT }),
        toolUse("get_pairings", { productId: PRODUCT }),
      ];
      const { handlers, model, store, onMetrics, run } = setup([toolCalls(...uses), reply()], { deps: { toolConcurrency: 3 } });
      const t = tracker();
      handlers.get_policy.mockImplementation(() => t.track(40, { kind: "doi_tra", content: "x" }));
      handlers.get_stock.mockImplementation(() => t.track(5, stockOut));
      handlers.get_pairings.mockImplementation(() => t.track(1, { pairings: [] }));
      const result = await run(customerInput());
      expect(t.max()).toBe(3);
      expect(toolResults(model.calls[1]).map((r) => r.tool_use_id)).toEqual(uses.map((u) => u.id));
      await result.turnLogged;
      expect((store.insertTurn.mock.calls[0][0].tool_calls as { name: string }[]).map((l) => l.name)).toEqual([
        "get_policy",
        "get_stock",
        "get_pairings",
      ]);
      expect(onMetrics.mock.calls[0][0].toolCalls.map((c) => c.name)).toEqual(["get_policy", "get_stock", "get_pairings"]);
    });

    it("default is sequential", async () => {
      const { handlers, run } = setup([
        toolCalls(
          toolUse("get_policy", { kind: "doi_tra" }),
          toolUse("get_stock", { productId: PRODUCT }),
          toolUse("get_pairings", { productId: PRODUCT }),
        ),
        reply(),
      ]);
      const t = tracker();
      handlers.get_policy.mockImplementation(() => t.track(5, { kind: "doi_tra", content: "x" }));
      handlers.get_stock.mockImplementation(() => t.track(5, stockOut));
      handlers.get_pairings.mockImplementation(() => t.track(5, { pairings: [] }));
      await run(customerInput());
      expect(t.max()).toBe(1);
    });

    it("write tools never run concurrently", async () => {
      const { handlers, run } = setup(
        [toolCalls(toolUse("quote_order", { items: draftOrder.items }), toolUse("create_draft_order", draftOrder)), reply()],
        { store: orderStore(), deps: { toolConcurrency: 3 } },
      );
      const t = tracker();
      handlers.quote_order.mockImplementation(() => t.track(5, orderQuote));
      handlers.create_draft_order.mockImplementation(() => t.track(5, { status: "created", orderId: ORDER, total: 1 }));
      await run(customerInput({ history: orderHistory }));
      expect(handlers.create_draft_order).toHaveBeenCalledTimes(1);
      expect(t.max()).toBe(1);
    });

    it("runBatch", async () => {
      const t = tracker();
      const delays = [30, 5, 20, 1, 10];
      expect(await runBatch(delays, 2, (ms, i) => t.track(ms, i))).toEqual([0, 1, 2, 3, 4]);
      expect(t.max()).toBe(2);

      const s = tracker();
      expect(await runBatch(delays, 1, (ms, i) => s.track(ms, i * 2))).toEqual([0, 2, 4, 6, 8]);
      expect(s.max()).toBe(1);

      expect(await runBatch([], 3, async () => 1)).toEqual([]);
    });
  });

  describe("metrics", () => {
    it("emits turn metrics", async () => {
      const usage = (i: number, o: number, read: number, created: number) =>
        ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: read, cache_creation_input_tokens: created }) as Anthropic.Usage;
      const { store, onMetrics, run } = setup([
        { ...toolCalls(toolUse("get_policy", { kind: "doi_tra" })), usage: usage(10, 5, 100, 0), _ms: 150, _ttftMs: 40 },
        { ...reply(), usage: usage(20, 7, 50, 30), _ms: 100, _ttftMs: 30 },
      ]);
      const result = await run(customerInput());
      expect(onMetrics).toHaveBeenCalledTimes(1);
      const m = onMetrics.mock.calls[0][0];
      expect(m).toMatchObject({
        event: "engine_turn",
        promptVersion: PROMPT_VERSION,
        model: "test-model",
        mode: "customer",
        shopId: SHOP_A,
        latencyMs: 250,
        ttftMs: 180,
        inputTokens: 30,
        outputTokens: 12,
        handoffReason: null,
        truncated: false,
        duplicateToolCalls: 0,
      });
      expect(m.modelCalls).toEqual([
        { startMs: 0, ms: 150, ttftMs: 40, inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheCreationTokens: 0, stopReason: "tool_use" },
        { startMs: 150, ms: 100, ttftMs: 30, inputTokens: 20, outputTokens: 7, cacheReadTokens: 50, cacheCreationTokens: 30, stopReason: "end_turn" },
      ]);
      expect(m.toolCalls).toEqual([{ name: "get_policy", startMs: 150, ms: 0, outcome: "ok" }]);
      await result.turnLogged;
      expect(store.insertTurn.mock.calls[0][0]).toMatchObject({
        ttft_ms: 180,
        model_calls: 2,
        model: "test-model",
        prompt_version: PROMPT_VERSION,
        input_tokens: m.inputTokens,
        output_tokens: m.outputTokens,
      });
    });

    it("ttft is null when the reply is not written by the model", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const scripts: ScriptedResponse[][] = [
        Array.from({ length: 6 }, () => ({ ...toolCalls(toolUse("get_policy", { kind: "doi_tra" })), _ttftMs: 5, _ms: 10 })),
        [toolCalls(toolUse("handoff_to_staff", { reason: "complaint" }))],
        [{ stop_reason: "max_tokens", content: [{ type: "text", text: "{", citations: null }], _ttftMs: 5, _ms: 10 }],
      ];
      for (const responses of scripts) {
        const { store, onMetrics, run } = setup(responses);
        const result = await run(customerInput());
        expect(onMetrics.mock.calls[0][0].ttftMs).toBeNull();
        await result.turnLogged;
        expect(store.insertTurn.mock.calls[0][0].ttft_ms).toBeNull();
      }
    });

    it("tool outcomes are classified", async () => {
      const unknownId = "c0000000-0000-4000-8000-000000000099";
      const customer = setup([
        toolCalls(
          toolUse("get_stock", { productId: PRODUCT }),
          toolUse("get_stock", { productId: unknownId }),
          toolUse("search_products", { query: "váy", shop_id: SHOP_B }),
          toolUse("drop_table", {}),
          toolUse("get_pairings", { productId: PRODUCT }),
        ),
        reply(),
      ]);
      customer.handlers.get_stock.mockImplementation(async (...args: unknown[]) => {
        if ((args[0] as { productId: string }).productId === unknownId) throw new ToolError("product_not_found");
        return stockOut;
      });
      customer.handlers.get_pairings.mockImplementation(async () => {
        throw new Error("boom");
      });
      const result = await customer.run(customerInput());
      const m = customer.onMetrics.mock.calls[0][0];
      expect(m.toolCalls.map((c) => c.outcome)).toEqual(["ok", "product_not_found", "invalid_input", "unknown_tool", "internal_error"]);
      await result.turnLogged;
      // unknown_tool has no log entry.
      expect(customer.store.insertTurn.mock.calls[0][0].tool_calls).toHaveLength(4);

      const staff = setup([toolCalls(toolUse("create_draft_order", draftOrder)), reply()], {
        store: fakeStore({ conversation: null, product: null }),
        deps: { staffShopId: SHOP_A },
      });
      await staff.run(staffInput());
      expect(staff.onMetrics.mock.calls[0][0].toolCalls.map((c) => c.outcome)).toEqual(["tool_not_allowed"]);
    });

    it("duplicate tool calls are counted", async () => {
      const a = setup([
        toolCalls(toolUse("get_stock", { productId: PRODUCT, size: "M" }), toolUse("get_stock", { size: "M", productId: PRODUCT })),
        reply(),
      ]);
      await a.run(customerInput());
      expect(a.onMetrics.mock.calls[0][0].duplicateToolCalls).toBe(1);

      const b = setup([
        toolCalls(toolUse("get_policy", { kind: "doi_tra" }), toolUse("get_policy", { kind: "giao_hang" })),
        reply(),
      ]);
      await b.run(customerInput());
      expect(b.onMetrics.mock.calls[0][0].duplicateToolCalls).toBe(0);
    });

    it("metrics line carries no content", async () => {
      const { onMetrics, run } = setup([toolCalls(toolUse("create_draft_order", draftOrder)), reply("Đã tạo đơn cho Thảo")]);
      await run(customerInput());
      const line = JSON.stringify(onMetrics.mock.calls[0][0]);
      for (const secret of [SECRET_TEXT, "Thảo", "0912345678", "Q1", VARIANT, ORDER, "Đã tạo đơn"]) {
        expect(line).not.toContain(secret);
      }
    });

    it("metrics sink failure does not crash", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { store, run } = setup([reply("Chào")], {
        deps: {
          onMetrics: () => {
            throw new Error("sink down");
          },
        },
      });
      const result = await run(customerInput());
      expect(result.output.reply.text).toBe("Chào");
      expect(error).toHaveBeenCalled();
      expect(await result.turnLogged).toBe("turn-1");
      expect(store.insertTurn).toHaveBeenCalledTimes(1);
    });
  });

  describe("conversation gate", () => {
    it("unknown conversation", async () => {
      const { store, model, run } = setup([reply()], { store: fakeStore({ conversation: null, product: null }) });
      await expect(run(customerInput())).rejects.toMatchObject({ code: "conversation_not_found" });
      expect(model.calls).toHaveLength(0);
      expect(store.insertTurn).not.toHaveBeenCalled();
    });

    it("conversation in staff mode rejects with conversation_not_found", async () => {
      const { store, model, run } = setup([reply()], {
        store: fakeStore({ conversation: { shopId: SHOP_A, mode: "staff" }, product: null }),
      });
      await expect(run(customerInput())).rejects.toMatchObject({ code: "conversation_not_found" });
      expect(model.calls).toHaveLength(0);
      expect(store.insertTurn).not.toHaveBeenCalled();
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });

    it("conversation in needs_human mode auto-resumes and calls setAiMode on successful answer", async () => {
      const { store, model, run } = setup([reply("Dạ shop còn hàng nhé")], {
        store: fakeStore({ conversation: { shopId: SHOP_A, mode: "needs_human" }, product: null }),
      });
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "áo còn không shop?" }] }));
      expect(result.output.reply.text).toBe("Dạ shop còn hàng nhé");
      expect(model.calls).toHaveLength(1);
      expect(store.setAiMode).toHaveBeenCalledWith({ shopId: SHOP_A, conversationId: CONV });
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });

    it("foreign productId is ignored", async () => {
      const foreign = "b0000000-0000-4000-8000-000000000011";
      const { model, run } = setup([reply()]);
      await run(customerInput({ productId: foreign }));
      const system = model.calls[0].system as Anthropic.TextBlockParam[];
      expect(system).toHaveLength(1);
      expect(JSON.stringify(system)).not.toContain(foreign);
    });
  });
});

// Keep the ToolName import honest: every tool the fake handlers cover is a contract tool.
const _covered: Record<ToolName, unknown> = fakeHandlers();
void _covered;
