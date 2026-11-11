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
  if (byHeight < 0 || byWeight < 0) return outOfRange(sorted, heightCm, weightKg);
  return {
    status: "ok",
    size: sorted[Math.max(byHeight, byWeight)].size,
    sizeByHeight: sorted[byHeight].size,
    sizeByWeight: sorted[byWeight].size,
  };
}

// PB-31: how far past the chart, and the end size on that side. Above the chart
// on either measurement means the largest size; otherwise the smallest.
function outOfRange(sorted: SizeChartRow[], heightCm: number, weightKg: number): ToolOutput<"recommend_size"> {
  const minH = Math.min(...sorted.map((r) => r.height_min_cm));
  const maxH = Math.max(...sorted.map((r) => r.height_max_cm));
  const minW = Math.min(...sorted.map((r) => r.weight_min_kg));
  const maxW = Math.max(...sorted.map((r) => r.weight_max_kg));
  const past = (v: number, min: number, max: number) => Math.ceil(v > max ? v - max : v < min ? min - v : 0);
  const above = heightCm > maxH || weightKg > maxW;
  const end = above
    ? sorted.reduce((a, r) => (r.height_max_cm + r.weight_max_kg > a.height_max_cm + a.weight_max_kg ? r : a))
    : sorted.reduce((a, r) => (r.height_min_cm + r.weight_min_kg < a.height_min_cm + a.weight_min_kg ? r : a));
  const below = heightCm < minH || weightKg < minW;
  return {
    status: "out_of_range",
    nearestSize: end.size,
    offCm: past(heightCm, minH, maxH),
    offKg: past(weightKg, minW, maxW),
    ...(below ? { belowChart: true as const } : {}),
  };
}
