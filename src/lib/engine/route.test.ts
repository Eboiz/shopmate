import { describe, expect, it, vi } from "vitest";
import type { HistoryMessage, ToolName } from "@/contract";
import type { CatalogItem, JevDecision } from "./jev";
import {
  ASK_PAIRING_PRODUCT_TEXT,
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
  { id: VAY, name: "Váy suông linen", category: "Váy", colors: ["Be", "Trắng", "Xanh rêu"], sizes: ["S", "M", "L"] },
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

  it("size out of the chart: customer hands off, staff gets a note", async () => {
    const out = { recommend_size: { ok: true, output: { status: "out_of_range" } } };
    const customer = setup(out);
    expect(await customer.run({ decision: decision({ intent: "size" }), history: said("cao 210cm nặng 150kg") })).toEqual({
      kind: "handoff",
      reason: "size_out_of_range",
      sizeStatus: "out_of_range",
      viaTool: true,
    });
    const staff = setup(out);
    const note = await staff.run({ mode: "staff_draft", decision: decision({ intent: "size" }), history: said("cao 210cm nặng 150kg") });
    expect(note.kind).toBe("fixed");
    expect(staff.runTool).not.toHaveBeenCalledWith("handoff_to_staff", expect.anything());
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
    expect(await setup(none).run({ decision: decision({ intent: "policy" }) })).toMatchObject({ kind: "handoff", reason: "policy_not_covered" });
    expect(await setup(none).run({ mode: "staff_draft", decision: decision({ intent: "policy" }) })).toEqual({
      kind: "fixed",
      reply: { text: STAFF_NO_POLICY_TEXT, products: [], quickReplies: [] },
    });
  });

  it("policy text that doesn't answer the question: customer hands off, staff gets a note (v0.6 rule)", async () => {
    const shipping = { get_policy: { ok: true, output: { kind: "giao_hang", content: "Giao 2-3 ngày" } } };
    const silent = async () => 0.1;
    const customer = setup(shipping);
    expect(await customer.run({ decision: decision({ intent: "policy", policyKind: "giao_hang" }), policyCovers: silent })).toMatchObject({
      kind: "handoff",
      reason: "policy_not_covered",
    });
    expect(await setup(shipping).run({ mode: "staff_draft", decision: decision({ intent: "policy" }), policyCovers: silent })).toEqual({
      kind: "fixed",
      reply: { text: STAFF_POLICY_SILENT_TEXT, products: [], quickReplies: [] },
    });
    // a failing check is treated as "not covered": customer goes to staff,
    // staff_draft gets the fixed text
    const failing = async () => Promise.reject(new Error("jev down"));
    expect(await setup(shipping).run({ decision: decision({ intent: "policy" }), policyCovers: failing })).toMatchObject({
      kind: "handoff",
      reason: "policy_not_covered",
    });
    expect(await setup(shipping).run({ mode: "staff_draft", decision: decision({ intent: "policy" }), policyCovers: failing })).toEqual({
      kind: "fixed",
      reply: { text: STAFF_POLICY_SILENT_TEXT, products: [], quickReplies: [] },
    });
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

  it("complaint, asking for a person, data not covered: customer hands off; staff gets personal/notes", async () => {
    expect(await setup().run({ decision: decision({ intent: "complaint" }) })).toMatchObject({ kind: "handoff", reason: "complaint" });
    expect(await setup().run({ decision: decision({ intent: "human" }) })).toMatchObject({ kind: "handoff", reason: "asked_for_human" });
    expect(await setup().run({ decision: decision({ intent: "product_detail" }) })).toMatchObject({ kind: "handoff", reason: "not_covered_by_data" });
    expect(await setup().run({ mode: "staff_draft", decision: decision({ intent: "complaint" }) })).toEqual({ kind: "personal" });
    expect(await setup().run({ mode: "staff_draft", decision: decision({ intent: "product_detail" }) })).toEqual({
      kind: "fixed",
      reply: { text: STAFF_NO_DATA_TEXT, products: [], quickReplies: [] },
    });
  });

  it("a failed handoff tool is reported, so the engine moves the conversation itself", async () => {
    const { run } = setup({ handoff_to_staff: { ok: false, output: undefined, code: "internal_error" } });
    expect(await run({ decision: decision({ intent: "complaint" }) })).toMatchObject({ kind: "handoff", viaTool: false });
  });

  it("unclear: asks once, hands off when the last AI message already asked", async () => {
    expect(await setup().run({ decision: decision({ intent: "unclear" }) })).toMatchObject({ kind: "write" });
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
});
