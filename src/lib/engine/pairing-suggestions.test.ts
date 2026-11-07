import { describe, expect, it } from "vitest";
import type { ProductCard, ToolOutput } from "@/contract";
import { isMatchingQuestion, knownShopperSize, matchingReply, MAX_MATCHING_SUGGESTIONS } from "./pairing-suggestions";

type Pairing = ToolOutput<"get_pairings">["pairings"][number];
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pairing = (n: number, sizesInStock = ["S", "M"], reason = `Lý do Hạnh viết ${n}`): Pairing => ({
  productId: id(n), name: `Món ${n}`, price: 100000 + n, imageUrl: null, reason, sizesInStock,
});
const card = (n: number, sizesInStock = ["S", "M"]): ProductCard => ({
  productId: id(n), name: `Món ${n}`, price: 100000 + n, imageUrl: null, sizesInStock,
});

describe("matching item suggestions", () => {
  it("uses only declared pairings, at most two, with Hạnh's exact reasons", () => {
    const reply = matchingReply([pairing(1), pairing(2), pairing(3)], [card(1), card(2), card(3), card(9)]);
    expect(reply.products.map((item) => item.productId)).toEqual([id(1), id(2)]);
    expect(reply.products).toHaveLength(MAX_MATCHING_SUGGESTIONS);
    expect(reply.text).toContain("Lý do Hạnh viết 1");
    expect(reply.text).toContain("Lý do Hạnh viết 2");
    expect(reply.text).not.toContain("Món 3");
    expect(reply.text).not.toContain("Món 9");
  });

  it("drops sold-out items and sizes that disappeared after the tool call", () => {
    const reply = matchingReply(
      [pairing(1, ["M"]), pairing(2, ["M"]), pairing(3, ["M"])],
      [card(1, []), card(2, ["S"]), card(3, ["m", "L"])],
    );
    expect(reply.products).toEqual([{ ...card(3, ["m", "L"]), sizesInStock: ["m"] }]);
    expect(reply.text).toContain("Lý do Hạnh viết 3");
  });

  it("never invents a suggestion when no pairing is declared or in stock", () => {
    expect(matchingReply([], [card(9)]).products).toEqual([]);
    expect(matchingReply([pairing(1, ["M"])], [card(1, ["S"])]).products).toEqual([]);
  });

  it("deduplicates a pairing returned by multiple tool calls", () => {
    const reply = matchingReply([pairing(1), pairing(1), pairing(2)], [card(1), card(2)]);
    expect(reply.products.map((item) => item.productId)).toEqual([id(1), id(2)]);
  });

  it("skips a reason that cannot fit the PB-00 reply contract", () => {
    const reply = matchingReply([pairing(1, ["M"], "x".repeat(1000)), pairing(2)], [card(1), card(2)]);
    expect(reply.products.map((item) => item.productId)).toEqual([id(2)]);
    expect(reply.text.length).toBeLessThanOrEqual(1000);
  });
});

describe("known shopper size", () => {
  it("uses the latest explicit shopper size, ignoring the model and staff", () => {
    expect(knownShopperSize([
      { sender: "shopper", text: "Mình mặc size M" },
      { sender: "staff", text: "Thử size S" },
      { sender: "shopper", text: "À mình mặc cỡ L" },
    ])).toBe("L");
  });

  it("does not guess a size when none is stated", () => {
    expect(knownShopperSize([{ sender: "shopper", text: "Gợi ý đồ phối cho váy này" }])).toBeNull();
  });
});

describe("matching question detection", () => {
  it("recognizes common matching questions", () => {
    for (const text of ["Áo nào phối với váy này?", "Món gì hợp với áo này?", "Gợi ý đồ đi cùng", "Mix set này sao?"]) {
      expect(isMatchingQuestion([{ sender: "shopper", text }])).toBe(true);
    }
  });

  it("leaves a stock question alone", () => {
    expect(isMatchingQuestion([{ sender: "shopper", text: "Váy này còn size M không?" }])).toBe(false);
  });
});
