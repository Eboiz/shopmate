import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readDemoData, SHEET_COLUMNS, type SheetName } from "@/lib/seed/sheet";
import { recommendSize, type SizeChartRow } from "./recommend-size";

// PB-06 AC: every row boundary of every size chart in the PB-02 demo data.
const csv = Object.fromEntries(
  (Object.keys(SHEET_COLUMNS) as SheetName[]).map((sheet) => [
    sheet,
    readFileSync(path.join(process.cwd(), "supabase", "seed", "demo", `${sheet}.csv`), "utf8"),
  ]),
) as Record<SheetName, string>;
const parsed = readDemoData(csv);
if (!parsed.data) throw new Error(`Invalid PB-02 demo seed: ${parsed.errors.join("; ")}`);
const demo = parsed.data;

const charts = new Map<string, SizeChartRow[]>();
for (const c of demo.sizeCharts) {
  const rows = charts.get(c.code) ?? [];
  rows.push({
    size: c.size,
    height_min_cm: c.heightMin,
    height_max_cm: c.heightMax,
    weight_min_kg: c.weightMin,
    weight_max_kg: c.weightMax,
  });
  charts.set(c.code, rows);
}
const ordered = (rows: SizeChartRow[]) => [...rows].sort((a, b) => a.height_min_cm - b.height_min_cm);
const mid = (lo: number, hi: number) => Math.round((lo + hi) / 2);
const ok = (size: string, sizeByHeight = size, sizeByWeight = size) => ({ status: "ok", size, sizeByHeight, sizeByWeight });

describe("recommendSize on every demo size chart (PB-02 seed)", () => {
  it("loads a chart for every product in the demo data", () => {
    expect(charts.size).toBe(demo.products.length);
    expect(demo.sizeCharts.length).toBeGreaterThan(100);
  });

  for (const [code, rows] of charts) {
    const sorted = ordered(rows);
    const first = sorted[0];
    const last = sorted.at(-1)!;

    describe(code, () => {
      it("returns each row's size at both ends of its height range and its weight range", () => {
        for (const r of sorted) {
          const h = mid(r.height_min_cm, r.height_max_cm);
          const w = mid(r.weight_min_kg, r.weight_max_kg);
          expect(recommendSize(rows, r.height_min_cm, w), `${code} ${r.size} height min`).toEqual(ok(r.size));
          expect(recommendSize(rows, r.height_max_cm, w), `${code} ${r.size} height max`).toEqual(ok(r.size));
          expect(recommendSize(rows, h, r.weight_min_kg), `${code} ${r.size} weight min`).toEqual(ok(r.size));
          expect(recommendSize(rows, h, r.weight_max_kg), `${code} ${r.size} weight max`).toEqual(ok(r.size));
          expect(recommendSize(rows, r.height_min_cm, r.weight_min_kg)).toEqual(ok(r.size));
          expect(recommendSize(rows, r.height_max_cm, r.weight_max_kg)).toEqual(ok(r.size));
        }
      });

      it("moves to the next size exactly one unit past a row's max", () => {
        for (let i = 0; i + 1 < sorted.length; i++) {
          const [a, b] = [sorted[i], sorted[i + 1]];
          const w = mid(a.weight_min_kg, a.weight_max_kg);
          const h = mid(a.height_min_cm, a.height_max_cm);
          // The demo charts have no whole-number gap between rows.
          expect(b.height_min_cm, `${code} ${a.size}->${b.size} height`).toBe(a.height_max_cm + 1);
          expect(b.weight_min_kg, `${code} ${a.size}->${b.size} weight`).toBe(a.weight_max_kg + 1);
          // Height says b, weight says a: the larger (b) wins and both are reported (A1).
          expect(recommendSize(rows, a.height_max_cm + 1, w)).toEqual(ok(b.size, b.size, a.size));
          expect(recommendSize(rows, h, a.weight_max_kg + 1)).toEqual(ok(b.size, a.size, b.size));
        }
      });

      it("rounds a decimal between two rows up to the larger size", () => {
        for (let i = 0; i + 1 < sorted.length; i++) {
          const [a, b] = [sorted[i], sorted[i + 1]];
          const hMid = (a.height_max_cm + b.height_min_cm) / 2; // e.g. 155.5
          const wMid = (a.weight_max_kg + b.weight_min_kg) / 2;
          expect(recommendSize(rows, hMid, wMid), `${code} ${hMid}/${wMid}`).toEqual(ok(b.size));
          expect(recommendSize(rows, a.height_max_cm - 0.5, a.weight_max_kg - 0.5)).toEqual(ok(a.size));
        }
      });

      it("is out of range one unit outside the chart, in either measurement", () => {
        const h = mid(first.height_min_cm, first.height_max_cm);
        const w = mid(first.weight_min_kg, first.weight_max_kg);
        expect(recommendSize(rows, first.height_min_cm - 1, w)).toEqual({ status: "out_of_range" });
        expect(recommendSize(rows, h, first.weight_min_kg - 1)).toEqual({ status: "out_of_range" });
        expect(recommendSize(rows, last.height_max_cm + 1, w)).toEqual({ status: "out_of_range" });
        expect(recommendSize(rows, h, last.weight_max_kg + 1)).toEqual({ status: "out_of_range" });
        expect(recommendSize(rows, last.height_max_cm + 0.5, w)).toEqual({ status: "out_of_range" });
        expect(recommendSize(rows, first.height_min_cm - 1.5, w)).toEqual({ status: "out_of_range" });
        // Rounds up onto the chart's first whole number, so it is in range.
        expect(recommendSize(rows, first.height_min_cm - 0.5, w)).toMatchObject({ status: "ok", sizeByHeight: first.size });
      });
    });
  }
});
