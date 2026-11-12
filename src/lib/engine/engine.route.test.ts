// PB-10: runEngine with Jev routing (a fake Jev client; no network).
import { describe, expect, it, vi } from "vitest";
import type { EngineInput } from "@/contract";
import { DISCOUNT_HANDOFF_TEXT } from "./discount-guard";
import { HANDOFF_TEXT, runEngine, type EngineDeps } from "./engine";
import { FALLBACK_TEXT } from "./model-reply";
import { OFFER_QUESTION, OFFER_QUICK_REPLIES } from "./handoff-offer";
import { ORDER_CONFIRM_NO, ORDER_CONFIRM_YES, orderConfirmText } from "./order-flow";
import type { JevClient, JevResponse } from "./jev";
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
    recordGap: vi.fn<NonNullable<EngineStore["recordGap"]>>(async () => {}),
    declineGap: vi.fn<NonNullable<EngineStore["declineGap"]>>(async () => {}),
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
    search_products: vi.fn(async () => ({ match: "none" as const, products: [] })),
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
    // the order was read back already (PB-31)
    const result = await run(input("đúng rồi", {
      history: [
        { sender: "shopper", text: "lấy cho mình 1 cái" },
        { sender: "ai", text: "Dạ, bạn muốn đặt Váy suông linen đúng không?" },
        { sender: "shopper", text: "đúng rồi" },
      ],
    }));
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

  describe("PB-31 on the Jev path", () => {
    const intent = (choice: string, extra: Record<string, unknown> = {}) =>
      jevSaying({ intent: { type: "choice", choice, confidence: 0.95 }, ...extra });

    it("(a) 'cho mua …' that Jev reads as human is read back as an order, no handoff, no model call", async () => {
      const { model, handlers, store, run } = setup(intent("human"), []);
      const result = await run(input("cho mua 1 váy màu be size M"));
      expect(model.calls).toHaveLength(0);
      expect(handlers.handoff_to_staff).not.toHaveBeenCalled();
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply).toEqual({
        text: orderConfirmText("Váy suông linen", "Be", "M"),
        products: [],
        quickReplies: [ORDER_CONFIRM_YES, ORDER_CONFIRM_NO],
      });
      expect(store.setNeedsHuman).not.toHaveBeenCalled();
    });

    it("PB-14 stays: complaint and asking for a person hand off at once", async () => {
      for (const [choice, text, reason] of [["human", "kêu chủ ra đây", "asked_for_human"], ["complaint", "hàng giao bị rách", "complaint"]]) {
        const { run } = setup(intent(choice), []);
        expect((await run(input(text))).handoffReason, text).toBe(reason);
      }
      const twice = setup(intent("unclear", { asked_to_clarify: { type: "noul", noul: 0.9 } }), []);
      expect((await twice.run(input("??? kkk"))).handoffReason).toBe("misunderstood_twice");
    });

    it("(b) the catalog question skips Jev: groups with a few products, groups as buttons", async () => {
      const jev = intent("unclear", { asked_to_clarify: { type: "noul", noul: 0.9 } });
      const { model, metrics, run } = setup(jev, []);
      const result = await run(input("hiện tại bên mình có những sản phẩm gì"));
      expect(jev.decide).not.toHaveBeenCalled();
      expect(model.calls).toHaveLength(0);
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.text).toContain("Váy & đầm: Váy suông linen");
      expect(result.output.reply.quickReplies).toEqual(["Váy & đầm"]);
      expect(metrics[0].route).toEqual({ path: "catalog" });
    });

    it("(c) off-topic / the staff's name: only the shop and the staff offer (not_covered_by_data)", async () => {
      const { model, store, run } = setup(intent("off_topic"), []);
      const result = await run(input("Tôi có thể biết tên nhân viên sắp tư vấn cho mình không?"));
      expect(model.calls).toHaveLength(0);
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.text).toContain(OFFER_QUESTION);
      expect(result.output.reply.quickReplies).toEqual(OFFER_QUICK_REPLIES);
      await result.turnLogged;
      expect(store.insertTurn.mock.calls[0][0]).toMatchObject({ handoff_reason: null, handoff_offer: "not_covered_by_data" });
      // PB-35a: off-topic reads no data, so nothing to learn.
      expect(store.recordGap).not.toHaveBeenCalled();
    });

    it("(d) 'mặc không vừa thì đổi được không' is answered from doi_tra even when Jev says product_detail", async () => {
      const { handlers, run } = setup(intent("product_detail"), [reply("Dạ, shop đổi size trong 7 ngày ạ.")]);
      handlers.get_policy.mockResolvedValue({ kind: "doi_tra", content: "Đổi size trong 7 ngày" } as never);
      const result = await run(input("Mua về mặc không vừa thì đổi được không shop?"));
      expect(handlers.get_policy).toHaveBeenCalledWith({ kind: "doi_tra" }, expect.anything(), expect.anything());
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.text).toBe("Dạ, shop đổi size trong 7 ngày ạ.");
    });

    it("soft handoff: a policy the shop didn't write is offered, not handed off", async () => {
      const { handlers, store, run } = setup(intent("policy", { policy_kind: { type: "choice", choice: "khuyen_mai" } }), []);
      const result = await run(input("shop có chương trình khuyến mãi gì không"));
      expect(handlers.handoff_to_staff).not.toHaveBeenCalled();
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.quickReplies).toEqual(OFFER_QUICK_REPLIES);
      await result.turnLogged;
      expect(store.insertTurn.mock.calls[0][0].handoff_offer).toBe("policy_not_covered");
      // PB-35a: the shopper's question is recorded on the offer turn.
      expect(store.recordGap).toHaveBeenCalledWith(
        expect.objectContaining({ shopId: SHOP }),
        { reason: "policy_not_covered", question: "shop có chương trình khuyến mãi gì không", productId: null },
        "turn-1",
      );
    });

    it("PB-35a: 'Không cần' marks the recorded question declined; 'Có' records nothing new", async () => {
      for (const [text, declined] of [["Không cần", true], ["Có, gặp nhân viên", false]] as const) {
        const { store, run } = setup(intent("policy"), []);
        store.loadTurnContext.mockResolvedValueOnce({
          conversation: { shopId: SHOP, mode: "ai" },
          product: { id: VAY, name: "Váy suông linen" },
          previousHandoffOffer: "policy_not_covered",
          previousTurnId: "turn-0",
        } as never);
        const result = await run(input(text));
        await result.turnLogged;
        expect(store.recordGap).not.toHaveBeenCalled();
        expect(store.declineGap.mock.calls).toEqual(declined ? [[expect.objectContaining({ shopId: SHOP }), "turn-0"]] : []);
      }
    });

    it("'bớt 50k' is refused, never handed off", async () => {
      const jev = intent("stock", { discount_trick: { type: "noul", noul: 0.95 } });
      const { handlers, run } = setup(jev, [reply("Dạ, shop không giảm giá thêm được ạ.")]);
      const result = await run(input("Mình lấy 2 cái, shop bớt cho mình 50k được không?"));
      expect(result.handoffReason).toBeNull();
      expect(handlers.handoff_to_staff).not.toHaveBeenCalled();
      expect(result.output.reply.text).toBe("Dạ, shop không giảm giá thêm được ạ.");
    });
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
});
