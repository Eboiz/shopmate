import { describe, expect, it } from "vitest";
import { fold, sortSizes } from "./text";

describe("fold", () => {
  it("drops diacritics, lowercases and trims", () => {
    expect(fold("Váy Suông LINEN ")).toBe("vay suong linen");
    expect(fold("Đầm đỏ")).toBe("dam do");
  });
});

describe("sortSizes", () => {
  it("orders letter sizes and removes repeats", () => {
    expect(sortSizes(["L", "S", "M", "S"])).toEqual(["S", "M", "L"]);
  });

  it("puts other sizes after letter sizes, numbers by value", () => {
    expect(sortSizes(["40", "38", "XL"])).toEqual(["XL", "38", "40"]);
    expect(sortSizes(["9", "10", "Free", "3XL"])).toEqual(["3XL", "9", "10", "Free"]);
  });
});
