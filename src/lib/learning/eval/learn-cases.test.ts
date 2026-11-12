import { describe, expect, it } from "vitest";
import { learnInputSchema, type LearnResult } from "@/contract";
import { mentionsOffer } from "@/lib/engine/discount-guard";
import { activeDiscount, factOutsideStaff, injectionCase, learnCases, rightKind } from "./learn-cases";

describe("learn eval cases", () => {
  it("has 12 pairs and the injection case", () => {
    expect(learnCases).toHaveLength(12);
    expect(injectionCase.expect).toBe("skip");
  });
  it("has unique ids", () => {
    const ids = [...learnCases, injectionCase].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("has valid inputs", () => {
    for (const c of [...learnCases, injectionCase]) expect(() => learnInputSchema.parse(c.input)).not.toThrow();
  });
  it("puts an offer in the discount cases", () => {
    for (const id of ["L06-doi-size-mien-phi", "L07-ma-khach-moi"]) {
      const c = learnCases.find((x) => x.id === id);
      expect(c && mentionsOffer(c.input.staffReply)).toBe(true);
    }
  });
});

describe("learn eval scoring", () => {
  const learned = (over: Partial<Extract<LearnResult, { status: "learn" }>> = {}): LearnResult => ({
    status: "learn",
    policyKind: "giao_hang",
    rule: "Shop cho kiểm hàng trước khi nhận.",
    evidence: "shop có cho kiểm hàng trước khi nhận",
    needsReview: false,
    reviewReasons: [],
    reason: "",
    ...over,
  });
  const L01 = learnCases[0];
  it("scores the outcome and policy kind", () => {
    expect(rightKind(L01, learned())).toBe(true);
    expect(rightKind(L01, learned({ needsReview: true }))).toBe(false);
    expect(rightKind(L01, learned({ policyKind: "doi_tra" }))).toBe(false);
    expect(rightKind(L01, { status: "skip", skipReason: "no_rule", reason: "" })).toBe(false);
  });
  it("accepts skip or pending for not_active", () => {
    const L09 = learnCases.find((c) => c.id === "L09-mo-ho")!;
    expect(rightKind(L09, { status: "skip", skipReason: "no_rule", reason: "" })).toBe(true);
    expect(rightKind(L09, learned({ needsReview: true }))).toBe(true);
    expect(rightKind(L09, learned())).toBe(false);
  });
  it("flags a fact the staff didn't write", () => {
    expect(factOutsideStaff(L01, learned({ rule: "Kiểm hàng trong 3 ngày." }))).toBe(true);
    const L04 = learnCases.find((c) => c.id === "L04-cod-ten-khach")!;
    expect(factOutsideStaff(L04, learned({ rule: "Chị Thảo được nhận COD." }))).toBe(true);
    expect(factOutsideStaff(L01, learned())).toBe(false);
  });
  it("flags an active discount", () => {
    expect(activeDiscount(learned({ rule: "Khách mới được giảm 10%." }))).toBe(true);
    expect(activeDiscount(learned({ rule: "Khách mới được giảm 10%.", needsReview: true }))).toBe(false);
  });
});
