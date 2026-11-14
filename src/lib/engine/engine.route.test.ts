// PB-10: runEngine with Jev routing (a fake Jev client; no network).
import { describe, expect, it, vi } from "vitest";
import type { EngineInput } from "@/contract";
import { DISCOUNT_HANDOFF_TEXT } from "./discount-guard";
import { HANDOFF_TEXT, PRODUCT_NOT_FOUND_HANDOFF_TEXT, runEngine, type EngineDeps } from "./engine";
import { FALLBACK_TEXT } from "./model-reply";
import { OFFER_QUESTION, OFFER_QUICK_REPLIES } from "./handoff-offer";
import { ORDER_CONFIRM_NO, ORDER_CONFIRM_YES, orderConfirmText } from "./order-flow";
import type { JevClient, JevResponse } from "./jev";
import { NUMBER_CARD_TEXT, NUMBER_RETRY_NOTE } from "./number-check";
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
    recordGap: vi.fn<NonNullable<EngineStore["recordGap"]>>(async () => {}),
    declineGap: vi.fn<NonNullable<EngineStore["declineGap"]>>(async () => {}),
    pairedProductNames: vi.fn<NonNullable<EngineStore["pairedProductNames"]>>(async () => ["Áo sơ mi trắng", "Chân váy chữ A"]),
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

  it("router write: a quick reply promising a discount is dropped (PB-07 guards apply to quick replies)", async () => {
    const { run } = setup(jevSaying({}), [
      finalJson({ text: "Dạ còn ạ", productIds: [], quickReplies: ["Giảm 50% nhé", "Xem váy"] }),
    ]);
    const result = await run(input("váy này còn không"));
    expect(result.output.reply.text).toBe("Dạ còn ạ");
    expect(result.output.reply.quickReplies).toEqual(["Xem váy"]);
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

  it("router write with a wrong price twice sends the card and stays with the AI (PB-07)", async () => {
    const { store, run } = setup(jevSaying({}), [reply("Dạ váy giá 350k ạ"), reply("Dạ váy giá 350k ạ")]);
    const result = await run(input("váy này giá bao nhiêu?"));
    expect(result.handoffReason).toBeNull();
    expect(result.output.reply.text).toBe(NUMBER_CARD_TEXT);
    expect(result.output.reply.products.map((p) => p.productId)).toEqual([VAY]);
    expect(store.setNeedsHuman).not.toHaveBeenCalled();
    await result.turnLogged;
    expect(store.insertTurn.mock.calls[0][0].handoff_reason).toBeNull();
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

  describe("PB-39: the reply says data is missing while this turn has it", () => {
    const BOT01_ASK = "Mình muốn mua váy suông linen, cao 160cm nặng 50kg. Tư vấn size và báo giá, màu còn hàng giúp mình.";
    const BOT01_REPLY =
      "Dạ, bạn mặc size M là vừa ạ. Còn giá và màu còn hàng thì mình chưa có thông tin cụ thể, để mình kiểm tra và cập nhật cho bạn nhé.";
    const sizeAndStock = (h: ReturnType<typeof setup>["handlers"]) => {
      h.recommend_size.mockResolvedValue({ status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" });
      h.get_stock.mockResolvedValue({
        productId: VAY,
        name: "Váy suông linen",
        price: 289000,
        variants: [{ variantId: VARIANT, size: "M", color: "Trắng", stock: 4 }],
      });
    };
    const systemOf = (call: { system?: unknown }) => (call.system as { text: string }[]).map((b) => b.text).join("\n");

    it("BOT-01: the price and colors are in the facts; a reply saying they are missing is regenerated once", async () => {
      const good = "Dạ, bạn mặc size M ạ. Váy giá 289.000đ, size M còn màu trắng.";
      const s = setup(sizeJev(), [reply(BOT01_REPLY), reply(good)]);
      sizeAndStock(s.handlers);
      const result = await s.run(input(BOT01_ASK));
      expect(s.model.calls).toHaveLength(2);
      expect(systemOf(s.model.calls[0])).toContain("289000");
      expect(systemOf(s.model.calls[1])).toContain("Kiểm tra tự động");
      expect(systemOf(s.model.calls[1])).toContain("cập nhật");
      expect(result.output.reply.text).toBe(good);
      expect(result.handoffReason).toBeNull();
    });

    it("BOT-01 twice: the server writes size, price and colors from the tool results, with the card", async () => {
      const s = setup(sizeJev(), [reply(BOT01_REPLY), reply(BOT01_REPLY)]);
      sizeAndStock(s.handlers);
      const result = await s.run(input(BOT01_ASK));
      expect(s.model.calls).toHaveLength(2);
      const text = result.output.reply.text;
      expect(text).toContain("size M");
      expect(text).toContain("289.000đ");
      expect(text).toContain("Trắng");
      expect(text).not.toContain("cập nhật");
      expect(result.output.reply.products.map((p) => p.productId)).toEqual([VAY]);
      expect(result.handoffReason).toBeNull();
    });

    it("BOT-05: after a handback, 'phí ship bao nhiêu?' reads giao_hang although Jev picked doi_tra", async () => {
      const policies = { doi_tra: "Đổi trong 7 ngày", giao_hang: "Phí ship đồng giá 30.000đ cho mọi đơn." };
      // policy_answers: the shipping text answers the question (a failing
      // coverage check would count as "not covered", #11).
      const s = setup(jevSaying({
        intent: { type: "choice", choice: "policy", confidence: 0.9 },
        policy_kind: { type: "choice", choice: "doi_tra" },
        policy_answers: { type: "noul", noul: 0.9 },
      }), [
        reply("Dạ, hiện shop chưa có thông tin về phí giao hàng ạ. Về đổi trả, shop hỗ trợ đổi trong 7 ngày."),
        reply("Dạ, shop chưa có thông tin phí ship ạ."),
      ]);
      s.handlers.get_policy.mockImplementation((async (i: { kind: keyof typeof policies }) => ({ kind: i.kind, content: policies[i.kind] })) as never);
      const result = await s.run(input("phí ship bao nhiêu?", {
        history: [
          { sender: "shopper", text: "mặc không vừa thì đổi được không" },
          { sender: "ai", text: "Dạ, shop hỗ trợ đổi trong 7 ngày ạ." },
          { sender: "staff", text: "Dạ chị đã kiểm tra rồi nha, bạn hỏi tiếp bé AI nhé" },
          { sender: "shopper", text: "phí ship bao nhiêu?" },
        ],
      }));
      expect((s.handlers.get_policy.mock.calls as unknown[][]).map((c) => c[0])).toEqual([{ kind: "giao_hang" }]);
      expect(systemOf(s.model.calls[0])).toContain("30.000đ");
      // wrong twice: the shop's shipping text, as written
      expect(result.output.reply.text).toContain("30.000đ");
      expect(result.output.reply.text).not.toContain("7 ngày");
    });

    it("a promised update on a policy that doesn't cover the question keeps the route's staff offer", async () => {
      // Codex 14/11: the PB-39 fallback used to drop the router's policy_not_covered offer.
      const s = setup(jevSaying({
        intent: { type: "choice", choice: "policy", confidence: 0.9 },
        policy_kind: { type: "choice", choice: "giao_hang" },
        policy_answers: { type: "noul", noul: 0.1 },
      }), [reply("Dạ để mình kiểm tra và cập nhật cho bạn nhé"), reply("Dạ mình xem lại rồi báo bạn sau nhé")]);
      s.handlers.get_policy.mockResolvedValue({ kind: "giao_hang", content: "Phí ship đồng giá 30.000đ cho mọi đơn." } as never);
      const result = await s.run(input("chủ nhật shop có giao không?"));
      expect(result.handoffReason).toBeNull();
      expect(result.output.reply.text).toContain("30.000đ");
      expect(result.output.reply.quickReplies).toEqual(OFFER_QUICK_REPLIES);
      await result.turnLogged;
      expect(s.store.insertTurn.mock.calls[0][0].handoff_offer).toBe("policy_not_covered");
    });

    it("a promised update with nothing looked up: one retry, then the staff offer (not_covered_by_data)", async () => {
      const greeting = jevSaying({ intent: { type: "choice", choice: "greeting", confidence: 0.99 } });
      const s = setup(greeting, [reply("Dạ để mình kiểm tra và cập nhật cho bạn nhé"), reply("Dạ mình xem lại rồi báo bạn sau nhé")]);
      const result = await s.run(input("chào shop"));
      expect(s.model.calls).toHaveLength(2);
      expect(result.output.reply.text).toContain(OFFER_QUESTION);
      expect(result.output.reply.quickReplies).toEqual(OFFER_QUICK_REPLIES);
      expect(s.metrics[0].handoffOffer).toBe("not_covered_by_data");
    });
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
      // Jev says the policy answers it (a failing coverage check now counts as not covered, #11).
      const { handlers, run } = setup(intent("product_detail", { policy_answers: { type: "noul", noul: 0.9 } }), [reply("Dạ, shop đổi size trong 7 ngày ạ.")]);
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

    it("Jev sees the shopper was already asked and still names no product: the not-found text is sent (scenario 1)", async () => {
      const jev = jevSaying({
        product: { type: "choice", choice: "none" },
        asked_to_clarify: { type: "noul", noul: 0.95 },
      });
      const { model, store, handlers, run } = setup(jev, []);
      store.loadTurnContext.mockResolvedValueOnce({ conversation: { shopId: SHOP, mode: "ai" }, product: null } as never);
      const result = await run(followUp);
      expect(model.calls).toHaveLength(0);
      expect(handlers.handoff_to_staff).toHaveBeenCalled();
      expect(result.handoffReason).toBe("misunderstood_twice");
      expect(result.output.reply.text).toBe(PRODUCT_NOT_FOUND_HANDOFF_TEXT);
    });

    it("gibberish twice (intent unclear) keeps the generic handoff text", async () => {
      const jev = jevSaying({
        intent: { type: "choice", choice: "unclear", confidence: 0.95 },
        asked_to_clarify: { type: "noul", noul: 0.95 },
      });
      const { run } = setup(jev, []);
      const result = await run(input("asdkj qwe"));
      expect(result.handoffReason).toBe("misunderstood_twice");
      expect(result.output.reply.text).toBe(HANDOFF_TEXT);
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
      second.handlers.search_products.mockImplementation((async (...args: unknown[]) => {
        const query = (args[0] as { query?: string }).query;
        return query === "áo khoác"
          ? { match: "close", products: jackets.map((productId) => ({ productId, name: "Áo khoác", category: "áo khoác", price: 389000, imageUrl: null, colors: [], sizes: [] })) }
          : { match: "none", products: [] };
      }) as never);
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

  it("PB-31 AC12: 'phối cùng sản phẩm nào?' offers the shop's paired products as buttons, on both paths", async () => {
    const pairing = jevSaying({ intent: { type: "choice", choice: "pairing", confidence: 0.95 }, product: { type: "choice", choice: "none" } });
    const router = setup(pairing, []);
    const viaRouter = await router.run(input("mặc với gì đẹp", { productId: null }));
    expect(viaRouter.output.reply.quickReplies).toEqual(["Áo sơ mi trắng", "Chân váy chữ A"]);
    expect(router.store.pairedProductNames).toHaveBeenCalledWith(SHOP);

    const loop = setup(null, [finalJson({ text: "Dạ bạn muốn phối với món nào ạ?", productIds: [], quickReplies: [] })]);
    loop.store.loadTurnContext.mockResolvedValueOnce({ conversation: { shopId: SHOP, mode: "ai" }, product: null } as never);
    const viaLoop = await loop.run(input("phối đồ gì đẹp", { productId: null }));
    expect(viaLoop.output.reply.quickReplies).toEqual(["Áo sơ mi trắng", "Chân váy chữ A"]);
  });
});

describe("PB-45: sizes the shop doesn't sell, and every color in stock", () => {
  const XXL = "mình cao 1m58 nặng 50kg nhưng muốn mặc size XXL cho rộng như cái mền được không?";
  const reply = (text: string) => finalJson({ text, productIds: [], quickReplies: [] });
  const systemOf = (call: { system?: unknown }) => (call.system as { text: string }[]).map((b) => b.text).join("\n");

  it("Bot #1 with Jev: the server says there is no XXL and gives recommend_size; no model call, no stock lookup", async () => {
    const { model, handlers, run } = setup(jevSaying({ intent: { type: "choice", choice: "size", confidence: 0.95 } }), []);
    handlers.recommend_size.mockResolvedValue({ status: "ok", size: "S", sizeByHeight: "S", sizeByWeight: "S" });
    const result = await run(input(XXL));
    expect(model.calls).toHaveLength(0);
    expect(handlers.get_stock).not.toHaveBeenCalled();
    expect(result.output.reply.text).toContain("không có size XXL, chỉ có các size S, M");
    expect(result.output.reply.text).toContain("size S là vừa");
    expect(result.output.reply.text).toContain("size M");
    expect(result.output.reply.products.map((p) => p.productId)).toEqual([VAY]);
  });

  it("Bot #1 without Jev: the same answer, before the tool loop", async () => {
    const { model, handlers, metrics, run } = setup(null, []);
    handlers.recommend_size.mockResolvedValue({ status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "S" });
    const result = await run(input(XXL));
    expect(model.calls).toHaveLength(0);
    expect(result.output.reply.text).toContain("không có size XXL");
    expect(result.output.reply.text).toContain("Size M đã là size lớn nhất");
    expect(metrics[0].route).toEqual({ path: "size_guard" });
  });

  describe("Bug #2: 'Còn màu nào khác?'", () => {
    const history = [
      { sender: "shopper" as const, text: "váy màu trắng size M còn không" },
      { sender: "ai" as const, text: "Dạ, váy màu trắng size M còn 4 chiếc ạ." },
      { sender: "shopper" as const, text: "Còn màu nào khác?" },
    ];
    const bothColors = (handlers: { get_stock: ReturnType<typeof vi.fn> }) =>
      handlers.get_stock.mockResolvedValue({
        productId: VAY,
        name: "Váy suông linen",
        price: 389000,
        variants: [
          { variantId: VARIANT, size: "M", color: "Be", stock: 7 },
          { variantId: OTHER, size: "M", color: "Trắng", stock: 4 },
        ],
      });

    it("get_stock without the earlier color; a reply leaving a color out is regenerated once", async () => {
      const good = "Dạ, size M còn màu Be 7 chiếc và màu Trắng 4 chiếc, giá 389.000đ ạ.";
      const s = setup(jevSaying({}), [reply("Dạ, hiện mình chỉ thấy màu trắng size M còn 4 chiếc ạ."), reply(good)]);
      bothColors(s.handlers);
      const result = await s.run(input("Còn màu nào khác?", { history }));
      expect(s.handlers.get_stock).toHaveBeenCalledWith({ productId: VAY, size: "M" }, expect.anything(), expect.anything());
      expect(s.model.calls).toHaveLength(2);
      expect(systemOf(s.model.calls[1])).toContain("bỏ sót Be");
      expect(result.output.reply.text).toBe(good);
    });

    it("left out twice: the reply is written from get_stock, every color in it", async () => {
      const only = "Dạ, hiện mình chỉ thấy màu trắng size M còn 4 chiếc ạ.";
      const s = setup(jevSaying({}), [reply(only), reply(only)]);
      bothColors(s.handlers);
      const result = await s.run(input("Còn màu nào khác?", { history }));
      expect(result.output.reply.text).toContain("size M màu Be");
      expect(result.output.reply.text).toContain("size M màu Trắng");
      expect(result.output.reply.products.map((p) => p.productId)).toEqual([VAY]);
    });
  });
});
