import type { ToolOutput } from "@/contract";

export type SizeChartRow = {
  size: string;
  height_min_cm: number;
  height_max_cm: number;
  weight_min_kg: number;
  weight_max_kg: number;
};

// Inclusive ranges. A1 chooses the larger size when height and weight disagree.
// Round fractional measurements between whole-number ranges up to the next size.
export function recommendSize(rows: SizeChartRow[], heightCm: number, weightKg: number): ToolOutput<"recommend_size"> {
  if (rows.length === 0) return { status: "no_chart" };
  const sorted = [...rows].sort((x, y) => x.height_min_cm - y.height_min_cm || x.weight_min_kg - y.weight_min_kg);
  const find = (value: number, min: (r: SizeChartRow) => number, max: (r: SizeChartRow) => number) => {
    const at = (v: number) => sorted.findIndex((r) => min(r) <= v && v <= max(r));
    const exact = at(value);
    return exact >= 0 || Number.isInteger(value) ? exact : at(Math.ceil(value));
  };
  const byHeight = find(heightCm, (r) => r.height_min_cm, (r) => r.height_max_cm);
  const byWeight = find(weightKg, (r) => r.weight_min_kg, (r) => r.weight_max_kg);
  if (byHeight < 0 || byWeight < 0) return { status: "out_of_range" };
  return {
    status: "ok",
    size: sorted[Math.max(byHeight, byWeight)].size,
    sizeByHeight: sorted[byHeight].size,
    sizeByWeight: sorted[byWeight].size,
  };
}
