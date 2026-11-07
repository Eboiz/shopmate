import { describe, expect, it } from "vitest";
import { compareSizes } from "./size-order";

describe("compareSizes", () => {
  it("orders letter sizes from small to large", () => {
    expect(["XL", "L", "S", "M"].sort(compareSizes)).toEqual(["S", "M", "L", "XL"]);
  });

  it("ignores case and spaces", () => {
    expect(["l", " s "].sort(compareSizes)).toEqual([" s ", "l"]);
  });

  it("orders number sizes naturally, after letter sizes", () => {
    expect(["40", "M", "38", "Free size", "9"].sort(compareSizes)).toEqual([
      "M",
      "9",
      "38",
      "40",
      "Free size",
    ]);
  });
});
