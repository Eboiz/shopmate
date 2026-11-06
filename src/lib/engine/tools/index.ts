import type Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions as contractToolDefinitions, type EngineMode } from "@/contract";
import type { ToolHandlers } from "../types";
import { createDraftOrder } from "./create-draft-order";
import { getPairings } from "./get-pairings";
import { getPolicy } from "./get-policy";
import { getStock } from "./get-stock";
import { handoffToStaff } from "./handoff-to-staff";
import { quoteOrder } from "./quote-order";
import { recommendSizeTool } from "./recommend-size";
import { searchProducts } from "./search-products";

// Every tool of the contract; the type makes a missing one a compile error.
// Handlers don't check the mode: executeTool does.
export const toolHandlers: ToolHandlers = {
  search_products: searchProducts,
  get_stock: getStock,
  recommend_size: recommendSizeTool,
  get_pairings: getPairings,
  get_policy: getPolicy,
  quote_order: quoteOrder,
  create_draft_order: createDraftOrder,
  handoff_to_staff: handoffToStaff,
};

// The tools ADVERTISED to the model in this mode, in the shape the Claude API
// takes. This is not the gate: executeTool enforces toolsForMode(mode). Both
// come from the contract's toolsForMode, so they stay in step; if you ever
// block a tool here by hand, block it in toolsForMode too (or the model can't
// see it but could still run it), and add a case to execute-tool.test.ts.
export function toolDefinitions(mode: EngineMode): Anthropic.Tool[] {
  return contractToolDefinitions(mode) as Anthropic.Tool[];
}
