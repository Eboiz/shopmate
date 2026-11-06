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
