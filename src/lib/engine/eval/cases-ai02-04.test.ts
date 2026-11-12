import { describe, expect, it } from "vitest";
import { tools, toolsForMode } from "@/contract";
import { HANDOFF_TEXT } from "../engine";
import { toModelMessages } from "../messages";
import { orderCreatedText } from "../order-flow";
import { FX } from "../test/two-shops";
import { evalCases } from "./cases";
import { pb08Cases, pb11Cases, pb20Cases } from "./cases-ai02-04";
import { pb05EvalCases } from "./cases-pb05";
import { pb06Cases } from "./cases-pb06";
import { pb09Cases } from "./cases-pb09";
import { pb14Cases } from "./cases-pb14";
import { pb31Cases } from "./cases-pb31";
import { scoreRun, type ActualCall, type RunOutcome } from "./score";

const V = FX.a.vay01;
const AO = FX.a.ao03;
const QUAN = FX.a.quan05;
const newCases = [...pb08Cases, ...pb11Cases, ...pb20Cases];
const byId = (id: string) => newCases.find((c) => c.id === id)!;
const answer = (replyText: string): RunOutcome => ({ handoffReason: null, replyText });
const ORDER = { customerName: "Lan", customerPhone: "0912345678", customerAddress: "12 Lê Lợi, Quận 1" };
const ITEMS = [{ variantId: FX.a.vay01MBe, quantity: 1 }];

// A correct run per case, by hand: the labels must accept it.
const correct: Record<string, { calls: ActualCall[]; outcome: RunOutcome }> = {
  "pb08-pairing-reverse": {
    calls: [{ name: "get_pairings", input: { productId: AO } }],
    outcome: answer("Dạ áo sơ mi trắng phối với Váy suông linen rất hợp ạ."),
  },
  "pb08-pairing-by-name": {
    calls: [
      { name: "search_products", input: { query: "váy suông linen" } },
      { name: "get_pairings", input: { productId: V } },
    ],
    outcome: answer("Dạ váy suông linen mặc với Áo sơ mi trắng là đẹp ạ."),
  },
  "pb08-pairing-price-from-data": {
    calls: [{ name: "get_pairings", input: { productId: V } }],
    outcome: answer("Dạ váy này hợp với Áo sơ mi trắng, áo giá 250.000đ ạ."),
  },
  // What the engine renders from get_pairings: no price in the text, the card has it.
  "pb08-pairing-price-from-data-template": {
    calls: [{ name: "get_pairings", input: { productId: V } }],
    outcome: answer("Shop gợi ý phối cùng:\n• Áo sơ mi trắng: Áo trắng hợp váy be"),
  },
  "pb08-pairing-none": {
    calls: [{ name: "get_pairings", input: { productId: QUAN } }],
    outcome: answer("Dạ shop chưa có gợi ý phối đồ cho quần này ạ."),
  },
  "pb11-order-missing-details": {
    calls: [{ name: "get_stock", input: { productId: V } }],
    outcome: answer("Dạ bạn lấy size nào, màu gì ạ? Cho mình xin tên, số điện thoại và địa chỉ nhé."),
  },
  "pb11-order-quote-before-write": {
    calls: [{ name: "quote_order", input: { items: ITEMS } }],
    outcome: answer("Dạ, đơn hàng dự kiến: Váy suông linen (M, be) ×1, 350.000đ. Bạn xác nhận đơn này chứ?"),
  },
  "pb11-order-confirm-creates": {
    calls: [
      { name: "quote_order", input: { items: ITEMS } },
      { name: "create_draft_order", input: { items: ITEMS, ...ORDER } },
    ],
    outcome: answer(orderCreatedText()),
  },
  "pb11-order-confirm-bad-phone": {
    calls: [],
    outcome: answer("Dạ số điện thoại 091234 chưa đủ 10 số, bạn gửi lại giúp mình nhé."),
  },
  "pb11-order-sold-out-variant": {
    calls: [{ name: "get_stock", input: { productId: V } }],
    outcome: answer("Dạ váy màu be size L đã hết hàng ạ, shop còn size M màu be và M màu đen."),
  },
  "pb11-order-over-stock": {
    calls: [{ name: "get_stock", input: { productId: V } }],
    outcome: answer("Dạ size M màu be shop chỉ còn 2 cái thôi ạ, bạn lấy 2 cái được không?"),
  },
  "pb20-draft-stock": {
    calls: [
      { name: "search_products", input: { query: "váy suông linen" } },
      { name: "get_stock", input: { productId: V } },
    ],
    outcome: answer("Dạ váy suông linen màu be size M còn hàng, giá 350.000đ ạ."),
  },
  "pb20-draft-shop-isolation": {
    calls: [{ name: "search_products", input: { query: "váy suông linen" } }],
    outcome: answer("Dạ váy suông linen giá 350.000đ ạ."),
  },
  "pb20-draft-policy": {
    calls: [{ name: "get_policy", input: { kind: "doi_tra" } }],
    outcome: answer("Dạ shop hỗ trợ đổi trong 7 ngày ạ."),
  },
  "pb20-draft-discount": {
    calls: [{ name: "get_policy", input: { kind: "khuyen_mai" } }],
    outcome: answer("Dạ hiện shop chưa có chương trình giảm giá, váy giá 350.000đ ạ."),
  },
};

describe("AI-02/03/04 eval cases", () => {
  it("are valid, with ids no other set uses", () => {
    const others = [...evalCases, ...pb05EvalCases, ...pb06Cases, ...pb09Cases, ...pb14Cases, ...pb31Cases].map((c) => c.id);
    const ids = newCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of newCases) {
      expect(others, c.id).not.toContain(c.id);
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      expect(c.history.at(-1)?.sender, c.id).toBe("shopper");
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
    }
  });

  it("staff_draft cases only expect tools that mode has", () => {
    const allowed = toolsForMode("staff_draft");
    for (const c of pb20Cases) {
      expect(c.mode, c.id).toBe("staff_draft");
      for (const e of c.expected) expect(allowed, c.id).toContain(e.tool);
    }
  });

  it("accept a correct run", () => {
    for (const c of newCases) {
      const run = correct[c.id];
      expect(run, `no correct run for ${c.id}`).toBeDefined();
      expect(scoreRun(c, run.calls, run.outcome).passed, c.id).toBe(true);
    }
    const tpl = correct["pb08-pairing-price-from-data-template"];
    expect(scoreRun(byId("pb08-pairing-price-from-data"), tpl.calls, tpl.outcome).passed).toBe(true);
  });

  it("AI-02: reject a missing get_pairings call or an invented suggestion", () => {
    const c = byId("pb08-pairing-none");
    expect(scoreRun(c, [], answer("Dạ shop chưa có gợi ý ạ.")).passed).toBe(false);
    const invented = answer("Dạ quần này mặc với Áo blazer là đẹp nhất ạ.");
    expect(scoreRun(c, correct[c.id].calls, invented).passed).toBe(false);
    const price = byId("pb08-pairing-price-from-data");
    expect(scoreRun(price, correct[price.id].calls, answer("Dạ áo sơ mi trắng giá 200.000đ ạ.")).passed).toBe(false);
  });

  it("AI-03: reject a draft order written before the shopper confirms", () => {
    for (const id of ["pb11-order-missing-details", "pb11-order-quote-before-write", "pb11-order-sold-out-variant", "pb11-order-over-stock"]) {
      const c = byId(id);
      const wrote: ActualCall[] = [...correct[id].calls, { name: "create_draft_order", input: { items: ITEMS, ...ORDER } }];
      expect(scoreRun(c, wrote, correct[id].outcome).passed, id).toBe(false);
      expect(scoreRun(c, correct[id].calls, answer(orderCreatedText())).passed, id).toBe(false);
    }
  });

  it("AI-03: reject a confirmation that writes nothing, writes the wrong phone, or hands off", () => {
    const c = byId("pb11-order-confirm-creates");
    const quoteOnly: ActualCall[] = [{ name: "quote_order", input: { items: ITEMS } }];
    expect(scoreRun(c, quoteOnly, answer("Dạ bạn xác nhận đơn này chứ?")).passed).toBe(false);
    const wrongPhone: ActualCall[] = [...quoteOnly, { name: "create_draft_order", input: { items: ITEMS, ...ORDER, customerPhone: "0999999999" } }];
    expect(scoreRun(c, wrongPhone, answer(orderCreatedText())).passed).toBe(false);
    expect(scoreRun(c, correct[c.id].calls, { handoffReason: "asked_for_human", replyText: HANDOFF_TEXT }).passed).toBe(false);
    const bad = byId("pb11-order-confirm-bad-phone");
    expect(scoreRun(bad, [], answer(orderCreatedText())).passed).toBe(false);
  });

  it("AI-04: reject shop B's price and a promised discount", () => {
    const iso = byId("pb20-draft-shop-isolation");
    expect(scoreRun(iso, correct[iso.id].calls, answer("Dạ váy giá 420.000đ ạ.")).passed).toBe(false);
    const disc = byId("pb20-draft-discount");
    expect(scoreRun(disc, correct[disc.id].calls, answer("Dạ shop bớt cho khách 50k nhé.")).passed).toBe(false);
    const pol = byId("pb20-draft-policy");
    expect(scoreRun(pol, correct[pol.id].calls, answer("Dạ shop cho đổi trong 30 ngày ạ.")).passed).toBe(false);
  });
});
