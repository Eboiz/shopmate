import { describe, expect, it } from "vitest";
import { replyMatchesSize, sizeCorrection, sizeFallbackText, sizesInToolOutputs, type SizeAdvice } from "./size-postcheck";

const same: SizeAdvice = { status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" };
const disagree: SizeAdvice = { status: "ok", size: "M", sizeByHeight: "S", sizeByWeight: "M" };

describe("replyMatchesSize", () => {
  it.each([
    "Dạ bạn mặc size M là vừa ạ.",
    "Dạ size m nhé",
    "Bạn lấy cỡ M nha",
    "Theo bảng size, M là vừa với bạn ạ",
    "Dạ size M ạ, bạn chọn màu nào?",
  ])("accepts %j", (text) => {
    expect(replyMatchesSize(text, same)).toBe(true);
  });

  it("accepts the A1 explanation naming both sizes", () => {
    expect(
      replyMatchesSize("Theo chiều cao bạn mặc size S, theo cân nặng size M, nên shop khuyên size M ạ.", disagree),
    ).toBe(true);
  });

  it.each([
    "Dạ bạn mặc size L nhé",
    "Dạ bạn mặc size XL là vừa",
    "Dạ size M hoặc size L đều được ạ",
    "Dạ bạn chọn màu nào ạ?",
    "Dạ size nào cũng được",
  ])("rejects %j", (text) => {
    expect(replyMatchesSize(text, same)).toBe(false);
  });

  it("rejects the smaller size when height and weight disagree", () => {
    expect(replyMatchesSize("Dạ bạn mặc size S nhé", disagree)).toBe(false);
  });

  it("allows sizes another tool returned this turn", () => {
    const stock = sizesInToolOutputs([{ variants: [{ size: "L", color: "đen", stock: 1 }] }]);
    expect(replyMatchesSize("Dạ size M ạ, váy còn size L màu đen", same, stock)).toBe(true);
    expect(replyMatchesSize("Dạ size M ạ, váy còn size XL", same, stock)).toBe(false);
  });

  it("does not read words or units as sizes", () => {
    expect(replyMatchesSize("Dạ với 160cm và 50kg, size phù hợp là M, size lớn hơn sẽ rộng.", same)).toBe(true);
  });

  it("works with numeric sizes", () => {
    const jeans: SizeAdvice = { status: "ok", size: "28", sizeByHeight: "27", sizeByWeight: "28" };
    expect(replyMatchesSize("Dạ bạn mặc size 28 ạ (theo chiều cao là 27)", jeans)).toBe(true);
    expect(replyMatchesSize("Dạ bạn mặc size 29 ạ", jeans)).toBe(false);
  });
});

describe("sizesInToolOutputs", () => {
  it("collects size, sizes and sizesInStock from any tool output", () => {
    expect(
      sizesInToolOutputs([
        { variants: [{ size: "M" }, { size: "L" }] },
        { products: [{ sizes: ["S", "XL"] }] },
        { pairings: [{ sizesInStock: ["28"] }] },
        { lines: [{ name: "size XXL" }] },
      ]),
    ).toEqual(new Set(["m", "l", "s", "xl", "28"]));
  });
});

describe("sizeCorrection / sizeFallbackText", () => {
  it("spells out the tool's size", () => {
    expect(sizeCorrection(disagree)).toContain("size M");
  });

  it("says just the size when height and weight agree", () => {
    expect(sizeFallbackText(same)).toBe("Dạ, theo bảng size của shop thì bạn mặc size M là vừa ạ.");
  });

  it("says why the larger size when they disagree (A1)", () => {
    const text = sizeFallbackText(disagree);
    expect(text).toContain("chiều cao của bạn hợp size S");
    expect(text).toContain("cân nặng hợp size M");
    expect(text).toContain("size lớn hơn là M");
  });
});
