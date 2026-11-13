import { describe, expect, it } from "vitest";
import { recommendSize, type SizeChartRow } from "./recommend-size";

const row = (size: string, h: [number, number], w: [number, number]): SizeChartRow => ({
  size,
  height_min_cm: h[0],
  height_max_cm: h[1],
  weight_min_kg: w[0],
  weight_max_kg: w[1],
});
const chart = [row("S", [150, 157], [40, 46]), row("M", [158, 164], [47, 53]), row("L", [165, 172], [54, 60])];

describe("recommendSize", () => {
  it("picks the size both measurements agree on", () => {
    expect(recommendSize(chart, 160, 50)).toEqual({ status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" });
  });

  it("includes both ends of each range", () => {
    expect(recommendSize(chart, 157, 46)).toMatchObject({ size: "S" });
    expect(recommendSize(chart, 158, 47)).toMatchObject({ size: "M" });
    expect(recommendSize(chart, 172, 60)).toMatchObject({ size: "L" });
    expect(recommendSize(chart, 150, 40)).toMatchObject({ size: "S" });
  });

  it("takes the larger size when height and weight disagree", () => {
    expect(recommendSize(chart, 155, 55)).toEqual({ status: "ok", size: "L", sizeByHeight: "S", sizeByWeight: "L" });
    expect(recommendSize(chart, 170, 45)).toMatchObject({ size: "L" });
  });

  it("is out of range outside the chart", () => {
    for (const [h, w] of [
      [149, 50],
      [160, 61],
      [173, 70],
    ]) {
      expect(recommendSize(chart, h, w)).toMatchObject({ status: "out_of_range" });
    }
  });

  it("says how far past the chart and the end size on that side (PB-31)", () => {
    expect(recommendSize(chart, 180, 80)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 8, offKg: 20 });
    expect(recommendSize(chart, 174, 58)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 2, offKg: 0 });
    expect(recommendSize(chart, 148, 38)).toEqual({ status: "out_of_range", nearestSize: "S", offCm: 2, offKg: 2, belowChart: true });
    // Taller than the chart but lighter: above on one measurement means the largest size.
    expect(recommendSize(chart, 175, 38)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 3, offKg: 2, belowChart: true });
    // Fractions round up, like the size itself.
    expect(recommendSize(chart, 172.5, 55)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 1, offKg: 0 });
  });

  it("has no chart without rows", () => {
    expect(recommendSize([], 160, 50)).toEqual({ status: "no_chart" });
  });

  it("doesn't depend on row order", () => {
    const shuffled = [chart[2], chart[0], chart[1]];
    expect(recommendSize(shuffled, 155, 55)).toEqual(recommendSize(chart, 155, 55));
    expect(recommendSize(shuffled, 160, 50)).toEqual(recommendSize(chart, 160, 50));
  });
});
