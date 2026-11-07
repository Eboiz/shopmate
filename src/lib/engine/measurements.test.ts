import { describe, expect, it } from "vitest";
import {
  extractMeasurements,
  normalizeSizeInput,
  parseHeightCm,
  parseWeightKg,
  shopperMeasurements,
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
  ])("%s", (text, heightCm, weightKg) => {
    expect(extractMeasurements(text)).toEqual({ heightCm, weightKg });
  });

  it("ignores numbers that are not a measurement", () => {
    expect(extractMeasurements("Váy 350000đ còn size 28 không, lấy 2 cái")).toEqual({ heightCm: null, weightKg: null });
    expect(extractMeasurements("size M màu be 165")).toEqual({ heightCm: null, weightKg: null });
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
