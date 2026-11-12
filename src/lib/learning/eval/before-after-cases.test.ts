import { describe, expect, it } from "vitest";
import { learnInputSchema } from "@/contract";
import { appendRule, beforeAfterTopics, judgeAfter } from "./before-after-cases";

describe("before/after eval cases", () => {
  it("has 4 topics and 8 questions with unique ids", () => {
    expect(beforeAfterTopics).toHaveLength(4);
    const ids = beforeAfterTopics.flatMap((t) => t.questions.map((q) => q.id));
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });
  it("has valid staff inputs", () => {
    for (const t of beforeAfterTopics) expect(() => learnInputSchema.parse(t.staff)).not.toThrow();
  });
});

describe("appendRule", () => {
  it("starts an empty policy with the rule", () => {
    expect(appendRule(null, "Shop cho kiểm hàng.")).toBe("Shop cho kiểm hàng.");
    expect(appendRule("   ", "Shop cho kiểm hàng.")).toBe("Shop cho kiểm hàng.");
  });
  it("adds the rule on a new line", () => {
    expect(appendRule("Đổi trong 7 ngày", "Hàng sale không đổi.")).toBe("Đổi trong 7 ngày\nHàng sale không đổi.");
  });
});

describe("judgeAfter", () => {
  const q = { id: "x", text: "Kiểm hàng được không?", mustSay: /kiem/ };
  const ok = { calledGetPolicy: true, handoffReason: null, reply: "Dạ shop có cho kiểm hàng ạ" };
  it("passes an answer from the policy", () => {
    expect(judgeAfter(q, ok, ["Shop cho kiểm hàng."]).passed).toBe(true);
  });
  it("fails without get_policy, on a handoff, or without the fact", () => {
    expect(judgeAfter(q, { ...ok, calledGetPolicy: false }, ["x"]).passed).toBe(false);
    expect(judgeAfter(q, { ...ok, handoffReason: "policy_not_covered" }, ["x"]).passed).toBe(false);
    expect(judgeAfter(q, { ...ok, reply: "Dạ có ạ" }, ["x"]).passed).toBe(false);
  });
  it("fails an amount the policy doesn't hold", () => {
    const r = judgeAfter(q, { ...ok, reply: "Dạ kiểm hàng phí 20.000đ ạ" }, ["Shop cho kiểm hàng."]);
    expect(r.passed).toBe(false);
    expect(r.unsupportedAmounts).toEqual(["20000"]);
  });
});

describe("judgeAfter review fixes", () => {
  it("fails an answer that flips the learned fact", () => {
    const q = beforeAfterTopics[0].questions[0];
    const run = { calledGetPolicy: true, handoffReason: null, reply: "Dạ shop không cho kiểm hàng ạ" };
    expect(judgeAfter(q, run, ["Shop cho kiểm hàng trước khi nhận."]).passed).toBe(false);
  });
});
