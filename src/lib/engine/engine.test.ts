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
  SIZE_OUT_OF_RANGE_HANDOFF_TEXT,
  runBatch,
  runEngine,
  STAFF_DRAFT_GIVE_UP_TEXT,
  type EngineDeps,
  type EngineResult,
} from "./engine";
import { FALLBACK_TEXT, MODEL_REPLY_JSON_SCHEMA } from "./model-reply";
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
    insertTurn: vi.fn<EngineStore["insertTurn"]>(async () => "turn-1"),
  };
}

const stockOut = { productId: PRODUCT, name: "Váy suông linen", price: 350000, variants: [] };
const quoteOut = { lines: [], total: 0 };

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
  describe("PB-05, PB-06 and PB-09 verified answers", () => {
    it("uses current stock and price even when the model invents another number", async () => {
      const store = fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy suông linen" } });
      const { handlers, run } = setup([reply("Còn 99 chiếc, giá 1đ")], { store });
      handlers.get_stock.mockResolvedValue({ ...stockOut, variants: [
        { variantId: VARIANT, size: "M", color: "be", stock: 2 },
        { variantId: "a0000000-0000-4000-8000-000000000022", size: "L", color: "be", stock: 0 },
      ] });
      const result = await run(customerInput({ productId: PRODUCT, history: [{ sender: "shopper", text: "Váy be size L còn không, giá bao nhiêu?" }] }));
      expect(result.output.reply.text).toContain("size L đã hết hàng");
      expect(result.output.reply.text).toContain("size M (2 chiếc)");
      expect(result.output.reply.text).toContain("350.000đ");
      expect(result.output.reply.text).not.toContain("99 chiếc");
      expect(handlers.get_stock).toHaveBeenCalledWith({ productId: PRODUCT }, expect.anything(), expect.anything());
    });

    it("asks once about an unknown product and then hands off", async () => {
      const { run, store } = setup([
        toolCalls(toolUse("search_products", { query: "váy lạ" })), reply("Có hàng"),
        toolCalls(toolUse("search_products", { query: "váy khác" })), reply("Có hàng"),
      ]);
      const first = await run(customerInput({ history: [{ sender: "shopper", text: "Váy lạ giá bao nhiêu?" }] }));
      expect(first.output.reply.text).toContain("tên hoặc mã sản phẩm");
      const second = await run(customerInput({ history: [
        { sender: "shopper", text: "Váy lạ giá bao nhiêu?" },
        { sender: "ai", text: first.output.reply.text },
        { sender: "shopper", text: "Váy khác" },
      ] }));
      expect(second.handoffReason).toBe("product_not_found");
      expect(store.setNeedsHuman).toHaveBeenCalledTimes(1);
    });

    it("gets size from the chart and explains the larger size", async () => {
      const store = fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy suông linen" } });
      const { run, handlers } = setup([reply("Bạn mặc size S")], { store });
      handlers.recommend_size.mockResolvedValue({ status: "ok", size: "XL", sizeByHeight: "L", sizeByWeight: "XL" });
      const result = await run(customerInput({ productId: PRODUCT, history: [{ sender: "shopper", text: "Cao 1m65, nặng 58 cân thì chọn size nào?" }] }));
      expect(handlers.recommend_size).toHaveBeenCalledWith({ productId: PRODUCT, heightCm: 165, weightKg: 58 }, expect.anything(), expect.anything());
      expect(result.output.reply.text).toContain("size XL (size lớn hơn)");
      expect(result.output.reply.text).not.toContain("size S");
    });

    it("asks for missing measurements before choosing a size", async () => {
      const { run, handlers } = setup([reply("Size M")]);
      const result = await run(customerInput({ history: [{ sender: "shopper", text: "Mình cao 165cm, tư vấn size?" }] }));
      expect(result.output.reply.text).toContain("cân nặng");
      expect(handlers.recommend_size).not.toHaveBeenCalled();
    });

    it.each([
      ["out_of_range", "size_out_of_range", SIZE_OUT_OF_RANGE_HANDOFF_TEXT],
      ["no_chart", "not_covered_by_data", NO_SIZE_CHART_HANDOFF_TEXT],
    ] as const)("hands off a size result of %s", async (status, reason, expectedText) => {
      const store = fakeStore({ conversation: { shopId: SHOP_A, mode: "ai" }, product: { id: PRODUCT, name: "Váy suông linen" } });
      const { run, handlers } = setup([reply("Size M")], { store });
      handlers.recommend_size.mockResolvedValue({ status });
      const result = await run(customerInput({ productId: PRODUCT, history: [{ sender: "shopper", text: "Cao 1m90, 100kg nên chọn size nào?" }] }));
      expect(result.handoffReason).toBe(reason);
      expect(result.output.reply.text).toBe(expectedText);
      expect(store.setNeedsHuman).toHaveBeenCalledTimes(1);
    });

    it("quotes exactly the declared policy and hands off when it is absent", async () => {
      const a = setup([reply("Đổi trong 30 ngày")]);
      const answer = await a.run(customerInput({ history: [{ sender: "shopper", text: "Shop đổi trả trong bao lâu?" }] }));
      expect(answer.output.reply.text).toBe("Đổi trong 7 ngày");

      const b = setup([reply("Ship miễn phí")]);
      b.handlers.get_policy.mockResolvedValue({ kind: "giao_hang", content: null });
      const missing = await b.run(customerInput({ history: [{ sender: "shopper", text: "Shop ship miễn phí không?" }] }));
      expect(missing.handoffReason).toBe("policy_not_covered");
      expect(b.store.setNeedsHuman).toHaveBeenCalledTimes(1);
      expect(missing.output.reply.text).not.toContain("miễn phí");
    });
  });

  it("answers without tools", async () => {
    const { store, run } = setup([reply("Chào bạn", [PRODUCT])]);
    const result = await run(customerInput());
    expect(result.output.reply).toEqual({ text: "Chào bạn", products: [card(PRODUCT)], quickReplies: [] });
    expect(store.productCards).toHaveBeenCalledWith(SHOP_A, [PRODUCT]);
    expect(result.handoffReason).toBeNull();
    expect(result.output.personalReplyNeeded).toBe(false);
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
    expect(Object.keys(store).sort()).toEqual(["insertTurn", "loadTurnContext", "productCards", "setNeedsHuman"]);
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
        { deps: { toolConcurrency: 3 } },
      );
      const t = tracker();
      handlers.quote_order.mockImplementation(() => t.track(5, quoteOut));
      handlers.create_draft_order.mockImplementation(() => t.track(5, { status: "created", orderId: ORDER, total: 1 }));
      await run(customerInput());
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

    it("conversation not in mode ai", async () => {
      for (const mode of ["needs_human", "staff"] as const) {
        const { store, model, run } = setup([reply()], {
          store: fakeStore({ conversation: { shopId: SHOP_A, mode }, product: null }),
        });
        await expect(run(customerInput())).rejects.toMatchObject({ code: "conversation_not_found" });
        expect(model.calls).toHaveLength(0);
        expect(store.insertTurn).not.toHaveBeenCalled();
        expect(store.setNeedsHuman).not.toHaveBeenCalled();
      }
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
