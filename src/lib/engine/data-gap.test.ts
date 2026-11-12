import { describe, expect, it } from "vitest";
import type { ToolCallLog } from "@/contract";
import { gapOfTurn, type GapTurn } from "./data-gap";

const policy = (error?: string): ToolCallLog => ({ name: "get_policy", input: { kind: "giao_hang" }, output: error ? undefined : { kind: "giao_hang", content: null }, ...(error ? { error } : {}) });
const search = (ids: string[]): ToolCallLog => ({
  name: "search_products",
  input: { query: "áo", limit: 5 },
  output: { match: "exact", products: ids.map((productId) => ({ productId })) },
});
const size: ToolCallLog = { name: "recommend_size", input: {}, output: { status: "no_chart" } };

const turn = (over: Partial<GapTurn>): GapTurn => ({
  mode: "customer",
  question: "Shop có cho kiểm hàng không?",
  handoff: null,
  offerMade: null,
  offerAnswer: null,
  productMissedTwice: false,
  logs: [],
  productId: null,
  intent: null,
  ...over,
});

describe("gapOfTurn (PB-35a: which turns record a question the AI couldn't answer)", () => {
  it("records an offer of staff after reading a policy", () => {
    expect(gapOfTurn(turn({ offerMade: "policy_not_covered", logs: [policy()] }))).toEqual({
      reason: "policy_not_covered",
      question: "Shop có cho kiểm hàng không?",
      productId: null,
    });
  });

  it("records not_covered_by_data about a product the shopper is looking at", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", logs: [search(["p1"])], productId: null }))).toEqual({
      reason: "not_covered_by_data",
      question: "Shop có cho kiểm hàng không?",
      productId: "p1",
    });
  });

  it("records a detail missing from the description of the product on screen (router)", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", intent: "product_detail", productId: "p9" }))?.productId).toBe("p9");
  });

  it("never records an off-topic question, even with a product on screen", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", intent: "off_topic", productId: "p9" }))).toBeNull();
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", intent: null, productId: "p9" }))).toBeNull();
  });

  it("a policy question is not about a product", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", logs: [policy()], productId: "p9" }))?.productId).toBeNull();
  });

  it("does not guess a product when the search returned several", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", logs: [search(["p1", "p2"])] }))?.productId).toBeNull();
  });

  it("skips not_covered_by_data with no data read (off-topic)", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", logs: [] }))).toBeNull();
  });

  it("skips a failed get_policy call", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", logs: [policy("db down")] }))).toBeNull();
  });

  it("never records a size turn: sizes come only from the size chart", () => {
    expect(gapOfTurn(turn({ offerMade: "not_covered_by_data", logs: [search(["p1"]), size] }))).toBeNull();
    expect(gapOfTurn(turn({ offerMade: "size_out_of_range", logs: [size] }))).toBeNull();
  });

  it("does not record the shopper's yes or no to an offer", () => {
    expect(gapOfTurn(turn({ question: "Có, gặp nhân viên", handoff: "policy_not_covered", offerAnswer: "yes", logs: [policy()] }))).toBeNull();
    expect(gapOfTurn(turn({ question: "Không cần", offerAnswer: "no" }))).toBeNull();
  });

  it("skips other handoffs (complaint, human, misunderstood, technical)", () => {
    for (const handoff of ["complaint", "asked_for_human", "misunderstood_twice", "postcheck_failed", "too_many_tool_calls"] as const) {
      expect(gapOfTurn(turn({ handoff, logs: [policy()] }))).toBeNull();
    }
  });

  it("records product_not_found when the product search missed twice (PB-36)", () => {
    expect(gapOfTurn(turn({ question: "có áo da không", handoff: "misunderstood_twice", productMissedTwice: true }))?.reason).toBe("product_not_found");
    expect(gapOfTurn(turn({ question: "có áo da không", handoff: "product_not_found" }))?.reason).toBe("product_not_found");
  });

  it("only records customer turns, and caps the question at 500 characters", () => {
    expect(gapOfTurn(turn({ mode: "staff_draft", offerMade: "policy_not_covered", logs: [policy()] }))).toBeNull();
    expect(gapOfTurn(turn({ question: "a".repeat(800), offerMade: "policy_not_covered", logs: [policy()] }))?.question).toHaveLength(500);
    expect(gapOfTurn(turn({ question: "   ", offerMade: "policy_not_covered", logs: [policy()] }))).toBeNull();
  });
});
