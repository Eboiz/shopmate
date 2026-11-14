import { describe, expect, it } from "vitest";
import { recommendsSize, replyMatchesSize, sizeCorrection, sizeFallbackText, sizesInToolOutputs, type SizeAdvice } from "./size-postcheck";

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

  // Bug #10: every named size is in the allowed set {L, M, L}, yet the reply
  // recommends M instead of the advised L.
  const taller: SizeAdvice = { status: "ok", size: "L", sizeByHeight: "M", sizeByWeight: "L" };

  it("rejects a reply that recommends another size than the advice", () => {
    expect(replyMatchesSize("Size L không hợp bạn, hãy chọn size M nhé", taller)).toBe(false);
  });

  it("rejects a recommending verb naming a size other than the advice", () => {
    expect(replyMatchesSize("Dạ bạn nên chọn size M nhé, size L hơi rộng.", taller)).toBe(false);
  });

  it("rejects the advised size negated right after it", () => {
    expect(replyMatchesSize("Size L không hợp bạn đâu, shop chỉ còn L cho mẫu này thôi ạ.", taller)).toBe(false);
  });

  it("accepts the fallback reply for both branches", () => {
    const agrees: SizeAdvice = { status: "ok", size: "L", sizeByHeight: "L", sizeByWeight: "L" };
    expect(replyMatchesSize(sizeFallbackText(agrees), agrees)).toBe(true);
    expect(replyMatchesSize(sizeFallbackText(taller), taller)).toBe(true);
  });

  it("accepts the A1 explanation and a plain recommendation of the advised size", () => {
    expect(replyMatchesSize("theo chiều cao hợp size M, theo cân nặng hợp size L, nên bạn chọn size L", taller)).toBe(true);
    expect(replyMatchesSize("bạn mặc size L là vừa ạ", taller)).toBe(true);
  });

  // Follow-up #1: a bare two-digit number after a verb is a quantity, not a size.
  it("does not read a bare quantity after a verb as a size", () => {
    expect(replyMatchesSize("Shop đặt 10 cái cho bạn nhé, bạn mặc size L là vừa", taller)).toBe(true);
    const jeans: SizeAdvice = { status: "ok", size: "28", sizeByHeight: "27", sizeByWeight: "28" };
    expect(replyMatchesSize("Dạ shop đặt 10 cái cho bạn nhé, bạn mặc size 28 ạ", jeans)).toBe(true);
  });

  it("still counts a number as a size when a size word names it", () => {
    expect(replyMatchesSize("Dạ bạn đặt size 10 nhé", taller)).toBe(false);
  });

  // Follow-up #2: a clause starting with "nếu" is a conditional alternative.
  it("accepts a conditional alternative clause", () => {
    expect(replyMatchesSize("Bạn mặc size L là vừa, nếu thích rộng thì lấy size M", taller)).toBe(true);
  });

  it("still rejects an unknown size in a conditional clause", () => {
    expect(replyMatchesSize("nếu thích rộng thì lấy size XL", taller)).toBe(false);
    expect(replyMatchesSize("Bạn mặc size L là vừa, nếu thích rộng thì lấy size XL", taller)).toBe(false);
  });

  it("rejects 'nên dùng' another size and an attributed size swapped in for the advice", () => {
    expect(replyMatchesSize("Size L theo bảng, nhưng mình khuyên bạn nên dùng size M", taller)).toBe(false);
    expect(replyMatchesSize("Theo chiều cao bạn chọn size M thay cho size L", taller)).toBe(false);
  });

  it("accepts rejecting another size and 'không bị chật' about the advised one", () => {
    expect(replyMatchesSize("Bạn không nên chọn size M, cứ mặc size L nhé", taller)).toBe(true);
    expect(replyMatchesSize("Bạn mặc size L sẽ không bị chật", taller)).toBe(true);
    expect(replyMatchesSize("Size L hơi chật, size M sẽ hợp với bạn hơn", taller)).toBe(false);
  });

  it("handles 'nên dùng' under negation and a 'thay vì' before the verb", () => {
    expect(replyMatchesSize("Bạn không nên dùng size M, cứ mặc size L nhé", taller)).toBe(true);
    expect(replyMatchesSize("Bạn không nên dùng size L nhé", taller)).toBe(false);
    expect(replyMatchesSize("Theo chiều cao thì thay vì size L bạn nên dùng size M", taller)).toBe(false);
  });

  // Follow-up #3: negated advice reads as rejecting it (heuristic).
  it.each([
    "Đừng chọn size L nhé, bạn lấy size M",
    "Không nên mặc size L",
    "Đừng chọn size L nhé",
  ])("rejects a negation before the verb naming the advised size: %j", (text) => {
    expect(replyMatchesSize(text, taller)).toBe(false);
  });

  it("rejects the advised size called too tight or too loose", () => {
    expect(replyMatchesSize("Size L hơi chật, size M sẽ hợp với bạn hơn", taller)).toBe(false);
    expect(replyMatchesSize("Dạ bạn mặc size L nhé, nhưng size L hơi chật đấy ạ", taller)).toBe(false);
  });

  it("accepts a positive description of the advised size", () => {
    expect(replyMatchesSize("Size L rộng rãi thoải mái, bạn mặc size L nhé", taller)).toBe(true);
  });
});

describe("recommendsSize", () => {
  it.each(["Bạn mặc size M là vừa", "Dạ chọn size L nhé", "Size M hợp với bạn", "nên dùng size S"])("recommends: %j", (t) => {
    expect(recommendsSize(t)).toBe(true);
  });
  it.each(["Shop còn size M và L ạ", "Bạn đặt 10 cái nhé", "Bạn không nên chọn size M khi chưa đo", "Cho mình xin chiều cao nhé"])("does not: %j", (t) => {
    expect(recommendsSize(t)).toBe(false);
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
