import { describe, expect, it } from "vitest";
import { LOW_STOCK, summarizeStock } from "./stock";

describe("summarizeStock", () => {
  it("adds up the rows and counts the ones running out", () => {
    expect(summarizeStock([{ stock: 10 }, { stock: LOW_STOCK }, { stock: 0 }])).toEqual({ total: 13, low: 2, out: false });
  });

  it("says out of stock only when every row is empty", () => {
    expect(summarizeStock([{ stock: 0 }, { stock: 0 }])).toEqual({ total: 0, low: 2, out: true });
  });

  it("does not call a product without rows out of stock", () => {
    expect(summarizeStock([])).toEqual({ total: 0, low: 0, out: false });
  });
});
