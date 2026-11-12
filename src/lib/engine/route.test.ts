import { describe, expect, it, vi } from "vitest";
import { quickReplySchema, type HistoryMessage, type ToolName } from "@/contract";
import { OFFER_QUESTION, OFFER_QUICK_REPLIES } from "./handoff-offer";
import type { CatalogItem, JevDecision } from "./jev";
import { ORDER_CONFIRM_NO, ORDER_CONFIRM_YES, orderConfirmText } from "./order-flow";
import {
  ASK_PAIRING_PRODUCT_TEXT,
  catalogGroups,
  catalogOverview,
  groupListing,
  isGroupName,
  STAFF_OFF_TOPIC_TEXT,
  STAFF_BUTTON,
  requestedColor,
  requestedSize,
  routeTurn,
  STAFF_NO_DATA_TEXT,
  STAFF_NO_POLICY_TEXT,
  STAFF_POLICY_SILENT_TEXT,
  type RouteInput,
  type ToolResult,
} from "./route";

const VAY = "a0000000-0000-4000-8000-000000000011";
const AO = "a0000000-0000-4000-8000-000000000012";
const catalog: CatalogItem[] = [
  {
    id: VAY,
    name: "Váy suông linen",
    category: "Váy",
    description: "Vải linen thoáng mát, dáng suông dài qua gối. Giặt tay hoặc giặt máy chế độ nhẹ.",
    colors: ["Be", "Trắng", "Xanh rêu"],
    sizes: ["S", "M", "L"],
  },
  { id: AO, name: "Áo khoác jean", category: "Áo khoác", colors: ["Xanh"], sizes: ["M"] },
];
const viewing = { id: VAY, name: "Váy suông linen" };

const decision = (over: Partial<JevDecision> = {}): JevDecision => ({
  model: "jev",
  intent: "stock",
  confidence: 0.95,
  product: { kind: "viewing" },
  policyKind: "doi_tra",
  discountTrick: 0.02,
  askedToClarify: 0.05,
  ms: 500,
  cost: null,
  ...over,
});
const said = (...texts: string[]): HistoryMessage[] => texts.map((text) => ({ sender: "shopper", text }));

const variant = (size: string, color: string, stock: number) => ({ variantId: `${VAY}`, size, color, stock });

// Answers per tool name; a function gets the input.
function setup(answers: Partial<Record<ToolName, ToolResult | ((input: Record<string, unknown>) => ToolResult)>> = {}) {
  const runTool = vi.fn(async (name: ToolName, input: Record<string, unknown>): Promise<ToolResult> => {
    const a = answers[name];
    if (typeof a === "function") return a(input);
    return a ?? { ok: true, output: name === "handoff_to_staff" ? { mode: "needs_human" } : {} };
  });
  const cards = vi.fn(async (ids: string[]) =>
    ids.map((productId) => ({ productId, name: "Quần", price: 1, imageUrl: null, sizesInStock: ["M"] })),
  );
  const run = (over: Partial<RouteInput>) =>
    routeTurn({ mode: "customer", history: said("x"), decision: decision(), viewing, catalog, runTool, cards, ...over });
  return { runTool, cards, run };
}

describe("argument helpers", () => {
  it("finds the color the shopper named, longest first, and needs 'màu' before a short one", () => {
    const colors = ["Be", "Xanh", "Xanh rêu"];
    expect(requestedColor(said("vay mau xanh reu con ko"), colors)).toBe("Xanh rêu");
    expect(requestedColor(said("màu be size M còn không"), colors)).toBe("Be");
    expect(requestedColor(said("size bé thôi"), colors)).toBeNull();
    expect(requestedColor(said("màu trắng"), colors)).toBeNull();
    expect(requestedColor(said("màu xanh nha", "vậy màu be thì sao"), colors)).toBe("Be");
  });

  it("finds the size the shopper asked for, written as the product writes it", () => {
    expect(requestedSize(said("size m còn không"), ["S", "M"])).toBe("M");
    expect(requestedSize(said("còn không"), ["S", "M"])).toBeNull();
  });
});

describe("routeTurn", () => {
  it("falls back to the tool loop for orders and for unsure intents", async () => {
    const { run, runTool } = setup();
    expect(await run({ decision: decision({ intent: "order" }) })).toEqual({ kind: "fallback", reason: "order" });
    expect(await run({ decision: decision({ confidence: 0.4 }) })).toEqual({ kind: "fallback", reason: "low_confidence" });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("stock: filters by the size and color the shopper said; the server picks the card", async () => {
    const { run, runTool } = setup({
      get_stock: { ok: true, output: { productId: VAY, name: "Váy suông linen", price: 389000, variants: [variant("M", "Be", 7)] } },
    });
    const out = await run({ history: said("váy này màu be size M còn không") });
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("get_stock", { productId: VAY, size: "M", color: "Be" });
    expect(out).toMatchObject({
      kind: "write",
      facts: { conHang: true, price: 389000, bienTheConHang: [{ size: "M", color: "Be", tonKho: 7 }] },
      productIds: [VAY],
    });
  });

  it("stock: out of stock -> a second get_stock for the other sizes and colors", async () => {
    const { run, runTool } = setup({
      get_stock: (input) =>
        input.size
          ? { ok: true, output: { productId: VAY, name: "Váy", price: 1, variants: [variant("M", "Be", 0)] } }
          : { ok: true, output: { productId: VAY, name: "Váy", price: 1, variants: [variant("M", "Be", 0), variant("L", "Trắng", 3)] } },
    });
    const out = await run({ history: said("màu be size M còn không") });
    expect(runTool.mock.calls.map((c) => c[1])).toEqual([{ productId: VAY, size: "M", color: "Be" }, { productId: VAY }]);
    expect(out).toMatchObject({ kind: "write", facts: { conHang: false, bienTheKhacConHang: [{ size: "L", color: "Trắng", tonKho: 3 }] } });
  });

  it("uses the product Jev picked from the catalog over the one on screen", async () => {
    const { run, runTool } = setup({ get_stock: { ok: true, output: { productId: AO, name: "Áo", price: 1, variants: [] } } });
    await run({ decision: decision({ product: { kind: "catalog", id: AO } }) });
    expect(runTool.mock.calls[0][1]).toEqual({ productId: AO });
  });

  it("no product: asks which one; already asked last turn -> hands off (misunderstood_twice)", async () => {
    const first = setup();
    expect(await first.run({ viewing: null, decision: decision({ product: { kind: "none" } }) })).toMatchObject({ kind: "write", productIds: [] });
    expect(first.runTool).not.toHaveBeenCalled();
    const second = setup();
    const out = await second.run({ viewing: null, decision: decision({ product: { kind: "none" }, askedToClarify: 0.9 }) });
    expect(out).toEqual({ kind: "handoff", reason: "misunderstood_twice", sizeStatus: null, viaTool: true, productMiss: true });
    expect(second.runTool).toHaveBeenCalledWith("handoff_to_staff", { reason: "misunderstood_twice" });
  });

  it("no-product clarifying write carries productMiss", async () => {
    const { run } = setup();
    const out = await run({ viewing: null, decision: decision({ product: { kind: "none" } }) });
    expect(out).toMatchObject({ kind: "write", productIds: [], productMiss: true });
    // The other no-product outcomes are not a search miss.
    const pairing = await setup().run({ viewing: null, decision: decision({ intent: "pairing", product: { kind: "none" } }) });
    expect(pairing).toEqual({ kind: "fixed", reply: { text: ASK_PAIRING_PRODUCT_TEXT, products: [], quickReplies: [] } });
    const handoff = await setup().run({ viewing: null, decision: decision({ product: { kind: "none" }, askedToClarify: 0.9 }) });
    expect(handoff).toMatchObject({ kind: "handoff", reason: "misunderstood_twice" });
  });

  it("size: asks only for what is missing, without a tool", async () => {
    const { run, runTool } = setup();
    const out = await run({ decision: decision({ intent: "size" }), history: said("mình cao 1m58 thì mặc size nào") });
    expect(runTool).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "write", facts: { heightCm: 158, weightKg: null } });
    expect((out as { task: string }).task).toContain("cân nặng");
    expect((out as { task: string }).task).not.toContain("chiều cao");
  });

  it("size: both numbers -> recommend_size with parsed values; different sizes explained", async () => {
    const { run, runTool } = setup({ recommend_size: { ok: true, output: { status: "ok", size: "L", sizeByHeight: "M", sizeByWeight: "L" } } });
    const out = await run({ decision: decision({ intent: "size" }), history: said("1m58 58 ký mặc size gì") });
    expect(runTool).toHaveBeenCalledWith("recommend_size", { productId: VAY, heightCm: 158, weightKg: 58 });
    expect(out).toMatchObject({ kind: "write", facts: { size: "L" }, productIds: [VAY], sizeAdvice: { size: "L" } });
    expect((out as { task: string }).task).toContain("lớn hơn");
  });

  it("size out of the chart: customer is offered staff (PB-31), staff gets a note", async () => {
    const out = { recommend_size: { ok: true, output: { status: "out_of_range", nearestSize: "L", offCm: 38, offKg: 90 } } };
    const customer = setup(out);
    const offered = await customer.run({ decision: decision({ intent: "size" }), history: said("cao 210cm nặng 150kg") });
    expect(offered).toMatchObject({ kind: "fixed", offer: "size_out_of_range", reply: { quickReplies: OFFER_QUICK_REPLIES } });
    expect((offered as { reply: { text: string } }).reply.text).toContain("ngoài bảng size");
    expect((offered as { reply: { text: string } }).reply.text).not.toContain("L,");
    expect(customer.runTool).not.toHaveBeenCalledWith("handoff_to_staff", expect.anything());
    const staff = setup(out);
    const note = await staff.run({ mode: "staff_draft", decision: decision({ intent: "size" }), history: said("cao 210cm nặng 150kg") });
    expect(note.kind).toBe("fixed");
    expect(staff.runTool).not.toHaveBeenCalledWith("handoff_to_staff", expect.anything());
  });

  it("size just outside the chart names the nearest size, never picks one (PB-31)", async () => {
    const near = setup({ recommend_size: { ok: true, output: { status: "out_of_range", nearestSize: "L", offCm: 2, offKg: 1 } } });
    const out = await near.run({ decision: decision({ intent: "size" }), history: said("cao 1m74 nặng 63kg") });
    expect(out).toMatchObject({ kind: "fixed", offer: "size_out_of_range" });
    expect((out as { reply: { text: string } }).reply.text).toContain("Size gần nhất shop có là L");
  });

  it("no size chart: offer with not_covered_by_data (PB-31)", async () => {
    const none = setup({ recommend_size: { ok: true, output: { status: "no_chart" } } });
    expect(await none.run({ decision: decision({ intent: "size" }), history: said("1m60 50kg") })).toMatchObject({
      kind: "fixed",
      offer: "not_covered_by_data",
    });
  });

  it("pairing: get_pairings with the shopper's size, reply written by the server", async () => {
    const pairing = { productId: AO, name: "Áo khoác jean", price: 1, imageUrl: null, reason: "Hợp màu", sizesInStock: ["M"] };
    const { run, runTool } = setup({ get_pairings: { ok: true, output: { pairings: [pairing] } } });
    const out = await run({ decision: decision({ intent: "pairing" }), history: said("size M mặc với gì đẹp") });
    expect(runTool).toHaveBeenCalledWith("get_pairings", { productId: VAY, size: "M" });
    expect(out.kind).toBe("fixed");
    expect((out as { reply: { text: string } }).reply.text).toContain("Hợp màu");
  });

  it("pairing without a product asks which one", async () => {
    const { run } = setup();
    const out = await run({ viewing: null, decision: decision({ intent: "pairing", product: { kind: "none" } }) });
    expect(out).toEqual({ kind: "fixed", reply: { text: ASK_PAIRING_PRODUCT_TEXT, products: [], quickReplies: [] } });
  });

  it("policy: get_policy of the kind Jev picked; none written -> handoff (customer) or note (staff)", async () => {
    const written = setup({ get_policy: { ok: true, output: { kind: "giao_hang", content: "Giao 2-3 ngày, phí 30.000đ" } } });
    const out = await written.run({ decision: decision({ intent: "policy", policyKind: "giao_hang" }) });
    expect(written.runTool).toHaveBeenCalledWith("get_policy", { kind: "giao_hang" });
    expect(out).toMatchObject({ kind: "write", facts: { policy: { content: "Giao 2-3 ngày, phí 30.000đ" } } });

    const none = { get_policy: { ok: true, output: { kind: "doi_tra", content: null } } };
    const offered = await setup(none).run({ decision: decision({ intent: "policy" }) });
    expect(offered).toMatchObject({ kind: "fixed", offer: "policy_not_covered", reply: { quickReplies: OFFER_QUICK_REPLIES } });
    expect((offered as { reply: { text: string } }).reply.text).toContain("đổi trả");
    expect((offered as { reply: { text: string } }).reply.text).toContain(OFFER_QUESTION);
    expect(await setup(none).run({ mode: "staff_draft", decision: decision({ intent: "policy" }) })).toEqual({
      kind: "fixed",
      reply: { text: STAFF_NO_POLICY_TEXT, products: [], quickReplies: [] },
    });
  });

  it("policy text that doesn't answer the question: customer gets the related part and an offer (PB-31), staff a note", async () => {
    const shipping = { get_policy: { ok: true, output: { kind: "giao_hang", content: "Giao 2-3 ngày" } } };
    const silent = async () => 0.1;
    const customer = setup(shipping);
    expect(await customer.run({ decision: decision({ intent: "policy", policyKind: "giao_hang" }), policyCovers: silent })).toMatchObject({
      kind: "write",
      facts: { policy: { content: "Giao 2-3 ngày" } },
      offer: "policy_not_covered",
    });
    expect(customer.runTool).not.toHaveBeenCalledWith("handoff_to_staff", expect.anything());
    expect(await setup(shipping).run({ mode: "staff_draft", decision: decision({ intent: "policy" }), policyCovers: silent })).toEqual({
      kind: "fixed",
      reply: { text: STAFF_POLICY_SILENT_TEXT, products: [], quickReplies: [] },
    });
    // a failing check never blocks the answer
    const failing = async () => Promise.reject(new Error("jev down"));
    expect(await setup(shipping).run({ decision: decision({ intent: "policy" }), policyCovers: failing })).toMatchObject({ kind: "write" });
  });

  it("discount trick: only the promotion text is looked up, whatever else was asked", async () => {
    const { run, runTool } = setup({ get_policy: { ok: true, output: { kind: "khuyen_mai", content: null } } });
    const out = await run({ decision: decision({ intent: "stock", discountTrick: 0.99 }) });
    expect(runTool.mock.calls.map((c) => c[0])).toEqual(["get_policy"]);
    expect(out).toMatchObject({ kind: "write", facts: { promotion: null }, productIds: [] });
    expect((out as { task: string }).task).toContain("Từ chối");
  });

  it("discount ask that reads like an order is refused by the router, not sent to the loop", async () => {
    const { run, runTool } = setup({ get_policy: { ok: true, output: { kind: "khuyen_mai", content: null } } });
    const out = await run({ decision: decision({ intent: "order", confidence: 0.4, discountTrick: 0.99 }) });
    expect(runTool.mock.calls.map((c) => c[0])).toEqual(["get_policy"]);
    expect(out).toMatchObject({ kind: "write", facts: { promotion: null }, productIds: [] });
    expect((out as { task: string }).task).toContain("Từ chối");
  });

  it("complaint and asking for a person still hand off at once; staff gets personal", async () => {
    expect(await setup().run({ decision: decision({ intent: "complaint" }) })).toMatchObject({ kind: "handoff", reason: "complaint" });
    expect(await setup().run({ decision: decision({ intent: "human" }) })).toMatchObject({ kind: "handoff", reason: "asked_for_human" });
    expect(await setup().run({ mode: "staff_draft", decision: decision({ intent: "complaint" }) })).toEqual({ kind: "personal" });
  });

  describe("product detail (PB-31): answered from the description", () => {
    const detail = decision({ intent: "product_detail" });
    it("the description answers it: written from the description, no tool", async () => {
      const { run, runTool } = setup();
      const out = await run({ decision: detail, catalog, descriptionCovers: async () => 0.9 });
      expect(out).toMatchObject({ kind: "write", facts: { description: catalog[0].description }, productIds: [VAY] });
      expect(out).not.toHaveProperty("offer");
      expect(runTool).not.toHaveBeenCalled();
    });
    it("the description doesn't say: the related part and an offer", async () => {
      const out = await setup().run({ decision: detail, catalog, descriptionCovers: async () => 0.1 });
      expect(out).toMatchObject({ kind: "write", offer: "not_covered_by_data", productIds: [VAY] });
    });
    it("no description: a fixed offer naming the product", async () => {
      const out = await setup().run({ decision: decision({ intent: "product_detail", product: { kind: "catalog", id: AO } }) });
      expect(out).toMatchObject({ kind: "fixed", offer: "not_covered_by_data" });
      expect((out as { reply: { text: string } }).reply.text).toContain("Áo khoác jean");
    });
    it("a failing check is read as answered", async () => {
      const out = await setup().run({ decision: detail, descriptionCovers: () => Promise.reject(new Error("jev down")) });
      expect(out).toMatchObject({ kind: "write" });
      expect(out).not.toHaveProperty("offer");
    });
    it("staff_draft: answered from the description, or the note", async () => {
      expect(await setup().run({ mode: "staff_draft", decision: detail })).toMatchObject({ kind: "write" });
      expect(await setup().run({ mode: "staff_draft", decision: detail, descriptionCovers: async () => 0.1 })).toEqual({
        kind: "fixed",
        reply: { text: STAFF_NO_DATA_TEXT, products: [], quickReplies: [] },
      });
    });
  });

  it("no product but close ones named: asks which, with their names as buttons (PB-31)", async () => {
    const { run, runTool } = setup();
    const out = await run({ viewing: null, decision: decision({ product: { kind: "none" } }), history: said("loại áo khoác da màu đen ấy") });
    expect(out).toMatchObject({ kind: "write", productIds: [AO], quickReplies: ["Áo khoác jean"] });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("no product and nothing close: asks which, with the shop's groups as buttons", async () => {
    const out = await setup().run({ viewing: null, decision: decision({ product: { kind: "none" } }), history: said("cái đó còn không") });
    expect(out).toMatchObject({ kind: "write", productIds: [], quickReplies: ["Áo khoác", "Váy & đầm"] });
  });

  it("browse: the shop's groups as buttons, and products whose description fits (PB-31)", async () => {
    const browse = decision({ intent: "browse", product: { kind: "none" } });
    const out = await setup().run({ decision: browse, history: said("shop có những gì") });
    expect(out).toMatchObject({ kind: "write", productIds: [], quickReplies: ["Áo khoác", "Váy & đầm"] });
    const fits = await setup().run({ decision: browse, history: said("có đồ linen thoáng mát không") });
    expect(fits).toMatchObject({ kind: "write", productIds: [VAY] });
  });

  it("catalogGroups: the shop page's order, no 'Khác'", () => {
    expect(catalogGroups([...catalog, { id: "x", name: "Túi", category: "phu_kien", colors: [], sizes: [] }])).toEqual(["Áo khoác", "Váy & đầm"]);
  });

  it("a failed handoff tool is reported, so the engine moves the conversation itself", async () => {
    const { run } = setup({ handoff_to_staff: { ok: false, output: undefined, code: "internal_error" } });
    expect(await run({ decision: decision({ intent: "complaint" }) })).toMatchObject({ kind: "handoff", viaTool: false });
  });

  it("unclear: asks once, hands off when the last AI message already asked", async () => {
    expect(await setup().run({ decision: decision({ intent: "unclear" }) })).toMatchObject({
      kind: "write",
      quickReplies: ["Áo khoác", "Váy & đầm", STAFF_BUTTON],
    });
    const twice = await setup().run({ decision: decision({ intent: "unclear", askedToClarify: 0.8 }) });
    expect(twice).toMatchObject({ kind: "handoff", reason: "misunderstood_twice" });
    // Gibberish twice is not a product miss: the generic handoff text stays.
    expect(twice).not.toHaveProperty("productMiss");
    expect(await setup().run({ mode: "staff_draft", decision: decision({ intent: "unclear", askedToClarify: 0.8 }) })).toMatchObject({
      kind: "write",
    });
  });

  it("a tool error falls back to the tool loop", async () => {
    const { run } = setup({ get_stock: { ok: false, output: undefined, code: "product_not_found" } });
    expect(await run({})).toEqual({ kind: "fallback", reason: "tool_error" });
  });

  describe("PB-31 bugs and parity with the tool loop", () => {
    const BLAZER = "a0000000-0000-4000-8000-000000000013";
    const shop: CatalogItem[] = [
      ...catalog,
      { id: BLAZER, name: "Áo blazer", category: "Áo", colors: ["Đen", "Be"], sizes: ["S", "M"] },
    ];
    const blazer = { kind: "catalog" as const, id: BLAZER };

    it("'cho mua 1 áo blazer màu đen size S' read as human is an order: read back, no handoff", async () => {
      const { run, runTool } = setup();
      const out = await run({ catalog: shop, viewing: null, history: said("cho mua 1 áo blazer màu đen size S"), decision: decision({ intent: "human", product: blazer }) });
      expect(out).toEqual({
        kind: "fixed",
        reply: { text: orderConfirmText("Áo blazer", "Đen", "S"), products: [], quickReplies: [ORDER_CONFIRM_YES, ORDER_CONFIRM_NO] },
      });
      expect(runTool).not.toHaveBeenCalled();
    });

    it("review: asking for a person in other words next to a buying word still hands off at once", async () => {
      for (const text of ["Mình không muốn đặt với bot, cho gặp ai đó đi", "Cho mình gặp chị chủ để mua áo blazer"]) {
        const { run } = setup();
        expect(await run({ catalog: shop, history: said(text), decision: decision({ intent: "human", product: blazer }) }), text)
          .toMatchObject({ kind: "handoff", reason: "asked_for_human" });
      }
    });

    it("review: 'đổi màu khác cho mình xem' is a stock question, not the returns policy", async () => {
      const { run, runTool } = setup({ get_stock: { ok: true, output: { productId: VAY, name: "Váy", price: 1, variants: [] } } });
      await run({ history: said("đổi màu khác cho mình xem"), decision: decision({ intent: "stock" }) });
      expect(runTool).not.toHaveBeenCalledWith("get_policy", expect.anything());
      expect(runTool).toHaveBeenCalledWith("get_stock", expect.anything());
    });

    it("review: 'Ý bạn là A hay B?' buttons fit the 20-character limit, names longer than that are shortened", async () => {
      const long = [
        { id: AO, name: "Áo thun cổ tròn basic", category: "Áo", colors: [], sizes: [] },
        { id: BLAZER, name: "Áo thun cổ tim basic dáng rộng", category: "Áo", colors: [], sizes: [] },
      ];
      const out = await setup().run({ viewing: null, catalog: long, history: said("áo thun cổ tim basic"), decision: decision({ product: { kind: "none" } }) });
      const buttons = (out as { quickReplies: string[] }).quickReplies;
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) expect(quickReplySchema.safeParse(b).success, b).toBe(true);
      expect(out).toMatchObject({ facts: { closeProducts: expect.arrayContaining(["Áo thun cổ tim basic dáng rộng"]) } });
    });

    it("an order that also asks for a person still hands off (asked_for_human)", async () => {
      const out = await setup().run({ catalog: shop, history: said("cho gặp nhân viên để đặt hàng"), decision: decision({ intent: "human", product: blazer }) });
      expect(out).toMatchObject({ kind: "handoff", reason: "asked_for_human" });
    });

    it("order: read back first; a yes to the read-back and order details go to the tool loop", async () => {
      const { run } = setup();
      const first = await run({ catalog: shop, history: said("lấy cái đen size S"), decision: decision({ intent: "order", product: blazer }) });
      expect(first).toMatchObject({ kind: "fixed", reply: { text: "Dạ, bạn muốn đặt Áo blazer màu đen size S đúng không?" } });
      const yes: HistoryMessage[] = [
        { sender: "shopper", text: "lấy cái đen size S" },
        { sender: "ai", text: orderConfirmText("Áo blazer", "Đen", "S") },
        { sender: "shopper", text: ORDER_CONFIRM_YES },
      ];
      expect(await run({ catalog: shop, history: yes, decision: decision({ intent: "greeting" }) })).toEqual({ kind: "fallback", reason: "order" });
      expect(await run({ catalog: shop, history: said("Thảo 0912345678, Q1"), decision: decision({ intent: "order", product: blazer }) }))
        .toEqual({ kind: "fallback", reason: "order" });
      // an order with a discount demand ("lấy 2 cái, bớt 50k"): the router refuses it (PB-09 AC3, F4)
      expect(await run({ catalog: shop, history: said("lấy 2 cái đen size S, bớt 50k nha"), decision: decision({ intent: "order", product: blazer, discountTrick: 0.9 }) }))
        .toMatchObject({ kind: "write", productIds: [], task: expect.stringContaining("Từ chối") });
      // no product known: the tool loop asks which one
      expect(await run({ viewing: null, history: said("lấy 1 cái"), decision: decision({ intent: "order", product: { kind: "none" } }) }))
        .toEqual({ kind: "fallback", reason: "order" });
    });

    it("off-topic ('php2shell là gì', the owner's name): only the shop, and the staff offer", async () => {
      const { run, runTool } = setup();
      const out = await run({ history: said("php2shell là gì"), decision: decision({ intent: "off_topic", product: { kind: "none" } }) });
      expect(out).toMatchObject({ kind: "fixed", offer: "not_covered_by_data", reply: { quickReplies: OFFER_QUICK_REPLIES } });
      expect((out as { reply: { text: string } }).reply.text).toContain("chỉ hỗ trợ");
      expect((out as { reply: { text: string } }).reply.text).toContain(OFFER_QUESTION);
      expect(runTool).not.toHaveBeenCalled();
      expect(await setup().run({ mode: "staff_draft", decision: decision({ intent: "off_topic" }) })).toEqual({
        kind: "fixed",
        reply: { text: STAFF_OFF_TOPIC_TEXT, products: [], quickReplies: [] },
      });
    });

    it("'mặc không vừa thì đổi được không' is a returns question, answered from doi_tra", async () => {
      const { run, runTool } = setup({ get_policy: { ok: true, output: { kind: "doi_tra", content: "Đổi size trong 7 ngày" } } });
      const out = await run({ history: said("Mua về mặc không vừa thì đổi được không shop?"), decision: decision({ intent: "product_detail" }) });
      expect(runTool).toHaveBeenCalledWith("get_policy", { kind: "doi_tra" });
      expect(out).toMatchObject({ kind: "write", facts: { policy: { content: "Đổi size trong 7 ngày" } } });
      expect(out).not.toHaveProperty("offer");
    });

    it("review r2: Jev picked no product but the message names exactly one ('quần bò' = quần jean): that product's stock", async () => {
      const JEAN = "a0000000-0000-4000-8000-000000000014";
      const withJean: CatalogItem[] = [...catalog, { id: JEAN, name: "Quần jean ống đứng", category: "quan", colors: ["xanh"], sizes: ["M"] }];
      const { run, runTool } = setup({ get_stock: { ok: true, output: { productId: JEAN, name: "Quần jean ống đứng", price: 1, variants: [] } } });
      const out = await run({ viewing: null, catalog: withJean, history: said("Shop có quần bò không?"), decision: decision({ product: { kind: "none" } }) });
      expect(runTool).toHaveBeenCalledWith("get_stock", { productId: JEAN });
      expect(out).toMatchObject({ kind: "write", facts: { product: "Quần jean ống đứng" } });
    });

    it("close products beat 'misunderstood twice': the shopper said something the shop nearly has", async () => {
      const out = await setup().run({
        viewing: null,
        history: said("loại áo khoác da màu đen ấy"),
        decision: decision({ product: { kind: "none" }, askedToClarify: 0.9 }),
      });
      expect(out).toMatchObject({ kind: "write", quickReplies: ["Áo khoác jean"] });
    });

    it("review: a tapped group lists that group's products, names from the catalog as buttons", () => {
      const listing = groupListing(shop, "Áo")!;
      expect(listing.productIds).toEqual([BLAZER]);
      expect(listing.text).toContain("Áo blazer");
      expect(listing.text).not.toContain("Áo khoác jean");
      expect(listing.quickReplies).toEqual(["Áo blazer"]);
      expect(groupListing(shop, "váy & đầm")!.productIds).toEqual([VAY]);
      // review r2: the natural names of a group ("Váy", "đầm", "ao khoac") work too
      for (const t of ["Váy", "vay", "Đầm", "Váy đầm"]) expect(groupListing(shop, t)?.productIds, t).toEqual([VAY]);
      expect(groupListing(shop, "ao khoac")!.productIds).toEqual([AO]);
      expect(isGroupName("Váy")).toBe(true);
      expect(groupListing(shop, "áo blazer màu đen")).toBeNull();
      expect(groupListing(shop, "Quần")).toBeNull(); // no such group in this shop
    });

    it("catalogOverview: each group with a few products, groups as buttons", () => {
      const overview = catalogOverview(shop)!;
      expect(overview.text).toContain("Áo: Áo blazer");
      expect(overview.text).toContain("Áo khoác: Áo khoác jean");
      expect(overview.text).toContain("Váy & đầm: Váy suông linen");
      expect(overview.quickReplies).toEqual(["Áo", "Áo khoác", "Váy & đầm"]);
      expect(overview.text).not.toMatch(/\d{3}\.\d{3}/); // no price
      expect(catalogOverview([])).toBeNull();
    });
  });
});
