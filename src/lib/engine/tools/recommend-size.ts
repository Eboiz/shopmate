import type { ToolOutput } from "@/contract";
import { ToolError, type ToolHandler } from "../types";

export type SizeChartRow = {
  size: string;
  height_min_cm: number;
  height_max_cm: number;
  weight_min_kg: number;
  weight_max_kg: number;
};

// Both ends of each range count. When height and weight point to different
// sizes, the larger one wins (PB-06, A1); "larger" is the later row once the
// chart is ordered by height, then weight.
// Charts are written in whole cm / kg (151-155, 156-160), so a decimal such as
// 155.5 falls between two rows: it rounds UP to the next whole number, i.e. the
// larger size, the same direction as A1. Past the chart's last row it is still
// out_of_range. (The tool input is whole numbers; this only matters for direct
// callers.)
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

export const recommendSizeTool: ToolHandler<"recommend_size"> = async (input, ctx, db) => {
  const { data: rows, error } = await db
    .from("size_charts")
    .select("size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg")
    .eq("product_id", input.productId)
    .eq("shop_id", ctx.shopId);
  if (error) throw new Error(`size_charts: ${error.message}`);

  if (rows.length === 0) {
    const { data: product, error: productError } = await db
      .from("products")
      .select("id")
      .eq("id", input.productId)
      .eq("shop_id", ctx.shopId)
      .maybeSingle();
    if (productError) throw new Error(`products: ${productError.message}`);
    if (!product) throw new ToolError("product_not_found");
  }
  return recommendSize(rows, input.heightCm, input.weightKg);
};
