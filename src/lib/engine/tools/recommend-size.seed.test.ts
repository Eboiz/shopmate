import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recommendSize, type SizeChartRow } from "./recommend-size";

const lines = readFileSync("supabase/seed/demo/size_charts.csv", "utf8").trim().split(/\r?\n/).slice(1);
const charts = new Map<string, SizeChartRow[]>();
for (const line of lines) {
  const [code, size, hMin, hMax, wMin, wMax] = line.split(",");
  const rows = charts.get(code) ?? [];
  rows.push({ size, height_min_cm: Number(hMin), height_max_cm: Number(hMax), weight_min_kg: Number(wMin), weight_max_kg: Number(wMax) });
  charts.set(code, rows);
}

describe("recommend_size on the seeded shop", () => {
  it("returns the declared size at every lower and upper boundary of every chart row", () => {
    expect(charts.size).toBe(30);
    for (const [code, rows] of charts) {
      for (const row of rows) {
        for (const height of [row.height_min_cm, row.height_max_cm]) {
          for (const weight of [row.weight_min_kg, row.weight_max_kg]) {
            expect(recommendSize(rows, height, weight), `${code} ${row.size}: ${height}cm ${weight}kg`).toMatchObject({ status: "ok", size: row.size });
          }
        }
      }
    }
  });

  it("uses the larger size when measurements cross two rows", () => {
    for (const rows of charts.values()) {
      if (rows.length < 2) continue;
      const first = rows[0];
      const last = rows.at(-1)!;
      expect(recommendSize(rows, first.height_min_cm, last.weight_max_kg)).toMatchObject({ status: "ok", size: last.size });
    }
  });

  it("sends measurements outside each product chart to staff", () => {
    for (const rows of charts.values()) {
      expect(recommendSize(rows, Math.min(...rows.map((r) => r.height_min_cm)) - 1, rows[0].weight_min_kg)).toEqual({ status: "out_of_range" });
    }
  });
});
