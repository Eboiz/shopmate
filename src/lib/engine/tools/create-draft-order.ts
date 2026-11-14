import type { ToolOutput } from "@/contract";
import { ToolError, type ToolHandler } from "../types";

// A single RPC call: the whole order is one transaction inside
// engine_create_draft_order, so it is never written in part. Don't split this
// into several requests.
export const createDraftOrder: ToolHandler<"create_draft_order"> = async (input, ctx, db) => {
  if (ctx.conversationId === null) throw new ToolError("no_conversation");
  // Every order is written from a confirmed quote: the RPC refuses a call
  // without its replay key and confirmed prices.
  if (!ctx.order?.quoteKey) throw new ToolError("quote_required");
  const { data, error } = await db.rpc("engine_create_draft_order", {
    p_shop_id: ctx.shopId,
    p_conversation_id: ctx.conversationId,
    p_items: input.items,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_address: input.customerAddress,
    // Server-set confirmed quote (ctx.order): replay key and expected prices.
    p_quote_key: ctx.order.quoteKey,
    p_expected_prices: ctx.order.expectedPrices,
  });
  if (error) {
    if (error.message.includes("variant_not_found")) throw new ToolError("variant_not_found");
    throw new Error(`engine_create_draft_order: ${error.message}`);
  }
  // executeTool checks this against the tool's output schema.
  return data as ToolOutput<"create_draft_order">;
};
