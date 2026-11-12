import { activePolicyFacts, withFacts } from "../learned-facts";
import type { ToolHandler } from "../types";

// content null means the shop wrote nothing for this kind (and the AI learned
// nothing for it, PB-35a), so the question goes to staff.
export const getPolicy: ToolHandler<"get_policy"> = async (input, ctx, db) => {
  const [{ data, error }, facts] = await Promise.all([
    db.from("policies").select("content").eq("shop_id", ctx.shopId).eq("kind", input.kind).maybeSingle(),
    activePolicyFacts(db, ctx.shopId, input.kind),
  ]);
  if (error) throw new Error(`policies: ${error.message}`);
  return { kind: input.kind, content: withFacts(data?.content, facts) };
};
