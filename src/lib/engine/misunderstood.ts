// PB-05: a product name that matches nothing gets ONE clarifying question (the
// prompt asks for it). If the shopper's answer still matches nothing, the engine
// hands the conversation to staff itself (misunderstood_twice, PB-14) instead of
// trusting the model to count its own misses.
import type { HistoryMessage, ToolCallLog } from "@/contract";
import { fold } from "./text";

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

// The shopper messages after the last AI message, joined by newlines: the words
// the shopper themselves wrote this turn (system notices and staff replies in
// between are not theirs). Tasks 3 and 4 reuse this as latestShopperText.
export function shopperTurnText(history: readonly HistoryMessage[]): string {
  let last = history.length - 1;
  while (last >= 0 && history[last].sender !== "ai") last--;
  return history
    .slice(last + 1)
    .filter((m) => m.sender === "shopper")
    .map((m) => m.text)
    .join("\n");
}

const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The query is the shopper's own wording when it appears in their messages this
// turn as a contiguous phrase, at word boundaries ("váy suông linen" in "váy
// suông linen màu be"; "váy suông linen be" is not, "màu" sits in between).
const phraseIn = (phrase: string, text: string) =>
  phrase.length > 0 && new RegExp(`(?:^|\\W)${regexEscape(phrase)}(?:\\W|$)`).test(text);

const searchQuery = (log: ToolCallLog): string => {
  const q = (log.input as { query?: unknown } | null)?.query;
  return typeof q === "string" ? fold(q) : "";
};

const wordCount = (query: string): number => query.split(/\s+/).filter(Boolean).length;

// Product ids of a search's output, as `productId`.
const searchProductIds = (log: ToolCallLog): string[] => {
  const products = (log.output as { products?: unknown } | undefined)?.products;
  return Array.isArray(products)
    ? products.flatMap((p) => {
        const id = (p as { productId?: unknown } | null)?.productId;
        return typeof id === "string" ? [id] : [];
      })
    : [];
};

// The ids a product tool worked on: get_stock, recommend_size and get_pairings
// carry productId in the input; quote_order's input has none, its output's
// lines name the products quoted.
const productToolIds = (log: ToolCallLog): string[] => {
  const ids: string[] = [];
  const productId = (log.input as { productId?: unknown } | null)?.productId;
  if (typeof productId === "string") ids.push(productId);
  const out = log.output as { lines?: Array<{ productId?: unknown }> } | undefined;
  if (Array.isArray(out?.lines)) {
    for (const line of out.lines) {
      const id = (line as { productId?: unknown } | null)?.productId;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
};

// PB-05 AC3: the miss is decided by the search for the shopper's own words, not
// by the broader queries the model also ran ("áo khoác" for "áo khoác da"): a
// broadened search that finds the real product is not a miss, but one that only
// finds other products, which the turn then works on, hides nothing. A failed
// search is not a miss, and neither is a turn that searched nothing.
export function productMissed(logs: readonly ToolCallLog[], shopperText: string, viewingId: string | null): boolean {
  const searches = logs.filter((l) => l.name === "search_products" && l.error === undefined);
  if (searches.length === 0) return false;
  const foldedShopper = fold(shopperText);
  const worded = searches.filter((l) => phraseIn(searchQuery(l), foldedShopper));
  // Without a shopper-worded search, judge the searches the turn did run.
  const pool = worded.length > 0 ? worded : searches;
  // The searches closest to the shopper's wording have the most of its words.
  const mostWords = Math.max(...pool.map((l) => wordCount(searchQuery(l))));
  const closest = pool.filter((l) => wordCount(searchQuery(l)) === mostWords);
  if (closest.some((l) => searchProductIds(l).length > 0)) return false;
  // Found ids: what the closest searches returned, plus the product on screen.
  // A product tool that ran ok on a found id means the turn worked on a real
  // product; on anything else it answered from a guess.
  const found = new Set([...closest.flatMap(searchProductIds), ...(viewingId !== null ? [viewingId] : [])]);
  return !logs.some(
    (l) => PRODUCT_TOOLS.has(l.name) && l.error === undefined && productToolIds(l).some((id) => found.has(id)),
  );
}

// True when the shopper is answering the AI: the message before the shopper's
// latest message(s) is the AI's (system notices skipped). A staff reply in
// between, or a first message, starts over.
export function answersAiMessage(history: readonly HistoryMessage[]): boolean {
  let i = history.length - 1;
  while (i >= 0 && (history[i].sender === "shopper" || history[i].sender === "system")) i--;
  return i >= 0 && history[i].sender === "ai";
}
