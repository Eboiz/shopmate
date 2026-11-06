import type { ToolContext } from "@/contract";
import { ToolError, type Db, type ToolHandler } from "../types";

// Moves the conversation from ai to needs_human. A conversation staff already
// took over (staff) or already handed off (needs_human) is left as it is, and
// that is not an error. The shop_id filter is the only thing stopping a wrong
// ctx.conversationId from reaching another shop's conversation.
export async function setNeedsHuman(db: Db, ctx: ToolContext): Promise<void> {
  if (ctx.conversationId === null) throw new ToolError("no_conversation");
  const { error } = await db
    .from("conversations")
    .update({ mode: "needs_human" })
    .eq("id", ctx.conversationId)
    .eq("shop_id", ctx.shopId)
    .eq("mode", "ai");
  if (error) throw new Error(`conversations: ${error.message}`);
}

export const handoffToStaff: ToolHandler<"handoff_to_staff"> = async (_input, ctx, db) => {
  await setNeedsHuman(db, ctx);
  return { mode: "needs_human" };
};
