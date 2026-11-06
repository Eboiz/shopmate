import { describe, expect, it } from "vitest";
import { countDuplicateCalls, toolOutcome } from "./metrics";

describe("toolOutcome", () => {
  it("is ok for a successful run", () => {
    expect(toolOutcome({ log: null, content: "{}", isError: false })).toBe("ok");
  });

  it("is the error code otherwise", () => {
    expect(toolOutcome({ log: null, content: '{"error":"tool_not_allowed"}', isError: true })).toBe("tool_not_allowed");
    expect(toolOutcome({ log: null, content: '{"error":"invalid_input","details":"…"}', isError: true })).toBe(
      "invalid_input",
    );
  });
});

describe("countDuplicateCalls", () => {
  it("compares inputs with sorted keys and doesn't count the first call", () => {
    expect(
      countDuplicateCalls([
        { name: "get_stock", input: { productId: "p", size: "M" } },
        { name: "get_stock", input: { size: "M", productId: "p" } },
      ]),
    ).toBe(1);
    expect(
      countDuplicateCalls([
        { name: "get_policy", input: { kind: "doi_tra" } },
        { name: "get_policy", input: { kind: "giao_hang" } },
        { name: "get_stock", input: { kind: "doi_tra" } },
      ]),
    ).toBe(0);
    expect(countDuplicateCalls([{ name: "a", input: {} }, { name: "a", input: {} }, { name: "a", input: {} }])).toBe(2);
    expect(countDuplicateCalls([])).toBe(0);
  });
});
