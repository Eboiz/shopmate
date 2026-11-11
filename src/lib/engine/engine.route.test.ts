// PB-10: runEngine with Jev routing (a fake Jev client; no network).
import { describe, expect, it, vi } from "vitest";
import type { EngineInput } from "@/contract";
import { DISCOUNT_HANDOFF_TEXT } from "./discount-guard";
import { HANDOFF_TEXT, PRODUCT_NOT_FOUND_HANDOFF_TEXT, runEngine, type EngineDeps } from "./engine";
import { FALLBACK_TEXT } from "./model-reply";
import type { JevClient, JevResponse } from "./jev";
import { NUMBER_HANDOFF_TEXT, NUMBER_RETRY_NOTE } from "./number-check";
import { VIETNAMESE_RETRY_NOTE } from "./vietnamese-guard";
import type { TurnMetrics } from "./metrics";
import { PROMPT_VERSION } from "./prompt";
import type { EngineStore, TurnContext } from "./store";
import { finalJson, scriptedModel, toolCalls, toolUse } from "./test/fake-model";
import type { Db, ToolHandlers } from "./types";

const SHOP = "a0000000-0000-4000-8000-000000000001";
const CONV = "a0000000-0000-4000-8000-000000000031";
const VAY = "a0000000-0000-4000-8000-000000000011";
const OTHER = "a0000000-0000-4000-8000-000000000012";
const VARIANT = "a0000000-0000-4000-8000-000000000021";

const input = (text: string, extra: Partial<EngineInput> = {}): EngineInput =>
  ({ mode: "customer", conversationId: CONV, productId: VAY, history: [{ sender: "shopper", text }], ...extra }) as EngineInput;

function jevSaying(answers: Partial<Record<string, unknown>>): JevClient & { decide: ReturnType<typeof vi.fn> } {
  const response: JevResponse = {
    model: "typesafe/jev-1.13",
    answers: {
      intent: { type: "choice", choice: "stock", confidence: 0.95 },
      product: { type: "choice", choice: "viewing" },
      policy_kind: { type: "choice", choice: "doi_tra" },
      discount_trick: { type: "noul", noul: 0.01 },
      asked_to_clarify: { type: "noul", noul: 0.01 },
      ...(answers as JevResponse["answers"]),
    },
  };
  return { model: "typesafe/jev-1.13", decide: vi.fn(async () => response) };
}

function setup(jev: JevClient | null, responses: Parameters<typeof scriptedModel>[0]) {
  const context: TurnContext = { conversation: { shopId: SHOP, mode: "ai" }, product: { id: VAY, name: "Váy suông linen" } };
  const store = {
    loadTurnContext: vi.fn<EngineStore["loadTurnContext"]>(async () => context),
    productCards: vi.fn<EngineStore["productCards"]>(async (_s, ids) =>
      ids.map((productId) => ({ productId, name: "Váy suông linen", price: 389000, imageUrl: null, sizesInStock: ["M"] })),
    ),
    setNeedsHuman: vi.fn<EngineStore["setNeedsHuman"]>(async () => {}),
    insertTurn: vi.fn<EngineStore["insertTurn"]>(async () => "turn-1"),
    catalog: vi.fn(async () => [
      { id: VAY, name: "Váy suông linen", category: "Váy", colors: ["Be", "Trắng"], sizes: ["S", "M"] },
    ]),
  };
  const handlers = {
    get_stock: vi.fn(async () => ({
      productId: VAY,
      name: "Váy suông linen",
      price: 389000,
      variants: [{ variantId: VARIANT, size: "M", color: "Be", stock: 7 }],
    })),
    get_policy: vi.fn(async () => ({ kind: "khuyen_mai", content: null })),
    recommend_size: vi.fn(async () => ({ status: "ok", size: "L", sizeByHeight: "M", sizeByWeight: "L" })),
    handoff_to_staff: vi.fn(async () => ({ mode: "needs_human" })),
    search_products: vi.fn(async (): Promise<{ products: unknown[] }> => ({ products: [] })),
  };
  const model = scriptedModel(responses);
  const metrics: TurnMetrics[] = [];
  const deps: Partial<EngineDeps> = {
    model,
    store,
    handlers: handlers as unknown as ToolHandlers,
    db: {} as Db,
    modelName: "claude-haiku-5-5",
    staffShopId: SHOP,
    onMetrics: (m) => void metrics.push(m),
    jev,
  };
  return { store, handlers, model, metrics, run: (i: EngineInput) => runEngine(i, deps) };
}

describe("runEngine with Jev routing", () => {
  it("stock: the server runs get_stock, the model only writes (no tools), cards come from the server", async () => {
    const jev = jevSaying({});
    const { model, handlers, store, metrics, run } = setup(jev, [
      // the model tries to sneak in another product id: ignored
      finalJson({ text: "Dạ còn ạ, 389.000đ", productIds: [OTHER], quickReplies: ["Lấy size M"] }),
    ]);
    const result = await run(input("váy này màu be size M còn không"));
    await result.turnLogged;

    expect(jev.decide).toHaveBeenCalledTimes(1);
    expect(handlers.get_stock).toHaveBeenCalledWith({ productId: VAY, size: "M", color: "Be" }, expect.anything(), expect.anything());
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].tools).toBeUndefined();
    const system = (model.calls[0].system as { text: string }[]).map((b) => b.text).join("\n");
    expect(system).toContain("389000");
    expect(system).toContain(PROMPT_VERSION);
    expect(store.productCards).toHaveBeenCalledWith(SHOP, [VAY]);
    expect(result.output.reply.text).toBe("Dạ còn ạ, 389.000đ");
    expect(result.output.reply.products.map((p) => p.productId)).toEqual([VAY]);
    expect(result.output.reply.quickReplies).toEqual(["Lấy size M"]);

    const turn = store.insertTurn.mock.calls[0][0];
    expect((turn.tool_calls as { name: string }[]).map((c) => c.name)).toEqual(["get_stock"]);
    expect(turn.prompt_version).toBe(PROMPT_VERSION);
    expect(metrics[0].route).toMatchObject({ path: "router", intent: "stock", product: "viewing", jevModel: "typesafe/jev-1.13" });
  });

  it("complaint: hands off without any model call", async () => {
    const { model, handlers, store, metrics, run } = setup(jevSaying({ intent: { type: "choice", choice: "complaint", confidence: 0.99 } }), []);
    const result = await run(input("đồ giao bị rách"));
    expect(model.calls).toHaveLength(0);
    expect(handlers.handoff_to_staff).toHaveBeenCalledWith({ reason: "complaint" }, expect.anything(), expect.anything());
    expect(store.setNeedsHuman).not.toHaveBeenCalled(); // the tool moved it
    expect(result.handoffReason).toBe("complaint");
    expect(result.output.reply.text).toBe(HANDOFF_TEXT);
    expect(metrics[0].modelCalls).toHaveLength(0);
  });

  it("staff_draft complaint the word list misses: reply personally", async () => {
    const { run } = setup(jevSaying({ intent: { type: "choice", choice: "complaint", confidence: 0.9 } }), []);
    const result = await run({ mode: "staff_draft", history: [{ sender: "shopper", text: "sao shop làm ăn kiểu này" }] } as EngineInput);
    expect(result.output.personalReplyNeeded).toBe(true);
  });

  it("order: falls back to the LLM tool loop, which still has the tools", async () => {
    const { model, metrics, run } = setup(jevSaying({ intent: { type: "choice", choice: "order", confidence: 0.98 } }), [
      toolCalls(toolUse("get_stock", { productId: VAY })),
      finalJson({ text: "Bạn cho mình xin tên và số điện thoại nhé", productIds: [], quickReplies: [] }),
    ]);
    const result = await run(input("lấy cho mình 1 cái"));
    expect(model.calls[0].tools?.length).toBeGreaterThan(0);
    expect(result.output.reply.text).toContain("số điện thoại");
    expect(metrics[0].route).toMatchObject({ path: "llm_loop", fallbackReason: "order", intent: "order" });
  });

  it("Jev down: falls back to the tool loop and logs why", async () => {
    const jev: JevClient = { model: "m", decide: vi.fn(async () => Promise.reject(new Error("HTTP 502"))) };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { metrics, run } = setup(jev, [finalJson({ text: "Dạ chào bạn", productIds: [], quickReplies: [] })]);
    const result = await run(input("chào shop"));
    expect(result.output.reply.text).toBe("Dạ chào bạn");
    expect(metrics[0].route).toMatchObject({ path: "llm_loop", fallbackReason: "jev_error" });
    error.mockRestore();
  });

  it("without Jev, every turn is the tool loop", async () => {
    const { metrics, run } = setup(null, [finalJson({ text: "Dạ", productIds: [], quickReplies: [] })]);
    await run(input("chào"));
    expect(metrics[0].route).toEqual({ path: "llm_loop", fallbackReason: "no_jev" });
  });

  const sizeJev = () => jevSaying({ intent: { type: "choice", choice: "size", confidence: 0.99 } });
  const reply = (text: string) => finalJson({ text, productIds: [], quickReplies: [] });

  it("size post-check: a wrong size gets one retry with the tool's size spelled out", async () => {
    const { model, run } = setup(sizeJev(), [reply("Dạ bạn mặc size S nhé"), reply("Dạ bạn mặc size L nhé, theo cân nặng là L")]);
    const result = await run(input("mình cao 1m58 nặng 58 ký mặc size gì"));
    expect(model.calls).toHaveLength(2);
    const retrySystem = (model.calls[1].system as { text: string }[]).map((b) => b.text).join("\n");
    expect(retrySystem).toContain("tư vấn đúng size L");
    expect(result.output.reply.text).toBe("Dạ bạn mặc size L nhé, theo cân nặng là L");
  });

  it("size post-check: wrong twice -> the server writes the reply from the tool result", async () => {
    const { run } = setup(sizeJev(), [reply("Dạ size S"), reply("Dạ size XL")]);
    const result = await run(input("mình cao 1m58 nặng 58 ký mặc size gì"));
    expect(result.output.reply.text).toContain("size lớn hơn là L");
    expect(result.output.reply.products.map((p) => p.productId)).toEqual([VAY]);
  });

  it("discount post-check: an unbacked discount gets one retry, then a handoff (postcheck_failed)", async () => {
    const greeting = jevSaying({ intent: { type: "choice", choice: "greeting", confidence: 0.99 } });
    const { model, store, run } = setup(greeting, [reply("Dạ chào bạn, shop giảm 20% cho bạn nhé"), reply("Dạ mình giảm 10% cho bạn")]);
    const result = await run(input("chào shop"));
    expect(model.calls).toHaveLength(2);
    expect(result.handoffReason).toBe("postcheck_failed");
    expect(result.output.reply.text).toBe(DISCOUNT_HANDOFF_TEXT);
    expect(store.setNeedsHuman).toHaveBeenCalled();
  });

  it("router write with a wrong stock number is rewritten (PB-07)", async () => {
    const { model, store, run } = setup(jevSaying({}), [
      reply("Dạ size M màu be còn 3 cái, giá 389.000đ ạ"),
      reply("Dạ size M màu be còn 7 cái, giá 389.000đ ạ"),
    ]);
    const result = await run(input("size M màu be còn không?"));
    expect(model.calls).toHaveLength(2);
    expect(JSON.stringify(model.calls[1].system)).toContain(NUMBER_RETRY_NOTE);
    expect(result.handoffReason).toBeNull();
    expect(result.output.reply.text).toContain("còn 7 cái");
    await result.turnLogged;
    expect(store.insertTurn.mock.calls[0][0].postcheck).toEqual({ productMiss: false, numberCheck: { failed: [], retried: true } });
  });

  it("router write with an English word is rewritten once (F6)", async () => {
    const { model, run } = setup(jevSaying({}), [
      reply("Dạ size M màu be stock 7 ạ"),
      reply("Dạ size M màu be còn 7 cái ạ"),
    ]);
    const result = await run(input("size M màu be còn không?"));
    expect(model.calls).toHaveLength(2);
    expect((model.calls[1].system as Array<{ text: string }>).map((b) => b.text).join("\n")).toContain(VIETNAMESE_RETRY_NOTE);
    expect(result.output.reply.text).toBe("Dạ size M màu be còn 7 cái ạ");
  });

  it("router write with a wrong price twice sends the card and hands off (PB-07)", async () => {
    const { store, run } = setup(jevSaying({}), [reply("Dạ váy giá 350k ạ"), reply("Dạ váy giá 350k ạ")]);
    const result = await run(input("váy này giá bao nhiêu?"));
    expect(result.handoffReason).toBe("postcheck_failed");
    expect(result.output.reply.text).toBe(NUMBER_HANDOFF_TEXT);
    expect(result.output.reply.products.map((p) => p.productId)).toEqual([VAY]);
    expect(store.setNeedsHuman).toHaveBeenCalled();
  });

  it("an unreadable reply is asked for once more, then falls back", async () => {
    const greeting = () => jevSaying({ intent: { type: "choice", choice: "greeting", confidence: 0.99 } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cut = { stop_reason: "end_turn" as const, content: [{ type: "text" as const, text: '{"text":"Dạ ch', citations: null }] };
    const once = setup(greeting(), [cut, reply("Dạ chào bạn")]);
    expect((await once.run(input("chào"))).output.reply.text).toBe("Dạ chào bạn");
    const twice = setup(greeting(), [cut, cut]);
    expect((await twice.run(input("chào"))).output.reply.text).toBe(FALLBACK_TEXT);
    error.mockRestore();
  });

  it("an order in progress (last turn read back a quote) skips Jev and stays in the tool loop (PB-11)", async () => {
    const jev = jevSaying({ intent: { type: "choice", choice: "greeting", confidence: 0.99 } });
    const { store, metrics, run } = setup(jev, [reply("Dạ mình tạo đơn nhé")]);
    store.loadTurnContext.mockResolvedValueOnce({
      conversation: { shopId: SHOP, mode: "ai" },
      product: { id: VAY, name: "Váy suông linen" },
      previousQuote: {
        items: [{ variantId: VARIANT, quantity: 1 }],
        quote: {
          lines: [{ variantId: VARIANT, productId: VAY, name: "Váy suông linen", size: "M", color: "Be", quantity: 1, unitPrice: 389000, lineTotal: 389000 }],
          total: 389000,
        },
      },
    } as never);
    await run(input("ok"));
    expect(jev.decide).not.toHaveBeenCalled();
    expect(metrics[0].route).toEqual({ path: "llm_loop", fallbackReason: "order_in_progress" });
  });

  describe("product miss decided by the shopper's own search (PB-05 AC3)", () => {
    // Valid 12-char hex tails ("01".."05"), so get_stock really runs ok on one.
    const jackets = [1, 2, 3, 4, 5].map((n) => `a0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`);
    const followUp = input("loại áo khoác da màu đen ấy", {
      history: [
        { sender: "shopper", text: "Shop có áo khoác da không?" },
        { sender: "ai", text: "Dạ shop chưa tìm thấy áo khoác da. Bạn tìm áo khoác kiểu nào, màu gì ạ?" },
        { sender: "shopper", text: "loại áo khoác da màu đen ấy" },
      ],
    });

    it("router clarifying turn logs postcheck.productMiss and the next tool-loop miss hands off", async () => {
      // Turn 1: the router asks which product the shopper means; the row logs the miss.
      const first = setup(jevSaying({ product: { type: "choice", choice: "none" } }), [
        finalJson({ text: "Dạ bạn đang hỏi sản phẩm nào ạ?", productIds: [], quickReplies: [] }),
      ]);
      const r1 = await first.run(followUp);
      expect(r1.handoffReason).toBeNull();
      expect(r1.output.reply.text).toBe("Dạ bạn đang hỏi sản phẩm nào ạ?");
      await r1.turnLogged;
      expect(first.store.insertTurn.mock.calls[0][0].postcheck).toEqual({ productMiss: true });

      // Turn 2: the context carries the miss read from postcheck, and Jev is
      // down, so the tool loop runs. The model also searches the broader
      // "áo khoác" and works on one of its hits: still a miss, so it hands off.
      const second = setup({ model: "m", decide: vi.fn(async () => Promise.reject(new Error("HTTP 502"))) }, [
        toolCalls(
          toolUse("search_products", { query: "áo khoác" }),
          toolUse("search_products", { query: "áo khoác da" }),
          toolUse("get_stock", { productId: jackets[0] }),
        ),
        finalJson({ text: "Dạ còn nha", productIds: [], quickReplies: [] }),
      ]);
      second.store.loadTurnContext.mockResolvedValue({
        conversation: { shopId: SHOP, mode: "ai" },
        product: { id: VAY, name: "Váy suông linen" },
        previousTurnMissedProduct: true,
      } as never);
      second.handlers.search_products.mockImplementation(async (...args: unknown[]) => {
        const query = (args[0] as { query?: string }).query;
        return query === "áo khoác"
          ? { products: jackets.map((productId) => ({ productId, name: "Áo khoác", category: "áo khoác", price: 389000, imageUrl: null, colors: [], sizes: [] })) }
          : { products: [] };
      });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const r2 = await second.run(followUp);
      expect(r2.handoffReason).toBe("misunderstood_twice");
      expect(r2.output.reply.text).toBe(PRODUCT_NOT_FOUND_HANDOFF_TEXT);
      await r2.turnLogged;
      expect(second.store.insertTurn.mock.calls[0][0].postcheck).toEqual({ productMiss: true });
      error.mockRestore();
    });

    it("router: a second clarifying turn in a row hands off misunderstood_twice before the reply model runs", async () => {
      const t = setup(jevSaying({ product: { type: "choice", choice: "none" } }), []);
      t.store.loadTurnContext.mockResolvedValue({
        conversation: { shopId: SHOP, mode: "ai" },
        product: null,
        previousTurnMissedProduct: true,
      } as never);
      const r = await t.run(followUp);
      expect(r.handoffReason).toBe("misunderstood_twice");
      expect(r.output.reply).toEqual({ text: PRODUCT_NOT_FOUND_HANDOFF_TEXT, products: [], quickReplies: [] });
      expect(t.store.setNeedsHuman).toHaveBeenCalledTimes(1);
      expect(t.model.calls).toHaveLength(0);
      await r.turnLogged;
      const row = t.store.insertTurn.mock.calls[0][0];
      expect(row.handoff_reason).toBe("misunderstood_twice");
      expect(row.postcheck).toEqual({ productMiss: true });
    });

    it("router: the first clarifying turn (no previous miss) still writes the question", async () => {
      const t = setup(jevSaying({ product: { type: "choice", choice: "none" } }), [
        finalJson({ text: "Dạ bạn đang hỏi sản phẩm nào ạ?", productIds: [], quickReplies: [] }),
      ]);
      t.store.loadTurnContext.mockResolvedValue({
        conversation: { shopId: SHOP, mode: "ai" },
        product: null,
        previousTurnMissedProduct: false,
      } as never);
      const r = await t.run(followUp);
      expect(r.handoffReason).toBeNull();
      expect(t.store.setNeedsHuman).not.toHaveBeenCalled();
      expect(t.model.calls).toHaveLength(1);
    });
  });
});
