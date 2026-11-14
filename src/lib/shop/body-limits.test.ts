import { describe, expect, it } from "vitest";
import { BODY_LIMITS, BODY_LIMITS_ERROR, parseBody } from "./body-limits";

describe("body limits (PB-46)", () => {
  it("accepts both values inside the limits, a comma as the decimal point", () => {
    expect(parseBody("158", "50")).toEqual({ heightCm: 158, weightKg: 50 });
    expect(parseBody(" 158,5 ", "49.5")).toEqual({ heightCm: 158.5, weightKg: 49.5 });
  });

  it("the limits themselves are allowed, one step past them is not", () => {
    const { heightCm: h, weightKg: w } = BODY_LIMITS;
    expect(parseBody(String(h.min), String(w.min))).not.toBeNull();
    expect(parseBody(String(h.max), String(w.max))).not.toBeNull();
    expect(parseBody(String(h.min - 1), "50")).toBeNull();
    expect(parseBody(String(h.max + 1), "50")).toBeNull();
    expect(parseBody("158", String(w.min - 1))).toBeNull();
    expect(parseBody("158", String(w.max + 1))).toBeNull();
  });

  it("empty or non-numeric input is rejected", () => {
    expect(parseBody("", "50")).toBeNull();
    expect(parseBody("158", " ")).toBeNull();
    expect(parseBody("abc", "50")).toBeNull();
  });

  it("the error message names the same limits", () => {
    expect(BODY_LIMITS_ERROR).toBe("Nhập chiều cao từ 120 đến 210 cm và cân nặng từ 30 đến 150 kg.");
  });
});
