import { describe, expect, it } from "vitest";
import { asksOtherColors, missedMentions, mustMentionNote, oneSizeUp, sizeNotSold, sizesNamedIn } from "./size-request";

describe("PB-45: sizes the shopper names", () => {
  it("finds a size after a size word, or a bare XXL-type size", () => {
    expect(sizesNamedIn("mình cao 1m58 nặng 50kg nhưng muốn mặc size XXL cho rộng như cái mền được không?")).toEqual(["XXL"]);
    expect(sizesNamedIn("có 2XL không shop")).toEqual(["XXL"]);
    expect(sizesNamedIn("lấy cỡ L nhé")).toEqual(["L"]);
    expect(sizesNamedIn("quần size 28 còn không")).toEqual(["28"]);
    expect(sizesNamedIn("xxxl có không")).toEqual(["3XL"]);
  });

  it("does not read counts, measurements or ordinary words as sizes", () => {
    expect(sizesNamedIn("có 10 cái không")).toEqual([]);
    expect(sizesNamedIn("mình cao 1m58 nặng 50kg")).toEqual([]);
    expect(sizesNamedIn("có sẵn không, mặc mát không")).toEqual([]);
    expect(sizesNamedIn("Còn màu nào khác?")).toEqual([]);
  });

  it("sizeNotSold: a named size missing from the sizes sold; 2XL = XXL", () => {
    const sizes = ["S", "M", "L", "XL"];
    expect(sizeNotSold("muốn mặc size XXL được không", sizes)).toBe("XXL");
    expect(sizeNotSold("size XL còn không", sizes)).toBeNull();
    expect(sizeNotSold("size 2xl", ["M", "XXL"])).toBeNull();
    expect(sizeNotSold("size XXL", [])).toBeNull();
    expect(sizeNotSold("mặc size nào", sizes)).toBeNull();
  });

  it("oneSizeUp: the next size the product sells, or null at the top", () => {
    expect(oneSizeUp("M", ["S", "M", "L", "XL"])).toBe("L");
    expect(oneSizeUp("XL", ["S", "M", "L", "XL"])).toBeNull();
    expect(oneSizeUp("M", ["L", "S", "M"])).toBe("L");
  });
});

describe("PB-45: asking for other colors", () => {
  it.each(["Còn màu nào khác?", "có màu khác không", "còn những màu gì", "màu gì nữa không shop", "có mấy màu vậy", "đổi màu khác cho mình xem"])(
    "%s",
    (text) => expect(asksOtherColors(text)).toBe(true),
  );
  it.each(["màu đen size S còn không", "còn hàng không", "size nào vừa"])("not: %s", (text) => expect(asksOtherColors(text)).toBe(false));
});

describe("PB-45: names the reply must mention", () => {
  it("whole words, without diacritics or case mattering", () => {
    expect(missedMentions("Dạ, size S còn màu đen 8 chiếc ạ", ["Be", "Đen"])).toEqual(["Be"]);
    expect(missedMentions("Size S còn màu Be (5) và màu Đen (8)", ["Be", "Đen"])).toEqual([]);
    expect(missedMentions("Còn màu xanh rêu", ["Xanh rêu"])).toEqual([]);
    expect(missedMentions("Còn màu xanh", ["Xanh rêu"])).toEqual(["Xanh rêu"]);
    expect(mustMentionNote(["Be"])).toContain("Be");
  });
});
