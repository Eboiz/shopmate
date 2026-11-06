import type { ToolHandler } from "../types";

// content null means the shop wrote nothing for this kind, so the question goes to staff.
export const getPolicy: ToolHandler<"get_policy"> = async (input, ctx, db) => {
  const { data, error } = await db
    .from("policies")
    .select("content")
    .eq("shop_id", ctx.shopId)
    .eq("kind", input.kind)
    .maybeSingle();
  if (error) throw new Error(`policies: ${error.message}`);
  const content = data?.content.trim() ? data.content : null;
  return { kind: input.kind, content };
};
