import { describe, expect, it } from "vitest";
import {
  extractMeasurements,
  normalizeSizeInput,
  parseHeightCm,
  parseWeightKg,
  shopperMeasurements,
  shopperTypedNumber,
} from "./measurements";

describe("parseHeightCm", () => {
  it.each([
    ["1m65", 165],
    ["1m6", 160],
    ["1m60", 160],
    ["1 m 65", 165],
    ["1M65", 165],
    ["1.65m", 165],
    ["1,65", 165],
    ["1.6", 160],
    ["165cm", 165],
    ["165 cm", 165],
    ["165", 165],
    ["155.5", 156],
    ["1 mét 65", 165],
    ["1met6", 160],
    ["m6", 160],
    ["m65", 165],
  ])("%s -> %i", (raw, want) => {
    expect(parseHeightCm(raw)).toBe(want);
  });

  it("takes numbers in cm, or in metres under 3", () => {
    expect(parseHeightCm(165)).toBe(165);
    expect(parseHeightCm(1.65)).toBe(165);
    expect(parseHeightCm(155.5)).toBe(156);
  });

  it.each(["", "abc", "cao", "1m655", "2000", "40", "300cm", "58kg"])("rejects %j", (raw) => {
    expect(parseHeightCm(raw)).toBeNull();
  });
});

describe("parseWeightKg", () => {
  it.each([
    ["58kg", 58],
    ["58 kg", 58],
    ["58 ký", 58],
    ["58 kí", 58],
    ["58 ky", 58],
    ["58 cân", 58],
    ["58 can", 58],
    ["58 kilo", 58],
    ["58", 58],
    ["47,5kg", 48],
  ])("%s -> %i", (raw, want) => {
    expect(parseWeightKg(raw)).toBe(want);
  });

  it.each(["", "nặng", "5", "58cm", "1m65", "300kg"])("rejects %j", (raw) => {
    expect(parseWeightKg(raw)).toBeNull();
  });
});

describe("extractMeasurements", () => {
  it.each([
    ["Mình cao 1m65 nặng 58kg thì mặc size nào?", 165, 58],
    ["mình 1m6, 50 ký", 160, 50],
    ["165cm 58 cân", 165, 58],
    ["cao 165 nặng 58", 165, 58],
    ["cao 165, nặng 58.", 165, 58],
    ["Cao 1.65m, nặng khoảng 58 kí", 165, 58],
    ["minh cao 1m55 nang 47kg", 155, 47],
    ["Em nặng 52kg", null, 52],
    ["Em cao 1m58", 158, null],
    // PB-06: how shoppers actually type it.
    ["cao 1m6 nặng 50", 160, 50],
    ["1.65m 55kg", 165, 55],
    ["50kg 160cm", 160, 50],
    ["158cm/50kg", 158, 50],
    ["1m65/58kg mặc size gì", 165, 58],
    ["mình cao m6, nặng 50 kí", 160, 50],
    ["cao 1 mét 65 nặng 58 ký", 165, 58],
    ["nặng 45 kí lô cao 150", 150, 45],
    // Two bare numbers: a plausible height and weight, in either order.
    ["160 50", 160, 50],
    ["160 50 thì mặc size gì shop", 160, 50],
    ["50 160", 160, 50],
  ])("%s", (text, heightCm, weightKg) => {
    expect(extractMeasurements(text)).toEqual({ heightCm, weightKg });
  });

  it("ignores numbers that are not a measurement", () => {
    expect(extractMeasurements("Váy 350000đ còn size 28 không, lấy 2 cái")).toEqual({ heightCm: null, weightKg: null });
    expect(extractMeasurements("size M màu be 165")).toEqual({ heightCm: null, weightKg: null });
    // Bare pairs only when they can't be anything else.
    expect(extractMeasurements("lấy 2 cái size 28")).toEqual({ heightCm: null, weightKg: null });
    expect(extractMeasurements("160 50 size 28")).toEqual({ heightCm: null, weightKg: null });
    expect(extractMeasurements("350k 160")).toEqual({ heightCm: null, weightKg: null });
    expect(extractMeasurements("160 150")).toEqual({ heightCm: null, weightKg: null });
    expect(extractMeasurements("1.6 50")).toEqual({ heightCm: null, weightKg: null });
  });

  it("keeps the last mention in a message", () => {
    expect(extractMeasurements("à nhầm, không phải 1m60 mà 1m62")).toMatchObject({ heightCm: 162 });
  });
});

describe("shopperMeasurements", () => {
  it("takes each value from the newest shopper message that has it", () => {
    expect(
      shopperMeasurements([
        { sender: "shopper", text: "mình cao 1m60 nặng 50kg" },
        { sender: "ai", text: "Bạn cao 165cm nặng 60kg thì size L" },
        { sender: "shopper", text: "à mình cao 1m62 mới đúng" },
      ]),
    ).toEqual({ heightCm: 162, weightKg: 50 });
  });
});

describe("shopperTypedNumber", () => {
  const ask = { sender: "ai" as const, text: "Bạn cho mình biết chiều cao và cân nặng nhé" };
  const said = (text: string, ...rest: Array<{ sender: "shopper" | "ai"; text: string }>) =>
    [{ sender: "shopper" as const, text }, ask, ...rest];

  it("accepts the exact number as a standalone token after the last AI message", () => {
    const history = said("Áo này mặc size nào?", { sender: "shopper", text: "160 ạ" });
    expect(shopperTypedNumber(history, 160)).toBe(true);
    expect(shopperTypedNumber(history, "160")).toBe(true);
    expect(shopperTypedNumber(history, "170")).toBe(false);
    expect(shopperTypedNumber(history, 16)).toBe(false);
  });

  it("compares numerically, comma decimals included", () => {
    expect(shopperTypedNumber(said("x", { sender: "shopper", text: "mình 1,65 thôi" }), "1,65")).toBe(true);
    expect(shopperTypedNumber(said("x", { sender: "shopper", text: "45" }), "45,0")).toBe(true);
  });

  it("with no AI message in the history, every shopper message counts", () => {
    expect(shopperTypedNumber([{ sender: "shopper", text: "50" }], 50)).toBe(true);
  });

  it("a number typed before the last AI message does not back the echo", () => {
    const history = said("165 ạ, còn cân nặng thì sao", { sender: "shopper", text: "ok bạn" });
    expect(shopperTypedNumber(history, 165)).toBe(false);
  });

  it("a number written as money is not a measurement ('Mẫu 165 giá 58k')", () => {
    const history = [{ sender: "shopper" as const, text: "Mẫu 165 giá 58k này mình mặc size nào?" }];
    expect(shopperTypedNumber(history, 58)).toBe(false);
    expect(shopperTypedNumber([{ sender: "shopper", text: "áo 58.000đ" }], 58)).toBe(false);
  });

  it("money written with 'đồng' or a thousands separator is not a measurement", () => {
    const history = [{ sender: "shopper" as const, text: "Mẫu 165 giá 58.000 đồng này mình mặc size nào?" }];
    expect(shopperTypedNumber(history, 58)).toBe(false);
    expect(shopperTypedNumber([{ sender: "shopper", text: "áo 58 đồng" }], 58)).toBe(false);
    expect(shopperTypedNumber([{ sender: "shopper", text: "mình 1,65 thôi" }], "1,65")).toBe(true);
  });

  it("bare answers to successive AI height/weight questions all count", () => {
    const history = [
      { sender: "shopper" as const, text: "Áo này mình mặc size nào?" },
      { sender: "ai" as const, text: "Bạn cao bao nhiêu ạ?" },
      { sender: "shopper" as const, text: "160 ạ" },
      { sender: "ai" as const, text: "Còn cân nặng của bạn thì sao?" },
      { sender: "shopper" as const, text: "50" },
    ];
    expect(shopperTypedNumber(history, 160)).toBe(true);
    expect(shopperTypedNumber(history, 50)).toBe(true);
  });

  it("rejects model values that are not plain numbers", () => {
    const history = said("x", { sender: "shopper", text: "160 ạ" });
    expect(shopperTypedNumber(history, "1m60")).toBe(false);
    expect(shopperTypedNumber(history, null)).toBe(false);
    expect(shopperTypedNumber(history, undefined)).toBe(false);
  });
});

describe("normalizeSizeInput", () => {
  const P = "a0000000-0000-4000-8000-000000000011";
  const said = (text: string) => [{ sender: "shopper" as const, text }];

  it("uses what the shopper wrote over the model's numbers", () => {
    expect(normalizeSizeInput({ productId: P, heightCm: 160, weightKg: 50 }, said("cao 1m65 nặng 58 ký"))).toEqual({
      productId: P,
      heightCm: 165,
      weightKg: 58,
    });
  });

  it("parses the model's own value when the shopper's text has none", () => {
    expect(normalizeSizeInput({ productId: P, heightCm: "1m65", weightKg: "58kg" }, said("size nào vừa?"))).toEqual({
      productId: P,
      heightCm: 165,
      weightKg: 58,
    });
    expect(normalizeSizeInput({ productId: P, heightCm: 1.65, weightKg: 58 }, said("size nào?"))).toMatchObject({ heightCm: 165 });
  });

  it("leaves what it can't read for the tool schema to reject", () => {
    expect(normalizeSizeInput({ productId: P, heightCm: "cao", weightKg: null }, said("size nào?"))).toEqual({
      productId: P,
      heightCm: "cao",
      weightKg: null,
    });
    expect(normalizeSizeInput(null, said("x"))).toBeNull();
  });
});
