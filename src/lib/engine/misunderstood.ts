// PB-05: a product name that matches nothing gets ONE clarifying question (the
// prompt asks for it). If the shopper's answer still matches nothing, the engine
// hands the conversation to staff itself (misunderstood_twice, PB-14) instead of
// trusting the model to count its own misses.
import type { HistoryMessage, ToolCallLog } from "@/contract";

// Tools that only run once the model knows which product the shopper means.
const PRODUCT_TOOLS = new Set(["get_stock", "recommend_size", "get_pairings", "quote_order", "create_draft_order"]);

// A turn "missed the product" when it searched, every search came back empty,
// and nothing in the turn worked on a known product. A failed search (error)
// is not a miss: the shopper did nothing wrong.
export function searchMissed(logs: readonly ToolCallLog[]): boolean {
  const searches = logs.filter((l) => l.name === "search_products");
  if (searches.length === 0) return false;
  const allEmpty = searches.every((l) => {
    if (l.error !== undefined) return false;
    const products = (l.output as { products?: unknown[] } | undefined)?.products;
    return Array.isArray(products) && products.length === 0;
  });
  return allEmpty && !logs.some((l) => PRODUCT_TOOLS.has(l.name) && l.error === undefined);
}

// True when the shopper is answering the AI: the message before the shopper's
// latest message(s) is the AI's (system notices skipped). A staff reply in
// between, or a first message, starts over.
export function answersAiMessage(history: readonly HistoryMessage[]): boolean {
  let i = history.length - 1;
  while (i >= 0 && (history[i].sender === "shopper" || history[i].sender === "system")) i--;
  return i >= 0 && history[i].sender === "ai";
}
