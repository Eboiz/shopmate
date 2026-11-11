import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { HANDOFF_TEXT } from "../engine";
import { isNearChart, OFFER_QUESTION, OFFER_QUICK_REPLIES, sizeOfferText } from "../handoff-offer";
import { extractMeasurements } from "../measurements";
import { toModelMessages } from "../messages";
import { rankProducts } from "../product-match";
import { FX } from "../test/two-shops";
import { recommendSize } from "../tools/recommend-size";
import type { EvalCase } from "./cases";
import { evalCases } from "./cases";
import { pb05EvalCases } from "./cases-pb05";
import { pb06Cases } from "./cases-pb06";
import { pb09Cases } from "./cases-pb09";
import { pb14Cases } from "./cases-pb14";
import { pb31Cases, pb31NearCases, pb31ReplayCases } from "./cases-pb31";
import { outcomeLabels, scoreRun, type ActualCall, type RunOutcome } from "./score";

const V = FX.a.vay01;
// Shop A's products and Váy suông linen's chart as two-shops.ts seeds them.
const SHOP_A = [
  { id: FX.a.vay01, name: "Váy suông linen", category: "váy" },
  { id: FX.a.ao03, name: "Áo sơ mi trắng", category: "áo" },
  { id: FX.a.quan05, name: "Quần ống rộng", category: null },
  { id: FX.a.blazer, name: "Áo blazer", category: "áo" },
  { id: FX.a.bomber, name: "Áo khoác bomber", category: "áo khoác" },
  { id: FX.a.jacketJean, name: "Áo khoác jean", category: "áo khoác" },
  { id: FX.a.jean, name: "Quần jean ống đứng", category: "quần" },
];
const chart = [
  { size: "S", height_min_cm: 150, height_max_cm: 157, weight_min_kg: 40, weight_max_kg: 46 },
  { size: "M", height_min_cm: 158, height_max_cm: 164, weight_min_kg: 47, weight_max_kg: 53 },
  { size: "L", height_min_cm: 165, height_max_cm: 172, weight_min_kg: 54, weight_max_kg: 60 },
];
const ALL_GROUPS = [...evalCases, ...pb05EvalCases, ...pb06Cases, ...pb09Cases, ...pb14Cases, ...pb31Cases];
const byId = (id: string) => pb31Cases.find((c) => c.id === id)!;

// The query a model would send for each near-match case: the product words of
// the shopper's message, as typed (search_products does the folding/synonyms).
const NEAR_QUERIES: Record<string, string> = {
  "near-typo-linen": "váy suông lenin",
  "near-typo-blazer": "ao blazzer",
  "near-no-diacritics-jean": "quan jean ong dung",
  "near-no-diacritics-somi": "ao so mi trang",
  "near-dam-vay": "đầm suông linen",
  "near-quan-bo-jean": "quần bò",
  "near-somi": "áo somi trắng",
  "near-jacket-bomber": "jacket bomber",
  "near-jacket-jean": "jacket jean",
  "replay-order-blazer": "áo blazer",
  "replay-leather-jacket": "áo khoác da",
};

const search = (query: string): ActualCall => {
  const { match, products } = rankProducts(query, SHOP_A, 5);
  return { name: "search_products", input: { query, limit: 5 }, output: { match, products: products.map((p) => ({ productId: p.id })) } };
};
const size = (heightCm: number, weightKg: number): ActualCall => ({
  name: "recommend_size",
  input: { productId: V, heightCm, weightKg },
});
const answered = (replyText: string, quickReplies: string[] = []): RunOutcome => ({ handoffReason: null, replyText, quickReplies });
const offered = (reason: "policy_not_covered" | "not_covered_by_data" | "size_out_of_range", replyText: string): RunOutcome => ({
  handoffReason: null,
  handoffOffer: reason,
  replyText,
  quickReplies: OFFER_QUICK_REPLIES,
});
const OFFTOPIC = `Dạ mình chỉ hỗ trợ về sản phẩm của shop thôi ạ. ${OFFER_QUESTION}`;
const NO_DELIVERY_TEXT = `Dạ shop chưa ghi lịch giao hàng. ${OFFER_QUESTION}`;
const nearSizeCalls: Record<string, [number, number]> = {
  "near-size-taller": [174, 58],
  "near-size-heavier": [170, 62],
  "near-size-edge-3cm-3kg": [175, 63],
  "near-size-shorter": [148, 42],
  "near-size-past-4cm": [176, 60],
};
const sizeOffer = (h: number, w: number) => {
  const out = recommendSize(chart, h, w);
  if (out.status !== "out_of_range") throw new Error(`${h}/${w} is inside the chart`);
  return offered("size_out_of_range", sizeOfferText(out));
};

// One correct run per case, by hand.
function correctRun(c: EvalCase): { calls: ActualCall[]; outcome: RunOutcome } {
  if (c.id.startsWith("replay-sunday-delivery")) {
    return { calls: [{ name: "get_policy", input: { kind: "giao_hang" } }], outcome: offered("policy_not_covered", NO_DELIVERY_TEXT) };
  }
  if (c.id.startsWith("replay-discount-50k")) {
    return { calls: [], outcome: answered("Dạ shop không bớt giá được ạ, giá váy là giá niêm yết. Bạn lấy 2 cái size nào ạ?") };
  }
  if (c.id in nearSizeCalls) {
    const [h, w] = nearSizeCalls[c.id];
    return { calls: [size(h, w)], outcome: sizeOffer(h, w) };
  }
  if (c.id.startsWith("near-")) {
    return { calls: [search(NEAR_QUERIES[c.id])], outcome: answered("Dạ shop có sản phẩm này, còn hàng ạ.") };
  }
  switch (c.id) {
    case "replay-return-not-fit":
      return { calls: [{ name: "get_policy", input: { kind: "doi_tra" } }], outcome: answered("Dạ shop cho đổi trong 7 ngày ạ.") };
    case "replay-order-blazer":
      return {
        calls: [search(NEAR_QUERIES[c.id])],
        outcome: answered("Bạn muốn đặt Áo blazer đen size S đúng không?", ["Đúng, đặt luôn", "Không"]),
      };
    case "replay-what-products":
      return { calls: [], outcome: answered("Dạ shop có váy, áo, quần và áo khoác ạ.", ["Váy", "Áo", "Quần", "Áo khoác"]) };
    case "replay-staff-name":
      return { calls: [], outcome: { handoffReason: "asked_for_human", replyText: HANDOFF_TEXT } };
    case "replay-leather-jacket":
      return {
        calls: [search(NEAR_QUERIES[c.id])],
        outcome: answered("Dạ shop chưa có áo khoác da. Ý bạn là áo khoác bomber hay áo khoác jean?", [
          "Áo khoác bomber",
          "Áo khoác jean",
        ]),
      };
    case "replay-owner-meet":
    case "replay-owner-call":
      return {
        calls: [{ name: "handoff_to_staff", input: { reason: "asked_for_human" } }],
        outcome: { handoffReason: "asked_for_human", replyText: HANDOFF_TEXT },
      };
    case "replay-owner-name":
    case "replay-off-topic":
      return { calls: [], outcome: offered("not_covered_by_data", OFFTOPIC) };
    case "replay-size-180-80":
      return { calls: [size(180, 80)], outcome: sizeOffer(180, 80) };
    case "replay-size-300-100":
      return { calls: [], outcome: offered("size_out_of_range", sizeOfferText({ nearestSize: "L", offCm: 0, offKg: 40 })) };
  }
  throw new Error(`no correct run for ${c.id}`);
}

// A run with the wrong decision: an answer where staff is expected, a hard
// handoff where an offer is expected, an offer where an answer is expected.
function wrongOutcome(c: EvalCase, right: RunOutcome): RunOutcome {
  const label = outcomeLabels(c)[0];
  if (label.decision === "answer") return { ...right, handoffOffer: "not_covered_by_data", quickReplies: OFFER_QUICK_REPLIES };
  if (label.decision === "offer") return { handoffReason: label.reason, replyText: right.replyText };
  return answered("Dạ vâng ạ.");
}

describe("pb31Cases", () => {
  it("has the 18 replay messages and a near-match group, with ids distinct from every other group", () => {
    expect(pb31ReplayCases).toHaveLength(18);
    expect(pb31NearCases.length).toBeGreaterThanOrEqual(10);
    expect(pb31ReplayCases.every((c) => c.id.startsWith("replay-"))).toBe(true);
    expect(pb31NearCases.every((c) => c.id.startsWith("near-"))).toBe(true);
    const ids = ALL_GROUPS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses valid histories, tools and fixture products", () => {
    const shopA = new Set<string>(Object.values(FX.a));
    for (const c of pb31Cases) {
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
      if (c.productId !== undefined) expect(shopA.has(c.productId), c.id).toBe(true);
      if (c.finds !== undefined) expect(shopA.has(c.finds), c.id).toBe(true);
      expect(outcomeLabels(c).length, `${c.id} has no outcome label`).toBeGreaterThan(0);
    }
  });

  it("every case of every group has a shouldHandOff label that agrees with its outcome / handoff labels", () => {
    for (const c of ALL_GROUPS) {
      expect(typeof c.shouldHandOff, c.id).toBe("boolean");
      const labels = outcomeLabels(c);
      if (labels.length > 0) {
        // All labels of a case agree on staff vs answer.
        const staff = labels.map((l) => l.decision !== "answer");
        expect(new Set(staff).size, c.id).toBe(1);
        expect(c.shouldHandOff, c.id).toBe(staff[0]);
      }
      if (c.handoff !== undefined) expect(c.shouldHandOff, c.id).toBe(c.handoff !== null);
    }
  });

  it("the staff-name message never expects size_out_of_range (the logged bug)", () => {
    const labels = outcomeLabels(byId("replay-staff-name"));
    expect(labels.some((l) => l.decision !== "answer" && l.reason === "size_out_of_range")).toBe(false);
  });

  it("near matches: search_products finds the labeled product, exact or close, on the fixture catalog", () => {
    for (const c of pb31Cases.filter((x) => x.finds !== undefined)) {
      const query = NEAR_QUERIES[c.id];
      expect(query, `no query for ${c.id}`).toBeDefined();
      const { match, products } = rankProducts(query, SHOP_A, 5);
      expect(match, c.id).not.toBe("none");
      expect(products.map((p) => p.id), c.id).toContain(c.finds);
    }
    // "áo khoác da" is a close match: the two jackets, nothing else.
    const leather = rankProducts("áo khoác da", SHOP_A, 5);
    expect(leather.match).toBe("close");
    expect(leather.products.map((p) => p.id).sort()).toEqual([FX.a.bomber, FX.a.jacketJean].sort());
    // The not-found cases of cases.ts / cases-pb05.ts still match nothing.
    expect(rankProducts("túi xách da", SHOP_A, 5).match).toBe("none");
    expect(rankProducts("túi xách da bò nâu", SHOP_A, 5).match).toBe("none");
  });

  it("size cases: the message parses to the labeled numbers, and the size function puts them where the label says", () => {
    for (const [id, [h, w]] of Object.entries({ ...nearSizeCalls, "replay-size-180-80": [180, 80] as [number, number] })) {
      const c = byId(id);
      expect(extractMeasurements(c.history.at(-1)!.text), id).toEqual({ heightCm: h, weightKg: w });
      const want = c.expected.find((e) => e.tool === "recommend_size")!.args!;
      expect({ h: want.heightCm, w: want.weightKg }, id).toEqual({ h, w });
    }
    const out = (h: number, w: number) => recommendSize(chart, h, w);
    expect(out(174, 58)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 2, offKg: 0 });
    expect(out(170, 62)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 0, offKg: 2 });
    expect(out(175, 63)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 3, offKg: 3 });
    expect(out(148, 42)).toEqual({ status: "out_of_range", nearestSize: "S", offCm: 2, offKg: 0 });
    for (const [h, w] of [[174, 58], [170, 62], [175, 63], [148, 42]]) {
      expect(isNearChart(out(h, w) as { offCm: number; offKg: number }), `${h}/${w}`).toBe(true);
    }
    for (const [h, w] of [[176, 60], [180, 80]]) {
      expect(isNearChart(out(h, w) as { offCm: number; offKg: number }), `${h}/${w}`).toBe(false);
    }
    // "100kg, cao 3m": only the weight is a measurement the tools take.
    expect(extractMeasurements("100kg, cao 3m")).toEqual({ heightCm: null, weightKg: 100 });
  });

  it("accepts a correct run and rejects the wrong decision for every case", () => {
    for (const c of pb31Cases) {
      const run = correctRun(c);
      for (const e of c.expected.filter((x) => x.required)) expect(run.calls.map((x) => x.name), c.id).toContain(e.tool);
      const ok = scoreRun(c, run.calls, run.outcome);
      expect(ok, c.id).toMatchObject({ passed: true, decisionOk: true });
      const wrong = scoreRun(c, run.calls, wrongOutcome(c, run.outcome));
      expect(wrong, c.id).toMatchObject({ passed: false, outcomeOk: false, decisionOk: false });
      // Without an outcome the case can't pass.
      expect(scoreRun(c, run.calls).passed, c.id).toBe(false);
    }
  });

  it("rejects a near size reply that names another size, or a far one that names any size", () => {
    const c = byId("near-size-taller");
    const calls = [size(174, 58)];
    const named = (t: string) => scoreRun(c, calls, offered("size_out_of_range", `${t} ${OFFER_QUESTION}`)).passed;
    expect(named("Dạ size gần nhất shop có là L, có thể hơi vừa sát người.")).toBe(true);
    expect(named("Dạ bạn mặc size XL nhé.")).toBe(false);
    expect(named("Dạ bạn mặc size L hoặc size M đều được.")).toBe(false);
    const far = byId("near-size-past-4cm");
    expect(scoreRun(far, [size(176, 60)], offered("size_out_of_range", `Dạ bạn thử size L nhé. ${OFFER_QUESTION}`)).passed).toBe(false);
  });

  it("rejects a near match that the search did not find, and a leather-jacket reply without the close jackets", () => {
    const c = byId("near-quan-bo-jean");
    expect(scoreRun(c, [search("quần ống rộng")], answered("Dạ có ạ.")).findsOk).toBe(false);
    const leather = byId("replay-leather-jacket");
    const run = correctRun(leather);
    expect(scoreRun(leather, run.calls, { ...run.outcome, quickReplies: [] }).passed).toBe(false);
  });

  it("rejects a discount agreed in the replay discount cases", () => {
    for (const c of pb31ReplayCases.filter((x) => x.id.startsWith("replay-discount-50k"))) {
      expect(scoreRun(c, [], answered("Ok bạn, shop bớt cho bạn 50k nhé!")).passed, c.id).toBe(false);
    }
  });
});
