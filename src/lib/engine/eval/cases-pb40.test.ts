import { describe, expect, it } from "vitest";
import type { ProductCard } from "@/contract";
import { FX } from "../test/two-shops";
import { pb40Cases } from "./cases-pb40";
import { scoreRun, type RunOutcome } from "./score";

const byId = (id: string) => pb40Cases.find((c) => c.id === id)!;
const card = (productId: string, name: string, price: number): ProductCard => ({ productId, name, price, imageUrl: null, sizesInStock: ["M"] });
const SHIRT = card(FX.a.ao03, "Áo sơ mi trắng", 250000);
const TROUSERS = card(FX.a.quan05, "Quần ống rộng", 300000);
const DRESS = card(FX.a.vay01, "Váy suông linen", 350000);

describe("pb40Cases", () => {
  it("ids are unique and every case has a label to check", () => {
    expect(new Set(pb40Cases.map((c) => c.id)).size).toBe(pb40Cases.length);
    for (const c of pb40Cases) expect(c.reply ?? c.products ?? c.quickReplies).toBeDefined();
  });

  it("BOT-02: a sold-out answer without another size passes; buttons pushing M fail", () => {
    const c = byId("pb40-advised-size-sold-out");
    const calls = [{ name: "get_stock", input: { productId: FX.a.vay01, size: "L", color: "be" } }];
    const ok: RunOutcome = { handoffReason: null, replyText: "Dạ váy màu be size L đã hết hàng ạ.", quickReplies: [] };
    expect(scoreRun(c, calls, ok).passed).toBe(true);
    const bad: RunOutcome = { ...ok, quickReplies: ["M be", "Size M đen"] };
    expect(scoreRun(c, calls, bad)).toMatchObject({ quickRepliesOk: false, passed: false });
  });

  it("BOT-04: two cards within the budget pass; a dress, or a third card, fails", () => {
    const c = byId("pb40-staff-budget-no-skirt");
    const ok: RunOutcome = { handoffReason: null, replyText: "Gợi ý áo sơ mi trắng và quần ống rộng.", products: [SHIRT, TROUSERS] };
    expect(scoreRun(c, [], ok).passed).toBe(true);
    expect(scoreRun(c, [], { ...ok, products: [] }).passed).toBe(true);
    expect(scoreRun(c, [], { ...ok, products: [SHIRT, DRESS] })).toMatchObject({ productsOk: false, passed: false });
    expect(scoreRun(c, [], { ...ok, products: [SHIRT, TROUSERS, SHIRT] }).productsOk).toBe(false);
  });
});
