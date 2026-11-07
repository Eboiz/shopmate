import { ToolError, type ToolHandler } from "../types";
import { recommendSize } from "./size-recommendation";

export { recommendSize, type SizeChartRow } from "./size-recommendation";

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
